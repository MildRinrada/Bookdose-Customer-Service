"""ป้ายเคส (tickets/tags.py), แจกเคสอัตโนมัติ (automation/distribution.py) and who works on the coming days for the
report's staffing card (reports/staffing.py). Each test uses a disposable database."""
import datetime as dt
import unittest

import test_app as base
from test_app import D
from backend.modules.automation import distribution
from backend.utils.dates import after


class CaseTagTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    visitor = base.IntegrationTests.visitor
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    mail_link = base.IntegrationTests.mail_link
    create_member = base.IntegrationTests.create_member
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD

    def tag_list(self, *names):
        saved = self.ok(self.admin,'/api/settings/tags',{'tags':[{'name':n} for n in names]})
        return {t['name']:t['id'] for t in saved['tags']}

    def new_case(self, subject='สินค้ามาไม่ครบ', assignee=None):
        contact = self.ok(self.admin,'/api/contacts')['contacts'][0]['id']
        body = {'subject':subject,'contact_id':contact}
        if assignee:
            body['assignee_id'] = assignee
        return self.ok(self.admin,'/api/tickets',body)['id']

    def test_the_organization_keeps_its_own_list_and_the_team_tags_cases(self):
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/settings/tags',{'tags':[{'name':'ส่งช้า'}]})[0],403)
        for bad in ([{'name':'ส่งช้า'},{'name':'ส่งช้า '}],[{'name':''}],[{'name':'ก'*41}]):
            self.assertEqual(self.admin.call('/api/settings/tags',{'tags':bad})[0],400,bad)
        ids = self.tag_list('ส่งช้า','สินค้าชำรุด','ขอคืนสินค้า')
        self.assertEqual(list(ids),['ส่งช้า','สินค้าชำรุด','ขอคืนสินค้า'])
        self.assertIn('case_tags',self.ok(self.admin,'/api/workspace')['settings'])

        tid = self.new_case()
        # Anyone who may see the case may tag it; only words on the list, each once, at most ten.
        self.assertEqual(self.ok(agent,f'/api/tickets/{tid}/tags',{'tags':[ids['สินค้าชำรุด'],ids['ส่งช้า'],ids['ส่งช้า']]})['tags'],
                         [ids['ส่งช้า'],ids['สินค้าชำรุด']])
        self.assertEqual(agent.call(f'/api/tickets/{tid}/tags',{'tags':['0'*32]})[0],400)
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{tid}')['ticket']['tags'],[ids['ส่งช้า'],ids['สินค้าชำรุด']])
        listed = next(t for t in self.ok(self.admin,'/api/tickets')['tickets'] if t['id']==tid)
        self.assertEqual(sorted(listed['tags']),sorted([ids['ส่งช้า'],ids['สินค้าชำรุด']]))
        self.assertNotIn('tag_ids',listed)
        events = self.ok(self.admin,f'/api/tickets/{tid}')['events']
        self.assertIn('ticket.tagged',[e['action'] for e in events])
        self.assertIn('ส่งช้า',self.admin.call('/api/export/tickets.csv')[1].decode('utf-8-sig'))

        # A renamed tag keeps its cases; a tag taken off the list comes off them.
        counts = self.ok(self.admin,'/api/settings/tags')['counts']
        self.assertEqual(counts[ids['ส่งช้า']],1)
        saved = self.ok(self.admin,'/api/settings/tags',{'tags':[{'id':ids['ส่งช้า'],'name':'จัดส่งล่าช้า'},{'id':ids['ขอคืนสินค้า'],'name':'ขอคืนสินค้า'}]})
        self.assertEqual([t['name'] for t in saved['tags']],['จัดส่งล่าช้า','ขอคืนสินค้า'])
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{tid}')['ticket']['tags'],[ids['ส่งช้า']])

    def test_a_deleted_case_comes_back_from_the_bin_with_its_tags(self):
        ids = self.tag_list('ส่งช้า')
        tid = self.new_case()
        self.ok(self.admin,f'/api/tickets/{tid}/tags',{'tags':[ids['ส่งช้า']]})
        self.ok(self.admin,f'/api/tickets/{tid}',method='DELETE')
        item = next(i for i in self.ok(self.admin,'/api/trash')['items'] if i['entity']==tid)
        self.ok(self.admin,f"/api/trash/{item['id']}/restore",{})
        self.assertEqual(self.ok(self.admin,f'/api/tickets/{tid}')['ticket']['tags'],[ids['ส่งช้า']])

    def test_a_routing_rule_puts_tags_on_and_loses_the_ones_taken_off_the_list(self):
        ids = self.tag_list('ส่งช้า','สินค้าชำรุด')
        self.assertEqual(self.admin.call('/api/automation/rules',{'name':'ป้ายผิด','channel':'web','set_tags':['0'*32]})[0],400)
        rule = self.ok(self.admin,'/api/automation/rules',{'name':'ของยังไม่มา','channel':'web','keywords':'ยังไม่ได้รับของ',
                                                          'set_tags':[ids['ส่งช้า'],ids['สินค้าชำรุด']]})['id']
        _,conv = self.visitor(subject='ติดตามพัสดุ',body='สั่งไปสามวันแล้ว ยังไม่ได้รับของเลย')
        ticket = self.ok(self.admin,f'/api/conversations/{conv}')['ticket']
        self.assertEqual(self.ok(self.admin,f"/api/tickets/{ticket['id']}")['ticket']['tags'],[ids['ส่งช้า'],ids['สินค้าชำรุด']])
        self.ok(self.admin,'/api/settings/tags',{'tags':[{'id':ids['สินค้าชำรุด'],'name':'สินค้าชำรุด'}]})
        stored = next(r for r in self.ok(self.admin,'/api/automation')['rules'] if r['id']==rule)
        self.assertEqual(stored['set_tags'],[ids['สินค้าชำรุด']])


class DistributionTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member

    def settle(self):
        """Hand out the demo's waiting cases to nobody: switch on with the owner excluded and nobody else here."""
        with D.tenant(self.org) as db:
            db.execute("UPDATE tickets SET status='closed' WHERE assignee_id IS NULL")
            db.commit()

    def turn_on(self, **changes):
        body = {'enabled':True,'cap':2,'all_teams':True,'teams':[],'owners':False,**changes}
        return self.ok(self.admin,'/api/automation/distribution',body,'PATCH')['settings']

    def new_case(self, subject='สอบถามการใช้งาน'):
        contact = self.ok(self.admin,'/api/contacts')['contacts'][0]['id']
        tid = self.ok(self.admin,'/api/tickets',{'subject':subject,'contact_id':contact})['id']
        return self.ok(self.admin,f'/api/tickets/{tid}')['ticket']

    def test_a_new_case_goes_to_the_least_busy_member_who_can_take_it(self):
        self.settle()
        first,first_id = self.create_member(email='one@example.com')
        second,second_id = self.create_member(email='two@example.com')
        for member in (first,second):
            self.ok(member,'/api/workspace')          # the app is open
        agent,_ = self.create_member()
        self.assertEqual(agent.call('/api/automation/distribution',{'enabled':True,'cap':2},'PATCH')[0],403)
        self.assertEqual(self.admin.call('/api/automation/distribution',{'enabled':True,'cap':0,'all_teams':True,'owners':False},'PATCH')[0],400)
        self.assertEqual(self.admin.call('/api/automation/distribution',{'enabled':True,'cap':2,'all_teams':False,'teams':[],'owners':False},'PATCH')[0],400)
        # The third member never opened the app: they get nothing.
        with D.tenant(self.org) as db:
            db.execute('DELETE FROM agent_activity WHERE user_id NOT IN (?,?)',(first_id,second_id))
            db.commit()
        self.turn_on()
        owners = [self.new_case()['assignee_id'] for _ in range(4)]
        self.assertEqual(sorted(owners),sorted([first_id,first_id,second_id,second_id]))
        # Both hold two: the ceiling. The next case waits for the team.
        waiting = self.new_case()
        self.assertIsNone(waiting['assignee_id'])
        page = self.ok(self.admin,'/api/automation')['distribution']
        self.assertEqual((page['waiting'],page['today']),(1,4))
        self.assertEqual({p['id']:p['ready'] for p in page['people'] if p['id'] in (first_id,second_id)},{first_id:False,second_id:False})
        # One finishes a case: the worker's next round hands them the waiting one.
        mine = next(t for t in self.ok(first,'/api/tickets')['tickets'] if t['assignee_id']==first_id and t['status']!='closed')
        self.ok(first,f"/api/tickets/{mine['id']}",{'status':'resolved'},'PATCH')
        with D.control() as cd, D.tenant(self.org) as db:
            self.assertEqual(distribution.run(cd,db,self.org),1)
        self.assertEqual(self.ok(self.admin,f"/api/tickets/{waiting['id']}")['ticket']['assignee_id'],first_id)
        events = self.ok(self.admin,f"/api/tickets/{waiting['id']}")['events']
        self.assertIn('ticket.auto_assigned',[e['action'] for e in events])

    def test_members_away_or_long_gone_get_nothing_and_owners_only_when_chosen(self):
        self.settle()
        agent,agent_id = self.create_member()
        self.ok(agent,'/api/account/preferences',{'status':'break'})
        self.ok(self.admin,'/api/workspace')
        self.turn_on()
        self.assertIsNone(self.new_case()['assignee_id'])
        people = {p['id']:p for p in self.ok(self.admin,'/api/automation')['distribution']['people']}
        self.assertFalse(people[agent_id]['ready'])
        self.assertIn('พัก',people[agent_id]['reason'])
        # Back, but the app has not been used for longer than the window.
        self.ok(agent,'/api/account/preferences',{'status':'online'})
        with D.tenant(self.org) as db:
            db.execute('UPDATE agent_activity SET last_seen=? WHERE user_id=?',(after(minutes=-(distribution.ACTIVE_MINUTES+5)),agent_id))
            db.commit()
        with D.control() as cd, D.tenant(self.org) as db:
            self.assertEqual(distribution.run(cd,db,self.org),0)
        # With owners included, the owner (using the app now) takes it.
        self.turn_on(owners=True)
        admin_id = self.ok(self.admin,'/api/bootstrap')['user']['id']
        owned = [t['assignee_id'] for t in self.ok(self.admin,'/api/tickets')['tickets'] if t['status']!='closed']
        self.assertIn(admin_id,owned)

    def test_only_the_teams_chosen_hand_cases_out(self):
        self.settle()
        other = self.ok(self.admin,'/api/teams',{'name':'ทีมเทคนิค'})['id']
        agent,agent_id = self.create_member()
        self.ok(agent,'/api/workspace')
        self.turn_on(all_teams=False,teams=[other])
        self.assertIsNone(self.new_case()['assignee_id'])
        self.turn_on(all_teams=False,teams=[self.team])
        owned = [t['assignee_id'] for t in self.ok(self.admin,'/api/tickets')['tickets'] if t['status']!='closed']
        self.assertEqual(owned,[agent_id])


class StaffingTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member

    def test_who_works_on_each_coming_day(self):
        agent,agent_id = self.create_member()
        self.assertEqual(agent.call('/api/reports/staffing')[0],403)
        today = dt.datetime.now(dt.timezone(dt.timedelta(hours=7))).date()
        tomorrow = today+dt.timedelta(days=1)
        self.ok(agent,'/api/account/preferences',{'leave':[{'from':tomorrow.isoformat(),'to':tomorrow.isoformat(),'note':'ไปหาหมอ'}],
                                                  'hours':{'enabled':True,'days':[0,1,2,3,4],'start':'09:00','end':'18:00'}})
        plan = self.ok(self.admin,'/api/reports/staffing')
        self.assertEqual(plan['days'][0],today.isoformat())
        me = next(m for m in plan['members'] if m['id']==agent_id)
        self.assertTrue(me['hours_set'])
        self.assertEqual(me['days'][1],{'works':False,'why':'leave'})
        self.assertNotIn('ไปหาหมอ',str(plan))
        for i,day in enumerate(plan['days'][2:],2):
            weekday = dt.date.fromisoformat(day).weekday()
            self.assertEqual(me['days'][i]['works'],weekday<5,day)
        # An organization holiday closes the day for everyone, when the organization uses its hours.
        holiday = (today+dt.timedelta(days=3)).isoformat()
        self.ok(self.admin,'/api/settings/hours',{'enabled':True,'sla':False,'days':[['09:00','18:00']]*7,
                                                  'holidays':[{'date':holiday,'name':'วันหยุดบริษัท'}],'message':'นอกเวลา'})
        plan = self.ok(self.admin,'/api/reports/staffing')
        self.assertEqual(plan['holidays'],[{'date':holiday,'name':'วันหยุดบริษัท'}])
        self.assertTrue(all(m['days'][3]=={'works':False,'why':'holiday'} for m in plan['members']))


if __name__=='__main__':
    unittest.main()
