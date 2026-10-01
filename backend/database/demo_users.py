"""Test accounts for a fresh copy: `python app.py --demo-users` on an EMPTY data folder does first-run setup with known
accounts, so a tester signs in straight away instead of making their own. The passwords are test passwords kept in
the repository - never the real ones of these emails - so use this only on a copy for testing, never on a server
that real customers use.

  platform owner   teerawat@bookdose.com      Platform-owner-123   (the platform's own organization: Bookdose)
  platform admin   mildppgd@gmail.com         Platform-admin-123
  org admin        org.admin@example.com      Org-admin-123        (องค์กรทดสอบ, with sample cases and articles)
  org agent        org.agent@example.com      Org-agent-123
  customer         customer.test@example.com  Customer-test-123   (connected with องค์กรทดสอบ)
"""
from backend.database import db as D
from backend.modules.auth import repository as users
from backend.modules.customers import repository as customers, service as customer_service
from backend.modules.customers.model import CONSENT_VERSION
from backend.modules.organization import repository as organization
from backend.modules.platform import repository as tenants, service as platform
from backend.utils.dates import now
from backend.utils.security import password_hash, uid

OWNER = ('Teerawat Sethsathien', 'teerawat@bookdose.com', 'Platform-owner-123')
PLATFORM_ADMIN = ('Rinrada Laiad', 'mildppgd@gmail.com', 'Platform-admin-123')
ORG_ADMIN = ('แอดมินองค์กรทดสอบ', 'org.admin@example.com', 'Org-admin-123')
ORG_AGENT = ('เจ้าหน้าที่องค์กรทดสอบ', 'org.agent@example.com', 'Org-agent-123')
CUSTOMER = ('ลูกค้าทดสอบ', 'customer.test@example.com', 'Customer-test-123', '081-234-5678')
ACCOUNTS = (OWNER, PLATFORM_ADMIN, ORG_ADMIN, ORG_AGENT, CUSTOMER)


def create_demo_users():
    """Make the accounts above; refuses (ValueError) when the data folder already has accounts."""
    with D.control() as cd:
        if users.count_users(cd):
            raise ValueError('This data folder already has accounts. Point BOOKDOSE_DATA at an empty folder first.')
        D.begin(cd)
        owner_id = uid()
        users.insert_user(cd,owner_id,OWNER[0],OWNER[1],password_hash(OWNER[2]),platform_admin=True)
        tenants.save_setting(cd,'platform_owner',owner_id)
        # As first-run setup: the platform's own organization has no member, its admin is invited from the console.
        platform.create_tenant(cd,'Bookdose','bookdose',None)
        users.insert_user(cd,uid(),PLATFORM_ADMIN[0],PLATFORM_ADMIN[1],password_hash(PLATFORM_ADMIN[2]),platform_admin=True)
        admin_id, agent_id = uid(), uid()
        users.insert_user(cd,admin_id,ORG_ADMIN[0],ORG_ADMIN[1],password_hash(ORG_ADMIN[2]))
        tenant_id = platform.create_tenant(cd,'องค์กรทดสอบ','test-org',admin_id,demo=True)
        users.insert_user(cd,agent_id,ORG_AGENT[0],ORG_AGENT[1],password_hash(ORG_AGENT[2]))
        with D.tenant(tenant_id) as td:
            team_id = organization.first_team_id(td)
        organization.insert_membership(cd,tenant_id,agent_id,'agent',team_id)
        account_id = uid()
        name,email,password,phone = CUSTOMER
        customers.insert_account(cd,account_id,{'name':name,'email':email,'phone':phone,'password':password_hash(password),
                                                'consent_version':CONSENT_VERSION,'consent_at':now()})
        cd.commit()
        customer_service._join(cd,account_id,tenants.find_active(cd,tenant_id))
    return ACCOUNTS
