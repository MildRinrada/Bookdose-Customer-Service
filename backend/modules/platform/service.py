"""Platform administration: creating organizations (tenants), suspending them, the email account that sends
self-registration verification links, the system overview of the platform console and the global FAQ."""
import json
import platform as host
import shutil

from backend.database import audit, db as D, schema as tables
from backend.database.seed import seed_demo
from backend.extensions import monitor
from backend.modules.auth import repository as users
from backend.modules.organization import repository as organization
from backend.modules.platform import repository, schema
from backend.modules.security import events
from backend.utils.security import uid
from backend.utils.validation import require


def create_tenant(cd, name, slug, admin_id, demo=False):
    """Create an organization with its own database, a default team and `admin_id` as admin; returns its id.
    Used by first-run setup, self-registration and platform admins."""
    tenant_id, team_id = uid(), uid()
    repository.insert_tenant(cd,tenant_id,name,slug)
    # The platform's own organization is fixed once: the first one (on an older installation, the oldest one).
    if not repository.setting(cd,'home_tenant'):
        repository.save_setting(cd,'home_tenant',repository.home_organization(cd)['id'])
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


def home_tenant_id(cd):
    """The id of the platform's own organization (the one first-run setup made)."""
    return repository.setting(cd,'home_tenant') or (repository.home_organization(cd) or {}).get('id')


def set_tenant_status(cd, session, tenant_id, body):
    status = schema.tenant_status(body)
    org = repository.find_tenant(cd,tenant_id)
    require(org,'ไม่พบองค์กร',404)
    if status=='suspended':
        # The platform's own organization is where every customer signs up and signs in on the main page; with it
        # suspended, the oldest other organization would quietly take its place (repository.home_organization).
        require(tenant_id!=home_tenant_id(cd),'ระงับองค์กรหลักของแพลตฟอร์มไม่ได้ เพราะลูกค้าทุกคนสมัครและเข้าสู่ระบบผ่านองค์กรนี้',409)
        schema.suspension_confirmed(body,org)
    repository.set_status(cd,tenant_id,status)
    audit.record(cd,session['name'],'tenant.'+status,tenant_id)
    cd.commit()


# System overview
def _bytes(path):
    """Size of a SQLite file with its journal files, or of every file in a folder."""
    if path.is_dir():
        return sum(f.stat().st_size for f in path.rglob('*') if f.is_file())
    return sum(p.stat().st_size for p in (path,path.with_name(path.name+'-wal'),path.with_name(path.name+'-shm')) if p.is_file())


def system_overview(cd):
    """Server health, API usage since the server started, background work waiting in every active organization,
    and the latest errors and platform events."""
    snap = monitor.snapshot()
    orgs = repository.list_with_member_count(cd)
    names = {o['id']:o['name'] for o in orgs}
    queues = {'outbox_waiting':0,'outbox_failed':0,'ai_pending':0,'notices_pending':0}
    database_bytes = _bytes(D.DATA/'control.sqlite3')
    for org in orgs:
        path = D.tenant_path(org['id'])
        database_bytes += _bytes(path)
        if org['status']!='active' or not path.is_file():
            continue
        with D.tenant(org['id']) as db:
            for status,count in db.execute('SELECT status,COUNT(*) FROM channel_outbox GROUP BY status'):
                if status in ('queued','sending'):
                    queues['outbox_waiting'] += count
                elif status in ('failed','unknown'):
                    queues['outbox_failed'] += count
            queues['ai_pending'] += db.execute("SELECT COUNT(*) FROM ai_jobs WHERE status IN ('pending','running')").fetchone()[0]
            queues['notices_pending'] += db.execute('SELECT COUNT(*) FROM customer_notifications WHERE sent_at IS NULL AND attempts<3').fetchone()[0]
    disk = shutil.disk_usage(D.DATA)
    usage = sorted(({'id':tid,'name':names[tid],'requests':count} for tid,count in snap.pop('tenants').items() if tid in names),
                   key=lambda u:-u['requests'])[:10]
    return {**snap,'tenant_usage':usage,'queues':queues,'users':repository.user_count(cd),
            'server':{'python':host.python_version(),'system':host.platform(terse=True),'data_dir':str(D.DATA.resolve()),
                      'database_bytes':database_bytes,'files_bytes':_bytes(D.DATA/'files'),'disk_total':disk.total,'disk_free':disk.free},
            'organizations':{'active':sum(o['status']=='active' for o in orgs),'suspended':sum(o['status']=='suspended' for o in orgs),
                             'members':sum(o['member_count'] for o in orgs)},
            'audit':audit.with_names(cd,audit.latest(cd,20))}


# Platform team. Bookdose works in two roles: the platform team runs the server and the organizations (this list);
# the people who answer Bookdose's own customers are members of the Bookdose organization, like in any other.
def platform_team(cd):
    return repository.platform_admins(cd)


def add_platform_admin(cd, session, body):
    """Give an account the platform role; a new email gets an account with the name and password given.
    Returns the user id."""
    email = schema.admin_email(body)
    user = users.find_user_by_email(cd,email)
    if user:
        require(not user['platform_admin'],'บัญชีนี้เป็นผู้ดูแลระบบกลางอยู่แล้ว',409)
        user_id = user['id']
        repository.set_platform_admin(cd,user_id,True)
    else:
        user_id = uid()
        name,password = schema.new_admin(body)
        users.insert_user(cd,user_id,name,email,password,platform_admin=True)
    audit.record(cd,session['user_id'],'platform.admin_added',user_id)
    cd.commit()
    return user_id


