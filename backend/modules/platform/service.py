"""Platform administration: creating organizations (tenants), suspending them, and the email account that sends
self-registration verification links."""
import json

from backend.database import audit, db as D, schema as tables
from backend.database.seed import seed_demo
from backend.modules.auth import repository as users
from backend.modules.organization import repository as organization
from backend.modules.platform import repository, schema
from backend.utils.security import uid
from backend.utils.validation import require


def create_tenant(cd, name, slug, admin_id, demo=False):
    """Create an organization with its own database, a default team and `admin_id` as admin; returns its id.
    Used by first-run setup, self-registration and platform admins."""
    tenant_id, team_id = uid(), uid()
    repository.insert_tenant(cd,tenant_id,name,slug)
    with D.create_tenant_database(tenant_id) as td:
        tables.create_tenant_tables(td)
        organization.insert_team(td,team_id,'Customer Success')
        if demo:
            seed_demo(td,admin_id,team_id)
        audit.record(td,'ระบบ','organization.created',tenant_id,name)
    organization.insert_membership(cd,tenant_id,admin_id,'admin',team_id)
    audit.record(cd,admin_id,'tenant.created',tenant_id,name)
    return tenant_id


def list_tenants(cd):
    return {'tenants':repository.list_with_member_count(cd),
            'audit':audit.with_names(cd,audit.latest(cd,100))}


def add_tenant(cd, body):
    """Create an organization; an existing account with the admin email is reused without changing its password."""
    name,slug = schema.tenant_form(body)
    require(not repository.slug_taken(cd,slug),'รหัสองค์กรนี้มีอยู่แล้ว',409)
    email = schema.admin_email(body)
    user = users.find_user_by_email(cd,email)
    if user:
        admin_id = user['id']
    else:
        admin_id = uid()
        admin_name,password = schema.new_admin(body)
        users.insert_user(cd,admin_id,admin_name,email,password)
    tid = create_tenant(cd,name,slug,admin_id,False)
    cd.commit()
    return tid


def set_tenant_status(cd, session, tenant_id, body):
    status = schema.tenant_status(body)
    org = repository.find_tenant(cd,tenant_id)
    require(org,'ไม่พบองค์กร',404)
    if status=='suspended':
        schema.suspension_confirmed(body,org)
    repository.set_status(cd,tenant_id,status)
    audit.record(cd,session['name'],'tenant.'+status,tenant_id)
    cd.commit()


def grant_support_access(cd, session, tenant_id, body):
    """A platform admin joins an organization as a manager to help its team. Never silent: the reason goes to the
    platform history and to the organization's own history, and only the organization's admins can remove it
    (a removed access cannot be taken back from here)."""
    reason = schema.support_reason(body)
    D.begin(cd)
    require(repository.find_tenant(cd,tenant_id),'ไม่พบองค์กร',404)
    require(repository.is_active(cd,tenant_id),'องค์กรนี้ถูกระงับอยู่',409)
    user_id = session['user_id']
    membership = organization.find_membership(cd,tenant_id,user_id)
    if membership:
        require(False,'คุณเป็นสมาชิกขององค์กรนี้อยู่แล้ว' if membership['active'] else 'ผู้ดูแลองค์กรปิดสิทธิ์ของคุณไว้ ต้องให้ผู้ดูแลองค์กรเปิดคืน',409)
    with D.tenant(tenant_id) as td:
        organization.insert_membership(cd,tenant_id,user_id,'manager',organization.first_team_id(td))
        audit.record(td,session['name'],'tenant.support_access',user_id,reason)
    audit.record(cd,user_id,'tenant.support_access',tenant_id,reason)
    cd.commit()


# Registration email
def registration_secret():
    return repository.read_registration_secret()


def registration_config(db):
    value = repository.registration_mail(db)
    return json.loads(value) if value else {'enabled':False,'smtp_port':465}


def registration_ready(db):
    return bool(registration_config(db).get('enabled') and registration_secret().get('password'))


def registration_public_config(db):
    return {**registration_config(db),'has_password':bool(registration_secret().get('password'))}


def save_registration_settings(cd, session, body):
    """A changed server or username drops the saved password unless a new one is given."""
    cfg,password = schema.registration_mail(body)
    old = registration_config(cd)
    old_secret = registration_secret()
    if any(old.get(k)!=cfg.get(k) for k in ('smtp_host','smtp_port','username')):
        old_secret = {}
    secret = {'password':password} if password else old_secret
    if cfg['enabled']:
        schema.check_enabled_registration_mail(cfg,secret)
    repository.write_registration_secret(secret)
    repository.save_registration_mail(cd,json.dumps(cfg))
    audit.record(cd,session['user_id'],'registration.settings_updated','platform')
    cd.commit()
    return registration_public_config(cd)
