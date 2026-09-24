"""ลำดับคิวและเวลารอ: a customer waiting for the team sees their place and about how long, from the team's real
replies; the moment the team answers it is gone; with nobody available it says so instead of a time."""
import unittest

import test_app as base
from backend.database import db as D
from backend.modules.conversations import queue
from backend.utils.dates import after


class EstimateTests(unittest.TestCase):
    def test_the_larger_of_the_usual_wait_and_the_queue(self):
        # Usually 10 minutes, waited 4 already, one ahead at 12 an hour: the queue says 10, the usual 6.
        self.assertEqual(queue.estimate(2,4*60,10*60,12),10)
        # Nobody ahead, a quick team: what is left of the usual wait.
        self.assertEqual(queue.estimate(1,2*60,10*60,60),8)
        self.assertIsNone(queue.estimate(1,0,None,0))


class QueueTests(unittest.TestCase):
    def setUp(self):
        base.IntegrationTests.setUp(self)
        queue._cache.clear()
        with D.tenant(self.org) as db:   # the demo data's own waiting chats out of the way: this queue is the ones below
            db.execute("UPDATE conversations SET status='closed'")
            db.commit()

    def shown(self, visitor):
        queue._cache.clear()
        return self.ok(visitor,'/api/public/alpha/session')['queue']

    def test_place_and_wait_then_gone_once_answered(self):
        # The team's week: five customers each answered after 20 minutes.
        with D.tenant(self.org) as db:
            team = db.execute('SELECT id FROM teams LIMIT 1').fetchone()[0]
            for i in range(5):
                db.execute("INSERT INTO conversations(id,contact_id,subject,channel,team_id,status,created_at,updated_at) "
                           "SELECT ?,id,'x','web',?,'closed',?,? FROM contacts LIMIT 1",
                           (f'old{i}',team,after(minutes=-60),after(minutes=-60)))
                for kind,minutes in (('customer',-60),('reply',-40)):
                    db.execute("INSERT INTO messages(id,conversation_id,author_name,kind,body,delivery,created_at) VALUES(?,?,?,?,?,?,?)",
                               (f'old{i}{kind}',f'old{i}','x',kind,'x','stored',after(minutes=minutes)))
            db.commit()
        first,conv1 = self.visitor('alpha','first@example.com','Q1','สอบถามหน่อยค่ะ')
        second,conv2 = self.visitor('alpha','second@example.com','Q2','สอบถามเหมือนกันค่ะ')
        with D.tenant(self.org) as db:
            db.execute('UPDATE conversations SET team_id=? WHERE id IN (?,?)',(team,conv1,conv2))
            db.commit()
        one,two = self.shown(first),self.shown(second)
        self.assertEqual((one['position'],two['position']),(1,2))
        self.assertFalse(one['away'])
        # About the team's usual 20 minutes, and never less for the one behind.
        self.assertTrue(15<=one['wait_minutes']<=21,one)
        self.assertGreaterEqual(two['wait_minutes'],one['wait_minutes'])
        # The team answers the first: gone for them at once, and the second moves up.
        self.ok(self.admin,f'/api/conversations/{conv1}/messages',{'kind':'reply','body':'สวัสดีค่ะ'})
        self.assertIsNone(self.shown(first))
        self.assertEqual(self.shown(second)['position'],1)

    def test_nobody_available_says_so_instead_of_a_time(self):
        visitor,_ = self.visitor('alpha','away@example.com','Q','มีใครอยู่ไหมคะ')
        with D.control() as cd:
            ids = [r[0] for r in cd.execute('SELECT user_id FROM memberships WHERE tenant_id=?',(self.org,))]
            for user_id in ids:
                cd.execute("INSERT INTO staff_preferences(user_id,prefs,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET prefs=excluded.prefs",
                           (user_id,'{"status":"offline"}',after(minutes=0)))
            cd.commit()
        shown = self.shown(visitor)
        self.assertEqual((shown['position'],shown['wait_minutes'],shown['away']),(1,None,True))


# The sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__', 'setUp')):
        setattr(QueueTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
