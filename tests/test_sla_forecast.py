"""The SLA forecast: a case is flagged before its deadline when the queue in front of it, at the pace the team is
clearing work, will not reach it in time - and not when it will. The arithmetic is checked on its own (predict), and
the dashboard is checked to carry it."""
import datetime as dt
import unittest

import test_app as base
from backend.database import db as D
from backend.modules.automation import forecast
from backend.modules.automation.forecast import predict
from backend.utils.dates import after

NOW = dt.datetime(2026,9,24,9,0,tzinfo=dt.timezone.utc)


def at(minutes):
    return (NOW+dt.timedelta(minutes=minutes)).isoformat(timespec='seconds')


def case(number, first_due=None, resolve_due=600, answered=False, team='t1', owner=None):
    return {'id':f'c{number}','number':number,'subject':f'เคส {number}','priority':'normal','team_id':team,'assignee_id':owner,
            'first_response_at':at(-5) if answered else None,'first_response_due_at':at(first_due if first_due is not None else 60),
            'resolution_due_at':at(resolve_due)}


class PredictTests(unittest.TestCase):
    def test_a_queue_the_team_will_clear_in_time_flags_nothing(self):
        # 2 first replies an hour: the first case is reached in 30 minutes, the second in 60 - both within 90.
        found,unknown = predict([case(1,90),case(2,90)],{'t1':2},{('team','t1'):1},NOW)
        self.assertEqual(found,[])
        self.assertEqual(unknown,0)

    def test_the_case_the_queue_will_not_reach_in_time_is_flagged_with_how_late(self):
        # 3 cases due in 60 minutes at 2 an hour: reached at 30, 60 and 90 minutes - the third is 30 minutes late.
        found,_ = predict([case(1,60),case(2,60),case(3,60)],{'t1':2},{},NOW)
        self.assertEqual([f['number'] for f in found],[3])
        self.assertEqual(found[0]['kind'],'response')
        self.assertEqual(found[0]['ahead'],2)
        self.assertEqual(found[0]['late_minutes'],30)
        self.assertEqual(found[0]['expected'],at(90))

    def test_the_queue_is_worked_earliest_deadline_first(self):
        # The case due later stands behind the one due sooner, whatever order they arrive in: at one an hour the
        # case due in 40 minutes is reached at 60, the one due in 100 at 120.
        found,_ = predict([case(1,100),case(2,40)],{'t1':1},{},NOW)
        self.assertEqual({f['number']:f['ahead'] for f in found},{2:0,1:1})
        self.assertEqual([f['number'] for f in found],[2,1])

    def test_resolution_is_forecast_from_the_owners_own_queue_and_pace(self):
        # One case closed an hour by this owner; three answered cases due in 150 minutes: the third needs 180.
        cases = [case(n,answered=True,resolve_due=150,owner='u1') for n in (1,2,3)]
        found,_ = predict(cases,{},{('member','u1'):1},NOW)
        self.assertEqual([(f['number'],f['kind'],f['late_minutes']) for f in found],[(3,'resolution',30)])

    def test_a_case_already_late_is_not_a_forecast(self):
        found,_ = predict([case(1,-10)],{'t1':0.1},{},NOW)
        self.assertEqual(found,[])

    def test_no_pace_at_all_is_said_rather_than_calling_everything_late(self):
        found,unknown = predict([case(1,60),case(2,60)],{},{},NOW)
        self.assertEqual(found,[])
        self.assertEqual(unknown,2)

    def test_a_case_is_listed_once_by_the_deadline_it_misses_first(self):
        found,_ = predict([case(1,30,resolve_due=45)],{'t1':1},{('team','t1'):0.5},NOW)
        self.assertEqual(len(found),1)
        self.assertEqual(found[0]['kind'],'response')


class ForecastOnDashboardTests(unittest.TestCase):
    def test_the_dashboard_carries_the_forecast(self):
        forecast = self.ok(self.admin,'/api/automation/overview?tz=-420')['forecast']
        self.assertIsInstance(forecast['cases'],list)
        self.assertIn('unknown',forecast)
        self.assertIn('response_per_hour',forecast)

    def slow_case(self):
        """A new case due for a first reply in ten minutes, in a team that has answered one case in the past week:
        at that pace the queue reaches it in days."""
        _,conversation = self.visitor()
        ticket = self.ok(self.admin,f'/api/conversations/{conversation}/ticket',{})['id']
        with D.tenant(self.org) as db:
            team = db.execute('SELECT team_id FROM tickets WHERE id=?',(ticket,)).fetchone()[0]
            db.execute('UPDATE tickets SET first_response_at=NULL,first_response_due_at=? WHERE first_response_at IS NULL',(after(days=-1),))
            db.execute('UPDATE tickets SET first_response_due_at=? WHERE id=?',(after(minutes=10),ticket))
            db.execute('UPDATE tickets SET first_response_at=NULL WHERE team_id=? AND id!=?',(team,ticket))
            db.execute('UPDATE tickets SET first_response_at=? WHERE id=(SELECT id FROM tickets WHERE id!=? LIMIT 1)',(after(days=-3),ticket))
            db.execute('UPDATE tickets SET team_id=? WHERE first_response_at IS NOT NULL',(team,))
            db.commit()
        return conversation,ticket

    def test_a_case_forecast_late_is_told_once_and_tagged_in_the_list(self):
        conversation,ticket = self.slow_case()
        with D.control() as cd, D.tenant(self.org) as db:
            self.assertGreaterEqual(forecast.alert_new(cd,db,self.org),1)
            self.assertEqual(forecast.alert_new(cd,db,self.org),0)   # once per deadline
            notice = db.execute("SELECT subject FROM staff_notices WHERE event='sla' ORDER BY created_at DESC LIMIT 1").fetchone()
        self.assertIn('น่าจะเกิน SLA',notice[0])
        told = self.ok(self.admin,'/api/automation/alerts')['forecasts']
        self.assertIn(ticket,[f['ticket_id'] for f in told])
        listed = next(t for t in self.ok(self.admin,'/api/tickets')['tickets'] if t['id']==ticket)
        self.assertEqual(listed['forecast']['kind'],'response')
        self.assertGreater(listed['forecast']['late_minutes'],0)
        # Answered: the first-reply warning no longer stands, and the list no longer tags it for that deadline.
        self.ok(self.admin,f'/api/conversations/{conversation}/messages',{'kind':'reply','body':'รับเรื่องแล้วค่ะ'})
        self.assertNotIn(ticket,[f['ticket_id'] for f in self.ok(self.admin,'/api/automation/alerts')['forecasts']])


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith('test_') and not _name.startswith('__'):
        setattr(ForecastOnDashboardTests,_name,_member)


if __name__ == '__main__':
    unittest.main()