def remove_platform_admin(cd, session, user_id):
    """Someone else takes the role away, so the platform always keeps at least one admin who can sign in."""
    require(user_id!=session['user_id'],'ถอดสิทธิ์ของตัวเองไม่ได้ ให้ผู้ดูแลระบบกลางคนอื่นเป็นผู้ถอด',400)
    require(any(a['id']==user_id for a in repository.platform_admins(cd)),'ไม่พบผู้ดูแลระบบกลางคนนี้',404)
    repository.set_platform_admin(cd,user_id,False)
    audit.record(cd,session['user_id'],'platform.admin_removed',user_id)
    cd.commit()


# Global FAQ: written once here, read by its audience in every organization once published.
FIELDS = ('title','category','body','audience')


def _waiting(article):
    return json.loads(article['draft']) if article['draft'] else None


def _admin_view(row):
    """An article as its editor sees it: the latest words (the waiting changes, if any) and where it stands:
    'draft' (never published), 'published', or 'changed' (published, with changes not published yet). `live` is the
    version readers see, while it differs from the latest words."""
    waiting = _waiting(row)
    live = {key:row[key] for key in FIELDS}
    state = 'draft' if not row['published_at'] else 'changed' if waiting else 'published'
    return {'id':row['id'],**(waiting or live),'author':row['author'],'updated_at':row['updated_at'],
            'published_at':row['published_at'],'state':state,'live':live if waiting else None}


def global_faq(cd):
    return [_admin_view(row) for row in repository.global_articles(cd)]


def staff_guides(cd):
    return repository.global_articles(cd,'staff')


def save_global_article(cd, session, article_id, body):
    """Create (no id) or update an article; returns its id. Nothing reaches readers here: a new article is a draft,
    and changes to a published one wait beside it until they are published."""
    words = dict(zip(FIELDS,schema.global_article(body)))
    if article_id is None:
        article_id = uid()
        repository.insert_global_article(cd,article_id,*(words[key] for key in FIELDS),session['name'])
    else:
        article = _found_article(cd,article_id)
        if article['published_at']:
            same = all(article[key]==words[key] for key in FIELDS)
            repository.save_global_draft(cd,article_id,None if same else json.dumps(words,ensure_ascii=False),session['name'])
        else:
            repository.update_global_article(cd,article_id,*(words[key] for key in FIELDS),session['name'])
    audit.record(cd,session['user_id'],'faq.saved',article_id,words['title'])
    cd.commit()
    return article_id


def _found_article(cd, article_id):
    article = repository.find_global_article(cd,article_id)
    require(article,'ไม่พบบทความ',404)
    return article


def _apply_waiting(cd, session, article):
    """Make the waiting changes the article's own words; returns the title it now has."""
    waiting = _waiting(article)
    if waiting:
        repository.update_global_article(cd,article['id'],*(waiting[key] for key in FIELDS),session['name'])
        repository.save_global_draft(cd,article['id'],None,session['name'])
    return (waiting or article)['title']


def publish_global_article(cd, session, article_id):
    """Readers see the latest words from now on (a draft, or the waiting changes of a published article)."""
    article = _found_article(cd,article_id)
    require(article['draft'] or not article['published_at'],'บทความนี้เผยแพร่อยู่แล้ว และไม่มีการแก้ไขที่รอเผยแพร่',409)
    title = _apply_waiting(cd,session,article)
    repository.set_global_published(cd,article_id,True,session['name'])
    audit.record(cd,session['user_id'],'faq.published',article_id,title)
    cd.commit()


def unpublish_global_article(cd, session, article_id):
    """Take an article away from its readers; it is a draft again, with its latest words."""
    article = _found_article(cd,article_id)
    require(article['published_at'],'บทความนี้ยังไม่ได้เผยแพร่',409)
    title = _apply_waiting(cd,session,article)
    repository.set_global_published(cd,article_id,False,session['name'])
    audit.record(cd,session['user_id'],'faq.unpublished',article_id,title)
    cd.commit()


def discard_global_changes(cd, session, article_id):
    """Throw away the waiting changes of a published article; the version readers see stays."""
    article = _found_article(cd,article_id)
    require(article['draft'],'ไม่มีการแก้ไขที่รอเผยแพร่',409)
    repository.save_global_draft(cd,article_id,None,session['name'])
    audit.record(cd,session['user_id'],'faq.changes_discarded',article_id,article['title'])
    cd.commit()


def delete_global_article(cd, session, article_id):
    article = repository.find_global_article(cd,article_id)
    require(article,'ไม่พบบทความ',404)
    repository.delete_global_article(cd,article_id)
    audit.record(cd,session['user_id'],'faq.deleted',article_id,article['title'])
    cd.commit()


# SMS (follow links of guest web chat): which provider sends them (backend/extensions/sms.py)
def sms_settings(cd):
    from backend.extensions import sms
    return sms.config(cd)


def save_sms_settings(cd, session, body):
    """Choose the provider; credentials typed now are sealed in their own file, empty ones keep what was saved."""
    from backend.extensions import sms
    public,typed = sms.settings_form(body)
    D.begin(cd)
    sms.save(cd,public,typed)
    audit.record(cd,session['user_id'],'sms.settings_updated','platform',public['provider']+(' · credentials' if typed else ''))
    cd.commit()
    return sms_settings(cd)


def send_test_sms(cd, body):
    """A test text to a number the platform admin types, through the provider in use now."""
    from backend.extensions import sms
    from backend.modules.guest.schema import phone_e164, mask_phone
    phone = phone_e164(body.get('to',''))
    require(sms.ready(cd),'ยังไม่ได้เลือกผู้ให้บริการ SMS หรือยังไม่ได้ใส่ข้อมูลบัญชี',409)
    sms.send_test(cd,phone)
    return {'sent':True,'to_masked':mask_phone(phone)}


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
