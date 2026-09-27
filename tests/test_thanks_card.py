"""การ์ดขอบคุณหลังปิดเคส (automation/thanks.py): the organization turns it on, each member decides whether customers
see their photo and may write their own thank-you, and only the customer of the conversation sees it. Disposable
databases."""
import unittest

import test_app as base

PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
SETTINGS = {'escalation_enabled':True,'escalation_minutes':15,'csat_enabled':True,'csat_message':'ให้คะแนนหน่อยนะ'}


class ThanksCardTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member
    visitor = base.IntegrationTests.visitor
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    mail_link = base.IntegrationTests.mail_link
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD

    def closed_case(self, client, conv, agent_id):
        tid = self.ok(self.admin,f'/api/conversations/{conv}/ticket',{})['id']
        self.ok(self.admin,f'/api/tickets/{tid}',{'assignee_id':agent_id,'status':'resolved'},'PATCH')
        return tid

    def test_the_card_is_the_organizations_choice_and_the_photo_the_members(self):
        agent,agent_id = self.create_member()
        client,conv = self.visitor()
        # Off until an owner turns it on.
        self.assertFalse(self.ok(self.admin,'/api/automation')['settings']['thanks_enabled'])
        tid = self.closed_case(client,conv,agent_id)
        self.assertIsNone(self.ok(client,'/api/public/alpha/session')['thanks'])
        self.ok(self.admin,f'/api/tickets/{tid}',{'status':'open'},'PATCH')
        self.ok(self.admin,'/api/automation/settings',{**SETTINGS,'thanks_enabled':True,'thanks_message':''},'PATCH')
        self.ok(self.admin,f'/api/tickets/{tid}',{'status':'resolved'},'PATCH')
        card = self.ok(client,'/api/public/alpha/session')['thanks']
        # The name the customer already sees on replies, the initials rather than a photo, the organization's words.
        self.assertEqual((card['name'],card['photo'],card['message']),('เจ้าหน้าที่ทดสอบ',False,'ขอบคุณที่ให้เราได้ดูแลเรื่องนี้ ถ้ามีอะไรเพิ่มเติม ทักมาได้เสมอ'))
        self.assertEqual(client.call(f"/api/public/alpha/thanks/{card['id']}/photo")[0],404)
        self.assertIn('ticket.thanks_card',[e['action'] for e in self.ok(self.admin,f'/api/tickets/{tid}')['events']])
        # The member shows their photo, under the name they chose, with their own words.
        self.ok(agent,'/api/account/profile',{'name':'เจ้าหน้าที่ทดสอบ','avatar':PNG})
        self.ok(agent,'/api/account/preferences',{'alias':'น้องเอ','thanks':{'photo':True,'message':'ดีใจที่ได้ช่วยนะคะ'}})
        card = self.ok(client,'/api/public/alpha/session')['thanks']
        self.assertEqual((card['name'],card['photo'],card['message']),('น้องเอ',True,'ดีใจที่ได้ช่วยนะคะ'))
        status,photo = client.call(f"/api/public/alpha/thanks/{card['id']}/photo")
        self.assertEqual((status,photo[:4]),(200,b'\x89PNG'))
        # Nobody else's: another customer of the organization gets nothing.
        other,_ = self.visitor(email='other@example.com')
        self.assertEqual(other.call(f"/api/public/alpha/thanks/{card['id']}/photo")[0],404)
        # Taking the photo back, or the organization turning the card off, holds for a card already given.
        self.ok(agent,'/api/account/preferences',{'thanks':{'photo':False,'message':''}})
        self.assertFalse(self.ok(client,'/api/public/alpha/session')['thanks']['photo'])
        self.assertEqual(client.call(f"/api/public/alpha/thanks/{card['id']}/photo")[0],404)
        self.ok(self.admin,'/api/automation/settings',{**SETTINGS,'thanks_enabled':False},'PATCH')
        self.assertIsNone(self.ok(client,'/api/public/alpha/session')['thanks'])

    def test_the_card_leaves_when_the_customer_writes_again(self):
        agent,agent_id = self.create_member()
        self.ok(self.admin,'/api/automation/settings',{**SETTINGS,'thanks_enabled':True,'thanks_message':'ขอบคุณจากทีมเรา'},'PATCH')
        client,conv = self.visitor()
        self.closed_case(client,conv,agent_id)
        self.assertEqual(self.ok(client,'/api/public/alpha/session')['thanks']['message'],'ขอบคุณจากทีมเรา')
        self.ok(client,'/api/public/alpha/messages',{'body':'ขอถามต่ออีกเรื่องค่ะ'})
        self.assertIsNone(self.ok(client,'/api/public/alpha/session')['thanks'])
        for bad in ({'thanks':{'photo':'yes'}},{'thanks':{'photo':True,'message':'ก'*201}}):
            self.assertEqual(agent.call('/api/account/preferences',bad)[0],400,bad)
        self.assertEqual(self.admin.call('/api/automation/settings',{**SETTINGS,'thanks_message':'ก'*201},'PATCH')[0],400)


if __name__=='__main__':
    unittest.main()
