"""The client team of a customer: invitations (a proven email, or any account with that email while the platform
cannot send email), declining, changing and removing a member (effective at once), what each role may do on the
owner's contracts and projects, the projects a member is given (an MA contract follows its project), another owner's
documents staying out of reach, the overview rows with the viewer's role, and each member's own document chat.
Email is mocked; nothing leaves the machine."""
import unittest

import test_app as base
import test_contracts as contract_tests
from test_app import Client, D, rate_limit

PNG = contract_tests.PNG
PDF = contract_tests.PDF
ORG = '/api/public/alpha'


class ClientTeamTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    visitor = base.IntegrationTests.visitor
    customer = base.IntegrationTests.customer
    customer_mail = base.IntegrationTests.customer_mail
    mail_link = base.IntegrationTests.mail_link
    enable_registration_mail = base.IntegrationTests.enable_registration_mail
    CUSTOMER_PASSWORD = base.IntegrationTests.CUSTOMER_PASSWORD
    draft = contract_tests.ContractTests.draft
    signed = contract_tests.ContractTests.signed
    no_email = contract_tests.ContractTests.no_email
    project = contract_tests.ContractTests.project

    # The support page counts requests per address; these tests make many from one.
    def ok(self, client, path, body=None, method=None):
        rate_limit.RATES.clear()
        return base.IntegrationTests.ok(self,client,path,body,method)

    def status(self, client, path, body=None, method=None):
        rate_limit.RATES.clear()
        return client.call(path,body,method)[0]

    def invite(self, owner, email, role, **scope):
        return self.ok(owner,f'{ORG}/team',{'email':email,'role':role,'all_projects':True,**scope})['id']

    def join(self, owner, member, email, role, **scope):
        """An invitation the member accepts; returns the team row id."""
        row = self.invite(owner,email,role,**scope)
        self.ok(member,f'{ORG}/team/{row}/accept',{})
        return row

    def unverified(self, email):
        """An account made while the platform cannot send email (its address never proven), signed in."""
        client = Client(self.base)
        rate_limit.RATES.clear()
        self.assertEqual(client.call('/api/customer/register',{'name':'ลูกค้าใหม่','email':email,'password':self.CUSTOMER_PASSWORD,
                                                                'consent':True,'org':'alpha'})[0],201)
        client.customer_csrf = self.ok(client,'/api/customer/account')['csrf']
        return client

    def sent(self, email='owner@example.com'):
        _,contract = self.draft(customer_email=email)
        self.ok(self.admin,f'/api/contracts/{contract}/send',{})
        return contract

    def test_invite_and_accept_with_a_verified_email(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        member = self.customer(email='staff@example.com',name='สมศรี ตรวจงาน')
        stranger = self.customer(email='stranger@example.com')
        contract = self.sent()
        path = f'{ORG}/contracts/{contract}'
        self.assertEqual(self.status(member,path),404)
        # The form: not yourself, a known role, at least one of your own projects when not all of them.
        self.assertEqual(self.status(owner,f'{ORG}/team',{'email':'owner@example.com','role':'approver'}),400)
        self.assertEqual(self.status(owner,f'{ORG}/team',{'email':'staff@example.com','role':'owner'}),400)
        self.assertEqual(self.status(owner,f'{ORG}/team',{'email':'staff@example.com','role':'approver','all_projects':False,'projects':[]}),400)
        self.assertEqual(self.status(owner,f'{ORG}/team',{'email':'staff@example.com','role':'approver','all_projects':False,'projects':['0'*32]}),400)
        row = self.invite(owner,'STAFF@example.com','approver')
        self.assertEqual(self.status(owner,f'{ORG}/team',{'email':'staff@example.com','role':'finance'}),409)
        mail = self.mailer.call_args
        self.assertEqual(mail.args[2],'staff@example.com')
        self.assertIn('https://bookdose.example.com/customer/team',mail.args[3].get_content())
        waiting = self.ok(member,'/api/customer/overview')['invitations']
        self.assertEqual([(i['id'],i['org_slug'],i['owner_name'],i['role'],i['role_label']) for i in waiting],
                         [(row,'alpha','เจ้าของงาน','approver','ผู้ตรวจรับ/อนุมัติ')])
        self.assertEqual(self.ok(stranger,'/api/customer/overview')['invitations'],[])
        # Only the invited email accepts, and nothing opens before that.
        self.assertEqual(self.status(stranger,f'{ORG}/team/{row}/accept',{}),404)
        self.assertEqual(self.status(owner,f'{ORG}/team/{row}/accept',{}),404)
        self.assertEqual(self.status(member,path),404)
        self.ok(member,f'{ORG}/team/{row}/accept',{})
        self.assertEqual(self.status(member,f'{ORG}/team/{row}/accept',{}),404)
        self.assertEqual(self.ok(member,path)['access'],{'role':'approver','role_label':'ผู้ตรวจรับ/อนุมัติ',
                                                         'can':['documents','review','issues'],'owner_name':'เจ้าของงาน'})
        self.assertEqual(self.ok(owner,path)['access']['can'],['documents','billing','review','decide','issues','team'])
        team = self.ok(owner,f'{ORG}/team')
        self.assertEqual([(m['email'],m['name'],m['status'],m['role'],m['all_projects']) for m in team['mine']['members']],
                         [('staff@example.com','สมศรี ตรวจงาน','active','approver',True)])
        self.assertEqual([p['id'] for p in team['mine']['projects']],[contract])
        self.assertEqual([r['key'] for r in team['roles']],['manager','approver','finance','technical'])
        mine = self.ok(member,f'{ORG}/team')
        self.assertEqual([(m['owner_name'],m['role'],m['all_projects']) for m in mine['memberships']],[('เจ้าของงาน','approver',True)])
        self.assertEqual(mine['mine']['members'],[])
        self.assertEqual(self.ok(member,'/api/customer/overview')['invitations'],[])
        with D.tenant(self.org) as db:
            actions = [r[0] for r in db.execute("SELECT action FROM audit_logs WHERE action LIKE 'client_team.%' ORDER BY id")]
        self.assertEqual(actions,['client_team.invited','client_team.accepted'])
        self.assertEqual(set(self.ok(member,'/api/customer/dashboard')),{'budget','health','sla'})

    def test_accepting_while_the_platform_cannot_send_email(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        contract = self.sent()
        self.no_email()
        early,late = self.unverified('early@example.com'),self.unverified('late@example.com')
        sent = self.mailer.call_count
        row = self.invite(owner,'early@example.com','technical')
        self.assertEqual(self.mailer.call_count,sent)                 # nothing to send it with
        self.ok(early,f'{ORG}/team/{row}/accept',{})                  # the same trust as signing up without email
        self.assertEqual(self.ok(early,f'{ORG}/contracts/{contract}')['access']['role'],'technical')
        # Once email works, an address that was never proven cannot accept.
        other = self.invite(owner,'late@example.com','technical')
        self.enable_registration_mail()
        self.assertEqual(self.ok(late,'/api/customer/overview')['invitations'],[])   # nor learn who invites it, where, as what
        self.assertNotIn('invite',[a['kind'] for a in self.ok(late,'/api/customer/overview')['alerts']])
        self.assertEqual(self.status(late,f'{ORG}/team/{other}/accept',{}),403)
        self.assertEqual(self.status(late,f'{ORG}/contracts/{contract}'),404)

    def test_invitation_email_follows_the_team_preference(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        member = self.customer(email='staff@example.com')
        self.sent()
        self.ok(member,'/api/customer/notification-settings',{'events':{'team':{'email':False}}})
        sent = self.mailer.call_count
        row = self.invite(owner,'staff@example.com','technical')
        self.assertEqual(self.mailer.call_count,sent)                 # the account turned team email off
        self.assertEqual([i['id'] for i in self.ok(member,'/api/customer/overview')['invitations']],[row])
        self.invite(owner,'nobody@example.com','technical')
        self.assertEqual(self.mailer.call_args.args[2],'nobody@example.com')   # no account yet: always emailed

    def test_declining_changing_and_removing(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        member = self.customer(email='staff@example.com')
        contract = self.sent()
        path = f'{ORG}/contracts/{contract}'
        row = self.invite(owner,'staff@example.com','manager')
        self.ok(member,f'{ORG}/team/{row}/decline',{})
        self.assertEqual(self.status(member,f'{ORG}/team/{row}/accept',{}),404)
        self.assertEqual(self.ok(owner,f'{ORG}/team')['mine']['members'][0]['status'],'declined')
        self.assertEqual(self.status(owner,f'{ORG}/team/{row}',{'role':'finance','all_projects':True},'PATCH'),404)
        # Invited again: the same row starts over.
        self.assertEqual(self.invite(owner,'staff@example.com','manager'),row)
        self.ok(member,f'{ORG}/team/{row}/accept',{})
        self.assertEqual(self.ok(member,path)['access']['role'],'manager')
        # A new role applies to the next request.
        self.ok(owner,f'{ORG}/team/{row}',{'role':'finance','all_projects':True},'PATCH')
        rate_limit.RATES.clear()
        self.assertEqual(member.call(path),(403,{'error':'บทบาทฝ่ายการเงินไม่มีสิทธิ์เปิดเอกสารและโครงการนี้'}))
        self.assertEqual(self.ok(member,'/api/customer/overview')['contracts'][0]['can'],['billing'])
        # Only the owner manages the team.
        self.assertEqual(self.status(member,f'{ORG}/team/{row}',None,'DELETE'),404)
        self.ok(owner,f'{ORG}/team/{row}',{'role':'manager','all_projects':True},'PATCH')
        self.assertEqual(self.status(member,path),200)
        # Removed: access ends at once, and the row stays as history.
        self.ok(owner,f'{ORG}/team/{row}',None,'DELETE')
        self.assertEqual(self.status(member,path),404)
        self.assertEqual(self.status(member,f'{path}/ask',{'body':'ยังเปิดได้ไหม'}),404)
        self.assertEqual(self.ok(owner,f'{ORG}/team')['mine']['members'][0]['status'],'removed')
        self.assertEqual(self.ok(member,'/api/customer/overview')['contracts'],[])
        self.assertEqual(self.ok(member,f'{ORG}/team')['memberships'],[])
        self.assertEqual(self.status(owner,f'{ORG}/team/{row}',None,'DELETE'),404)

    def test_what_each_role_may_do(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        people = {role:self.customer(email=f'{role}@example.com',name=name) for role,name in
                  (('manager','มานพ ดูแล'),('approver','อารี ตรวจรับ'),('finance','การเงิน ใจดี'),('technical','ไอที เก่งมาก'))}
        owner,contract = self.signed([{'kind':'delivery','title':'ออกแบบระบบ','due_date':'2026-11-30','amount':'100000'},
                                      {'kind':'payment','title':'งวดสุดท้าย','due_date':'','amount':'20000'}],customer_email='owner@example.com')
        for role,client in people.items():
            self.join(owner,client,f'{role}@example.com',role)
        path = f'{ORG}/contracts/{contract}'
        design,final = self.project(owner,contract)['milestones']
        self.ok(self.admin,f'/api/contracts/{contract}/milestones/{design["id"]}/deliver',{'note':'แบบหน้าจอ','files':[{'name':'design.pdf','data':PDF}]})
        delivered = self.project(owner,contract)['deliveries'][0]['files'][0]['id']
        self.assertEqual(len(self.ok(people['manager'],'/api/customer/overview')['deliveries']),1)
        self.assertEqual(self.ok(people['approver'],'/api/customer/overview')['deliveries'],[])
        # The final decision: the owner and the manager only.
        accept = f'{path}/milestones/{design["id"]}/accept'
        for role in ('approver','finance','technical'):
            self.assertEqual(self.status(people[role],accept,{}),403)
        self.assertEqual(self.status(people['approver'],f'{path}/milestones/{design["id"]}/reject',{'remark':'ขอแก้สี'}),403)
        self.assertEqual(self.status(people['approver'],f'{path}/renewal',{}),403)
        invoice = self.ok(people['manager'],accept,{})['invoice_id']
        # Money: the finance role, not the technical one.
        self.assertEqual(self.status(people['finance'],f'{path}/invoices/{invoice}'),200)
        self.assertEqual(self.status(people['finance'],f'{ORG}/invoices/{invoice}'),200)
        self.assertEqual(self.status(people['finance'],path),403)
        self.assertEqual(self.status(people['technical'],f'{path}/invoices/{invoice}'),403)
        self.assertEqual(self.status(people['technical'],f'{ORG}/invoices/{invoice}'),403)
        self.assertEqual(self.status(people['technical'],f'{path}/buyer',{'name':'บริษัท ลูกค้า จำกัด'}),403)
        self.ok(people['finance'],f'{path}/buyer',{'name':'บริษัท ลูกค้า จำกัด'})
        self.ok(people['finance'],f'{path}/invoices/{invoice}/slip',{'files':[{'name':'slip.png','data':PNG}]})
        slip = self.ok(people['finance'],f'{path}/invoices/{invoice}')['slips'][0]['id']
        self.assertEqual(self.status(people['finance'],f'{path}/files/{slip}'),200)
        self.assertEqual(self.status(people['technical'],f'{path}/files/{slip}'),403)
        self.assertEqual(self.status(people['technical'],f'{path}/files/{delivered}'),200)
        self.assertEqual(self.status(people['finance'],f'{path}/files/{delivered}'),403)
        seen = self.ok(people['technical'],path)
        self.assertEqual((seen['project']['invoices'],seen['project']['totals'],seen['project']['buyer']),([],None,None))
        self.assertNotIn('invoiced',[e['action'] for e in seen['events']])
        managed = self.ok(people['manager'],path)
        self.assertEqual((len(managed['project']['invoices']),managed['project']['buyer']['name']),(1,'บริษัท ลูกค้า จำกัด'))
        self.assertIn('invoiced',[e['action'] for e in managed['events']])
        # Problems and change requests: whoever has documents and issues.
        issue = {'kind':'bug','subject':'ปุ่มค้นหาไม่ทำงาน','body':'กดแล้วไม่มีผล'}
        self.assertEqual(self.status(people['finance'],f'{path}/issues',issue),403)
        self.ok(people['approver'],f'{path}/issues',issue)
        # The overview: each row carries the owner and the viewer's role; invoices only with billing.
        technical = self.ok(people['technical'],'/api/customer/overview')
        row = technical['contracts'][0]
        self.assertEqual((row['id'],row['owner_name'],row['role'],row['role_label'],row['can']),
                         (contract,'เจ้าของงาน','technical','ฝ่ายเอกสาร/IT',['documents','issues']))
        self.assertEqual(technical['invoices'],[])
        finance = self.ok(people['finance'],'/api/customer/overview')
        self.assertEqual(([i['id'] for i in finance['invoices']],finance['contracts'][0]['can']),([invoice],['billing']))
        mine = self.ok(owner,'/api/customer/overview')['contracts'][0]
        self.assertEqual((mine['role'],mine['owner_id']),('owner',row['owner_id']))
        # An invoice email reaches the owner and the members with billing.
        self.enable_registration_mail()
        before = self.mailer.call_count
        self.ok(self.admin,f'/api/contracts/{contract}/milestones/{final["id"]}/invoice',{})
        told = sorted(call.args[2] for call in self.mailer.call_args_list[before:])
        self.assertEqual(told,['finance@example.com','manager@example.com','owner@example.com'])
        self.assertIn('/customer/billing/alpha/',self.mailer.call_args.args[3].get_content())

    def test_an_approver_cannot_sign_and_a_manager_signs_as_themself(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        approver = self.customer(email='approver@example.com',name='อารี ตรวจรับ')
        manager = self.customer(email='manager@example.com',name='มานพ ดูแล')
        contract = self.sent()
        self.join(owner,approver,'approver@example.com','approver')
        self.join(owner,manager,'manager@example.com','manager')
        self.no_email()
        path = f'{ORG}/contracts/{contract}'
        sign = {'agree':True,'name':'มานพ ดูแล','method':'type','mark':'มานพ ดูแล','password':self.CUSTOMER_PASSWORD}
        self.assertEqual(self.status(approver,f'{path}/otp',{}),403)
        self.assertEqual(self.status(approver,f'{path}/sign',sign),403)
        self.assertEqual(self.status(approver,f'{path}/changes',{'note':'ขอแก้งวดที่ 1'}),403)
        self.assertEqual(self.ok(manager,f'{path}/otp',{})['method'],'password')
        self.ok(manager,f'{path}/sign',sign)
        signature = next(s for s in self.ok(self.admin,f'/api/contracts/{contract}')['signatures'] if s['party']=='customer')
        self.assertEqual((signature['signer_name'],signature['signer_email']),('มานพ ดูแล','manager@example.com'))
        # Emails of the customer side: the owner sees them, a member only their own (the team page shows them to the owner only).
        seen = lambda client:(self.ok(client,path)['contract']['customer_email'],
                              next(s['signer_email'] for s in self.ok(client,path)['signatures'] if s['party']=='customer'))
        self.assertEqual(seen(owner),('owner@example.com','manager@example.com'))
        self.assertEqual(seen(manager),('o***@example.com','manager@example.com'))
        self.assertEqual(seen(approver),('o***@example.com','m***@example.com'))
        self.assertNotIn('signer_id',self.ok(approver,path)['signatures'][0])
        with D.tenant(self.org) as db:
            signer = db.execute("SELECT signer_id FROM contract_signatures WHERE party='customer'").fetchone()[0]
        with D.control() as cd:
            self.assertEqual(signer,cd.execute("SELECT id FROM customer_accounts WHERE email='manager@example.com'").fetchone()[0])
        self.assertEqual(self.ok(owner,path)['contract']['status'],'awaiting_org')

    def test_members_see_only_the_projects_they_are_given(self):
        self.customer(email='owner@example.com',name='เจ้าของงาน')
        member = self.customer(email='staff@example.com',name='สมศรี ตรวจงาน')
        owner,first = self.signed([{'kind':'delivery','title':'ติดตั้งระบบ','due_date':'','amount':''}],warranty=30,customer_email='owner@example.com')
        second = self.sent()
        self.assertEqual({p['id'] for p in self.ok(owner,f'{ORG}/team')['mine']['projects']},{first,second})
        row = self.join(owner,member,'staff@example.com','manager',all_projects=False,projects=[first])
        self.assertEqual(self.status(member,f'{ORG}/contracts/{first}'),200)
        self.assertEqual(self.status(member,f'{ORG}/contracts/{second}'),404)
        # The MA renewal follows its project: the member may ask for it, and sees the MA contract.
        milestone = self.project(owner,first)['milestones'][0]
        self.ok(self.admin,f'/api/contracts/{first}/milestones/{milestone["id"]}/deliver',{'note':'ติดตั้งแล้ว'})
        self.ok(member,f'{ORG}/contracts/{first}/milestones/{milestone["id"]}/accept',{})
        self.ok(member,f'{ORG}/contracts/{first}/renewal',{'note':'ต่อ 1 ปี'})
        _,ma = self.signed([{'kind':'payment','title':'ค่าบริการปีแรก','due_date':'','amount':'24000'}],warranty=365,
                           customer_email='owner@example.com',renews=(owner,first))
        self.assertEqual(self.ok(member,f'{ORG}/contracts/{ma}')['access']['role'],'manager')
        self.assertEqual({c['id'] for c in self.ok(member,'/api/customer/overview')['contracts']},{first,ma})
        # An MA contract is not given on its own; the second project is.
        self.assertEqual(self.status(owner,f'{ORG}/team/{row}',{'role':'manager','all_projects':False,'projects':[ma]},'PATCH'),400)
        self.ok(owner,f'{ORG}/team/{row}',{'role':'manager','all_projects':False,'projects':[first,second]},'PATCH')
        self.assertEqual(self.status(member,f'{ORG}/contracts/{second}'),200)

    def test_another_owners_documents_stay_out_of_reach(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        other = self.customer(email='other@example.com',name='เจ้าของอีกราย')
        member = self.customer(email='staff@example.com')
        mine,theirs = self.sent(),self.sent('other@example.com')
        row = self.join(owner,member,'staff@example.com','manager')
        self.assertEqual(self.status(member,f'{ORG}/contracts/{theirs}'),404)
        self.assertEqual([c['id'] for c in self.ok(member,'/api/customer/overview')['contracts']],[mine])
        # The other owner neither sees nor manages this team, nor gives away documents that are not theirs.
        self.assertEqual(self.ok(other,f'{ORG}/team')['mine']['members'],[])
        self.assertEqual(self.status(other,f'{ORG}/team/{row}',{'role':'finance','all_projects':True},'PATCH'),404)
        self.assertEqual(self.status(other,f'{ORG}/team/{row}',None,'DELETE'),404)
        self.assertEqual(self.status(other,f'{ORG}/team',{'email':'new@example.com','role':'manager','all_projects':False,'projects':[mine]}),400)
        self.assertEqual(self.status(other,f'{ORG}/contracts/{mine}'),404)

    def test_each_member_has_their_own_document_chat(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        member = self.customer(email='staff@example.com',name='สมศรี ตรวจงาน')
        contract = self.sent()
        self.join(owner,member,'staff@example.com','technical')
        path = f'{ORG}/contracts/{contract}'
        theirs = self.ok(member,f'{path}/ask',{'body':'ต้องเตรียมเอกสารอะไรบ้าง'})['conversation_id']
        self.assertEqual(self.ok(member,f'{path}/ask',{'body':'ขอถามเพิ่มเติม'})['conversation_id'],theirs)
        owners = self.ok(owner,f'{path}/ask',{'body':'คำถามของเจ้าของ'})['conversation_id']
        self.assertNotEqual(theirs,owners)
        self.assertEqual(self.ok(member,path)['contract']['conversation_id'],theirs)
        self.assertEqual(self.ok(owner,path)['contract']['conversation_id'],owners)
        self.assertEqual(self.ok(self.admin,f'/api/contracts/{contract}')['contract']['conversation_id'],owners)
        member.conversation = owners
        self.assertEqual(self.status(member,f'{ORG}/session'),404)
        member.conversation = theirs
        self.assertEqual([m['body'] for m in self.ok(member,f'{ORG}/session')['messages'] if m['kind']=='customer'],
                         ['ต้องเตรียมเอกสารอะไรบ้าง','ขอถามเพิ่มเติม'])

    # Approval flows
    def reviewers(self, owner):
        """{name: account id} of the people the owner can put in a flow."""
        return {p['name']:p['account_id'] for p in self.ok(owner,f'{ORG}/team/flows')['reviewers']}

    def told(self, since, words):
        """Recipients of the emails sent since `since` whose text has these words."""
        return [c.args[2] for c in self.mailer.call_args_list[since:] if words in c.args[3].get_content()]

    def test_a_delivery_goes_through_the_reviewers_before_the_decision(self):
        self.customer(email='owner@example.com',name='เจ้าของงาน')
        pm = self.customer(email='pm@example.com',name='พิม ตรวจงาน')
        manager = self.customer(email='manager@example.com',name='มานพ ดูแล')
        owner,contract = self.signed([{'kind':'delivery','title':'ออกแบบระบบ','due_date':'2026-11-30','amount':''}],customer_email='owner@example.com')
        self.join(owner,pm,'pm@example.com','approver')
        self.join(owner,manager,'manager@example.com','manager')
        people = self.reviewers(owner)
        self.assertEqual(set(people),{'เจ้าของงาน','พิม ตรวจงาน','มานพ ดูแล'})
        # Each person once, only people who may review.
        self.assertEqual(self.status(owner,f'{ORG}/team/flows',{'delivery':[people['พิม ตรวจงาน']]*2}),400)
        self.assertEqual(self.status(owner,f'{ORG}/team/flows',{'delivery':['0'*32]}),400)
        self.ok(owner,f'{ORG}/team/flows',{'delivery':[people['พิม ตรวจงาน'],people['มานพ ดูแล']]})
        self.assertEqual(self.ok(owner,f'{ORG}/team/flows')['contract'],[])
        design = self.project(owner,contract)['milestones'][0]
        path = f'{ORG}/contracts/{contract}'
        accept,review = f'{path}/milestones/{design["id"]}/accept',f'{path}/milestones/{design["id"]}/review'
        self.enable_registration_mail()
        before = self.mailer.call_count
        self.ok(self.admin,f'/api/contracts/{contract}/milestones/{design["id"]}/deliver',{'note':'แบบหน้าจอ'})
        self.assertEqual(self.told(before,'รอคุณตรวจเป็นขั้นที่ 1/2'),['pm@example.com'])
        self.assertEqual(self.told(before,'ตรวจงานแล้วกดอนุมัติรับงาน'),[])      # the deciders hear once every step approved
        run = self.ok(pm,path)['approval']['deliveries'][design['id']]
        self.assertEqual((run['current'],run['my_turn'],run['ready'],run['can_decide'],[s['name'] for s in run['steps']]),
                         (1,True,False,False,['พิม ตรวจงาน','มานพ ดูแล']))
        self.assertFalse(self.ok(manager,path)['approval']['deliveries'][design['id']]['my_turn'])
        staff = self.ok(self.admin,f'/api/contracts/{contract}')['approval']['deliveries'][design['id']]
        self.assertEqual((staff['current'],staff['my_turn']),(1,False))
        # Nobody decides before the reviewers, and nobody reviews out of turn.
        rate_limit.RATES.clear()
        self.assertEqual(owner.call(accept,{}),(409,{'error':'ยังรอการตรวจตามขั้นตอนอนุมัติ: ขั้นที่ 1/2 คุณพิม ตรวจงาน, ขั้นที่ 2/2 คุณมานพ ดูแล'}))
        self.assertEqual(self.status(manager,review,{'decision':'approved'}),409)
        self.assertEqual(self.status(owner,review,{'decision':'approved'}),409)
        items = self.ok(pm,'/api/customer/approvals')['items']
        self.assertEqual([(i['target'],i['contract_id'],i['milestone_title'],i['step'],i['steps'],i['final'],i['org_slug'],i['org_name'],i['title'])
                          for i in items],[('delivery',contract,'ออกแบบระบบ',1,2,False,'alpha','องค์กร A','ระบบห้องสมุดดิจิทัล')])
        self.assertEqual(self.ok(manager,'/api/customer/approvals')['items'],[])
        self.assertEqual(self.ok(owner,'/api/customer/approvals')['items'],[])
        # The flow is fixed when the work arrives: emptying it now changes nothing in this review.
        self.ok(owner,f'{ORG}/team/flows',{'delivery':[]})
        before = self.mailer.call_count
        self.ok(pm,review,{'decision':'approved','remark':'ครบตาม TOR'})
        self.assertEqual(self.told(before,'รอคุณตรวจเป็นขั้นที่ 2/2'),['manager@example.com'])
        self.assertEqual(self.status(pm,review,{'decision':'approved'}),409)
        self.assertEqual(self.status(owner,accept,{}),409)
        self.assertEqual([i['step'] for i in self.ok(manager,'/api/customer/approvals')['items']],[2])
        before = self.mailer.call_count
        self.ok(manager,review,{'decision':'approved'})
        self.assertEqual(sorted(self.told(before,'ผ่านการตรวจครบ 2 ขั้นแล้ว')),['manager@example.com','owner@example.com'])
        run = self.ok(owner,path)['approval']['deliveries'][design['id']]
        self.assertEqual((run['current'],run['ready'],run['can_decide'],[s['decision'] for s in run['steps']]),(None,True,True,['approved','approved']))
        self.assertEqual([(i['final'],i['step'],i['steps']) for i in self.ok(owner,'/api/customer/approvals')['items']],[(True,2,2)])
        self.assertEqual(self.ok(pm,'/api/customer/approvals')['items'],[])
        self.assertEqual(self.status(pm,accept,{}),403)
        self.ok(owner,accept,{})
        seen = self.ok(owner,path)
        self.assertEqual([e['detail'] for e in seen['events'] if e['action']=='reviewed'],
                         ['ออกแบบระบบ · ขั้นที่ 1/2 · พิม ตรวจงาน: ผ่านการตรวจ · ครบตาม TOR','ออกแบบระบบ · ขั้นที่ 2/2 · มานพ ดูแล: ผ่านการตรวจ'])
        self.assertEqual((seen['approval']['deliveries'],seen['project']['milestones'][0]['status']),({},'done'))
        self.assertEqual(self.ok(owner,'/api/customer/approvals')['items'],[])

    def test_a_reviewer_sends_a_delivery_back(self):
        self.customer(email='owner@example.com',name='เจ้าของงาน')
        pm = self.customer(email='pm@example.com',name='พิม ตรวจงาน')
        owner,contract = self.signed([{'kind':'delivery','title':'ติดตั้งระบบ','due_date':'','amount':''}],customer_email='owner@example.com')
        self.join(owner,pm,'pm@example.com','approver')
        people = self.reviewers(owner)
        # This project's own flow (the owner only); the default stays empty.
        flow = f'{ORG}/contracts/{contract}/flow'
        self.assertEqual(self.status(pm,flow),403)
        self.assertEqual(self.status(pm,flow,{'kind':'delivery','steps':[]}),403)
        self.ok(owner,flow,{'kind':'delivery','steps':[people['พิม ตรวจงาน']]})
        got = self.ok(owner,flow)
        self.assertEqual((got['delivery'],got['default']['delivery'],got['contract']['use_default']),
                         ({'use_default':False,'steps':[people['พิม ตรวจงาน']]},[],True))
        milestone = self.project(owner,contract)['milestones'][0]
        path = f'{ORG}/contracts/{contract}'
        review,accept = f'{path}/milestones/{milestone["id"]}/review',f'{path}/milestones/{milestone["id"]}/accept'
        deliver = f'/api/contracts/{contract}/milestones/{milestone["id"]}/deliver'
        self.ok(self.admin,deliver,{'note':'ติดตั้งแล้ว'})
        self.assertEqual(self.status(pm,review,{'decision':'returned'}),400)
        self.assertEqual(self.status(pm,review,{'decision':'maybe'}),400)
        # Sent back: exactly the decider's own refusal (the round rejected, the milestone in revision, the remark in the chat).
        conversation = self.ok(pm,review,{'decision':'returned','remark':'ขอแก้สีปุ่ม'})['conversation_id']
        project = self.project(owner,contract)
        self.assertEqual((project['milestones'][0]['status'],project['deliveries'][0]['decision'],project['deliveries'][0]['remark']),
                         ('revision','rejected','ขอแก้สีปุ่ม'))
        self.assertEqual([(e['action'],e['detail']) for e in self.ok(owner,path)['events'] if e['action'] in ('review_returned','rejected')],
                         [('review_returned','ติดตั้งระบบ · ขั้นที่ 1/1 · พิม ตรวจงาน: ส่งกลับแก้ไข · ขอแก้สีปุ่ม'),('rejected','ติดตั้งระบบ · ขอแก้สีปุ่ม')])
        self.assertEqual(self.ok(pm,path)['contract']['conversation_id'],conversation)
        self.assertEqual(self.ok(pm,'/api/customer/approvals')['items'],[])
        # The next round starts over from step 1, with the flow it found.
        self.ok(self.admin,deliver,{'note':'แก้สีแล้ว'})
        run = self.ok(pm,path)['approval']['deliveries'][milestone['id']]
        self.assertEqual((run['current'],run['my_turn'],[s['decision'] for s in run['steps']]),(1,True,[None]))
        self.ok(owner,flow,{'kind':'delivery','use_default':True})
        self.assertEqual(self.ok(owner,flow)['delivery'],{'use_default':True,'steps':[]})
        self.assertEqual(self.status(owner,accept,{}),409)
        self.ok(pm,review,{'decision':'approved'})
        self.ok(owner,accept,{})

    def test_a_contract_waits_for_its_reviewers_before_signing(self):
        owner = self.customer(email='owner@example.com',name='เจ้าของงาน')
        legal = self.customer(email='legal@example.com',name='ลีลา กฎหมาย')
        self.join(owner,legal,'legal@example.com','approver')
        self.ok(owner,f'{ORG}/team/flows',{'contract':[self.reviewers(owner)['ลีลา กฎหมาย']]})
        before = self.mailer.call_count
        contract = self.sent()
        self.assertEqual(self.told(before,'รอคุณตรวจเป็นขั้นที่ 1/1'),['legal@example.com'])
        self.assertEqual(self.told(before,'หรือลงนามได้ที่'),[])                  # nobody can sign before the review
        path = f'{ORG}/contracts/{contract}'
        self.no_email()
        sign = {'agree':True,'name':'เจ้าของงาน','method':'type','mark':'เจ้าของงาน','password':self.CUSTOMER_PASSWORD}
        self.assertEqual(self.status(owner,f'{path}/otp',{}),409)
        rate_limit.RATES.clear()
        self.assertEqual(owner.call(f'{path}/sign',sign),(409,{'error':'ยังรอการตรวจตามขั้นตอนอนุมัติ: ขั้นที่ 1/1 คุณลีลา กฎหมาย'}))
        seen = self.ok(owner,path)['approval']['contract']
        self.assertEqual((seen['current'],seen['my_turn'],seen['ready'],seen['can_decide']),(1,False,False,True))
        self.assertEqual(self.ok(self.admin,f'/api/contracts/{contract}')['approval']['contract']['current'],1)
        self.assertTrue(self.ok(legal,path)['approval']['contract']['my_turn'])
        self.assertEqual([(i['target'],i['milestone_id'],i['final']) for i in self.ok(legal,'/api/customer/approvals')['items']],[('contract',None,False)])
        # Sent back: the contract waits for a new version, whose review starts over.
        self.ok(legal,f'{path}/review',{'decision':'returned','remark':'ขอแก้ข้อ 5'})
        seen = self.ok(owner,path)
        self.assertEqual((seen['contract']['status'],seen['approval']['contract']),('changes',None))
        self.assertEqual([e['action'] for e in seen['events'] if e['action'] in ('review_returned','change_requested')],['review_returned','change_requested'])
        self.assertEqual(self.status(legal,f'{path}/review',{'decision':'approved'}),409)
        self.ok(self.admin,f'/api/contracts/{contract}/revise',{'note':'แก้ข้อ 5'})
        self.ok(self.admin,f'/api/contracts/{contract}/send',{})
        run = self.ok(legal,path)['approval']['contract']
        self.assertEqual((run['current'],run['my_turn'],[s['decision'] for s in run['steps']]),(1,True,[None]))
        self.assertEqual(self.status(owner,f'{path}/sign',sign),409)
        self.ok(legal,f'{path}/review',{'decision':'approved'})
        self.assertTrue(self.ok(owner,path)['approval']['contract']['ready'])
        self.assertEqual([i['final'] for i in self.ok(owner,'/api/customer/approvals')['items']],[True])
        self.ok(owner,f'{path}/otp',{})
        self.ok(owner,f'{path}/sign',sign)
        seen = self.ok(owner,path)
        self.assertEqual((seen['contract']['status'],seen['approval']['contract']),('awaiting_org',None))
        self.assertEqual([e['detail'] for e in seen['events'] if e['action']=='reviewed'],['ขั้นที่ 1/1 · ลีลา กฎหมาย: ผ่านการตรวจ'])

    def test_a_reviewer_who_leaves_leaves_the_flows(self):
        self.customer(email='owner@example.com',name='เจ้าของงาน')
        pm = self.customer(email='pm@example.com',name='พิม ตรวจงาน')
        manager = self.customer(email='manager@example.com',name='มานพ ดูแล')
        owner,contract = self.signed([{'kind':'delivery','title':'ติดตั้งระบบ','due_date':'','amount':''}],customer_email='owner@example.com')
        pm_row = self.join(owner,pm,'pm@example.com','approver')
        manager_row = self.join(owner,manager,'manager@example.com','manager')
        people = self.reviewers(owner)
        self.ok(owner,f'{ORG}/team/flows',{'delivery':[people['พิม ตรวจงาน'],people['มานพ ดูแล']],'contract':[people['มานพ ดูแล']]})
        milestone = self.project(owner,contract)['milestones'][0]
        path = f'{ORG}/contracts/{contract}'
        self.ok(self.admin,f'/api/contracts/{contract}/milestones/{milestone["id"]}/deliver',{'note':'ติดตั้งแล้ว'})
        self.ok(pm,f'{path}/milestones/{milestone["id"]}/review',{'decision':'approved'})
        # Removed after approving: the approved step stays as history, the flow forgets them.
        self.ok(owner,f'{ORG}/team/{pm_row}',None,'DELETE')
        run = self.ok(manager,path)['approval']['deliveries'][milestone['id']]
        self.assertEqual(([(s['name'],s['decision']) for s in run['steps']],run['current'],run['my_turn']),
                         ([('พิม ตรวจงาน','approved'),('มานพ ดูแล',None)],2,True))
        flows = self.ok(owner,f'{ORG}/team/flows')
        self.assertEqual((flows['delivery'],flows['contract']),([people['มานพ ดูแล']],[people['มานพ ดูแล']]))
        # A role without review: out of the flows and of the steps still to come; nothing is left to wait for.
        self.ok(owner,f'{ORG}/team/{manager_row}',{'role':'finance','all_projects':True},'PATCH')
        self.assertEqual(self.ok(owner,path)['approval']['deliveries'][milestone['id']]['ready'],True)
        flows = self.ok(owner,f'{ORG}/team/flows')
        self.assertEqual((flows['delivery'],flows['contract'],set(p['name'] for p in flows['reviewers'])),([],[],{'เจ้าของงาน'}))
        self.assertEqual(self.status(owner,f'{ORG}/team/flows',{'delivery':[people['มานพ ดูแล']]}),400)
        self.ok(owner,f'{path}/milestones/{milestone["id"]}/accept',{})


if __name__=='__main__':
    unittest.main()
