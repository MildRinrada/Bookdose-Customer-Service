"""The customer's care profile (backend/modules/contacts): the team's tags, a warning for the team, how and when they
like to be contacted, the language to answer in, consent and a deletion request; and where they have talked to us."""
import unittest

import test_app as base

CONTACTS = '/api/contacts'
PROFILE = {'preferred_channel':'line','contact_hours':'หลัง 18:00','language':'en','tags':['ลูกค้าองค์กร',' สื่อมวลชน ','ลูกค้าองค์กร'],
           'warning':'เคยร้องเรียนเรื่องตอบช้า\nตอบภายใน 1 ชม.','consent':'yes','deletion_requested':False}


class ContactProfileTests(unittest.TestCase):
    # The integration suite's helpers (setUp, ok, visitor, customer, ...), without running its tests again.
    locals().update({name:value for name,value in vars(base.IntegrationTests).items() if not name.startswith(('test','__'))})

    def row(self, client, contact):
        return next(c for c in self.ok(client,CONTACTS)['contacts'] if c['id']==contact)

    def test_profile_is_kept_and_shown(self):
        contact = self.ok(self.admin,CONTACTS,{'first_name':'ธนา','email':'thana@example.com',**PROFILE})['id']
        profile = self.row(self.admin,contact)['profile']
        self.assertEqual(profile['tags'],['ลูกค้าองค์กร','สื่อมวลชน'])
        self.assertEqual((profile['preferred_channel'],profile['contact_hours'],profile['language']),('line','หลัง 18:00','en'))
        self.assertTrue(profile['consent_at']);self.assertTrue(profile['consent_by'])
        self.assertIsNone(profile['deletion_requested_at'])
        # A save without the profile (older callers) keeps it; consent keeps its first date until it changes.
        self.ok(self.admin,f'{CONTACTS}/{contact}',{'first_name':'ธนา','last_name':'ใจดี'},'PATCH')
        self.assertEqual(self.row(self.admin,contact)['profile']['consent_at'],profile['consent_at'])
        self.ok(self.admin,f'{CONTACTS}/{contact}',{'first_name':'ธนา',**PROFILE,'consent':'','deletion_requested':True},'PATCH')
        saved = self.row(self.admin,contact)['profile']
        self.assertEqual((saved['consent'],saved['consent_at']),('',None))
        self.assertTrue(saved['deletion_requested_at'])
        # The chat and case screens read it, with where the customer talked and the last edit.
        view = self.ok(self.admin,f'{CONTACTS}/{contact}/profile')
        self.assertEqual(view['profile']['warning'],'เคยร้องเรียนเรื่องตอบช้า\nตอบภายใน 1 ชม.')
        self.assertEqual(view['channels'],[]);self.assertEqual(view['last_edit']['action'],'contact.updated')
        # An agent never edits it (a customer outside their team's work does not exist for them).
        agent,_ = self.create_member()
        self.assertIn(agent.call(f'{CONTACTS}/{contact}',{'first_name':'x',**PROFILE},'PATCH')[0],(403,404))
        # Deleted and restored: the profile comes back with the customer.
        self.ok(self.admin,f'{CONTACTS}/{contact}',None,'DELETE')
        item = next(i for i in self.ok(self.admin,'/api/trash')['items'] if i['kind']=='contact')
        self.ok(self.admin,f"/api/trash/{item['id']}/restore",{})
        self.assertEqual(self.row(self.admin,contact)['profile']['tags'],['ลูกค้าองค์กร','สื่อมวลชน'])

    def test_channels_and_merge(self):
        _,conversation = self.visitor()
        contact = self.ok(self.admin,'/api/conversations/'+conversation)['contact']['id']
        channels = self.ok(self.admin,f'{CONTACTS}/{contact}/profile')['channels']
        self.assertEqual([(c['channel'],c['conversations']) for c in channels],[('web',1)])
        # Merging: the kept contact takes a duplicate's profile when it has none.
        dup = self.ok(self.admin,CONTACTS,{'first_name':'ซ้ำ',**PROFILE})['id']
        self.ok(self.admin,f'{CONTACTS}/{contact}/merge',{'contact_ids':[dup]})
        self.assertEqual(self.row(self.admin,contact)['profile']['language'],'en')

    def test_what_may_be_saved(self):
        for bad in ({'preferred_channel':'fax'},{'language':'jp'},{'consent':'maybe'},{'tags':'a,b'},{'tags':['x'*31]},
                    {'tags':['a,b']},{'tags':[str(i) for i in range(11)]},{'contact_hours':'a\nb'},{'warning':'x'*301},
                    {'deletion_requested':'yes'}):
            self.assertEqual(self.admin.call(CONTACTS,{'first_name':'ทดสอบ',**bad})[0],400,bad)
        self.assertEqual(self.admin.call(f'{CONTACTS}/{"0"*32}/profile')[0],404)


if __name__=='__main__':
    unittest.main()
