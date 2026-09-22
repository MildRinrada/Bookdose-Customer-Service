"""Organization and platform-setting queries (control database), and the registration SMTP password file."""
import json

from backend.database import db as D
from backend.database.db import one, rows
from backend.utils.dates import now
from backend.utils import secret_box


def insert_tenant(db, tenant_id, name, slug):
    from backend.modules.platform.model import NEW_TENANT_QUOTA_MB
    db.execute('INSERT INTO tenants(id,name,slug,created_at,quota_mb) VALUES(?,?,?,?,?)',
               (tenant_id,name,slug,now(),NEW_TENANT_QUOTA_MB))


def slug_taken(db, slug, except_tenant=None):
    """Whether a code is spoken for - by an organization using it now, or by one that used to and whose old links
    still lead there. `except_tenant` lets an organization take back a code it used to have itself."""
    used = one(db,'SELECT id FROM tenants WHERE slug=?',(slug,))
    if used:
        return used['id']!=except_tenant
    former = one(db,'SELECT tenant_id FROM tenant_slugs WHERE slug=?',(slug,))
    return bool(former) and former['tenant_id']!=except_tenant


def former_slugs(db, tenant_id):
    """The codes this organization used to have, newest first."""
    return [row['slug'] for row in rows(db,'SELECT slug FROM tenant_slugs WHERE tenant_id=? ORDER BY changed_at DESC',(tenant_id,))]


def rename_tenant(db, tenant_id, old_slug, new_slug):
    """Give the organization a new code and keep the old one leading here. Taking back a code this organization used
    to have simply removes it from the old ones."""
    db.execute('INSERT OR REPLACE INTO tenant_slugs(slug,tenant_id,changed_at) VALUES(?,?,?)',(old_slug,tenant_id,now()))
    db.execute('DELETE FROM tenant_slugs WHERE slug=? AND tenant_id=?',(new_slug,tenant_id))
    db.execute('UPDATE tenants SET slug=? WHERE id=?',(new_slug,tenant_id))


def find_tenant(db, tenant_id):
    return one(db,'SELECT id,name FROM tenants WHERE id=?',(tenant_id,))


def tenant_features(db, tenant_id):
    """{feature: bool} for the ones this organization was given an answer for; the rest keep their default."""
    return {row['feature']:bool(row['enabled'])
            for row in rows(db,'SELECT feature,enabled FROM tenant_features WHERE tenant_id=?',(tenant_id,))}


def all_tenant_features(db):
    """{tenant_id: {feature: bool}} in one query, for the console's list of organizations."""
    found = {}
    for row in rows(db,'SELECT tenant_id,feature,enabled FROM tenant_features'):
        found.setdefault(row['tenant_id'],{})[row['feature']] = bool(row['enabled'])
    return found


def set_tenant_feature(db, tenant_id, feature, enabled, who):
    db.execute('''INSERT INTO tenant_features(tenant_id,feature,enabled,changed_by,changed_at) VALUES(?,?,?,?,?)
                  ON CONFLICT(tenant_id,feature) DO UPDATE SET enabled=excluded.enabled,
                      changed_by=excluded.changed_by,changed_at=excluded.changed_at''',
               (tenant_id,feature,int(enabled),who,now()))


def find_tenant_quota(db, tenant_id):
    """Only the ceiling, asked on every upload."""
    return one(db,'SELECT quota_mb FROM tenants WHERE id=?',(tenant_id,))


def set_tenant_quota(db, tenant_id, quota_mb):
    db.execute('UPDATE tenants SET quota_mb=? WHERE id=?',(quota_mb,tenant_id))


def single_active_organization(db):
    """{'slug','name'} when exactly one organization is active (a company running its own copy), else None.
    Customers can then sign up from the main sign-in page; with several organizations they use their help-center link."""
    found = rows(db,"SELECT slug,name FROM tenants WHERE status='active' LIMIT 2")
    return found[0] if len(found)==1 else None


def find_active(db, tenant_id):
    return one(db,"SELECT * FROM tenants WHERE id=? AND status='active'",(tenant_id,))


def home_organization(db):
    """The platform's own organization (Bookdose): the one created at first-run setup, else the oldest active one.
    Every customer can contact it."""
    row = one(db,"SELECT value FROM platform_settings WHERE key='home_tenant'")
    org = find_active(db,row['value']) if row else None
    return org or one(db,"SELECT * FROM tenants WHERE status='active' ORDER BY created_at,rowid LIMIT 1")


def tenant_summary(db, tenant_id):
    return one(db,'SELECT id,name,slug FROM tenants WHERE id=?',(tenant_id,))


def find_active_by_slug(db, slug):
    """The organization a code leads to: the one using it now, or the one that used to (tenant_slugs), so that every
    link a customer was ever given keeps working after a code is corrected."""
    org = one(db,"SELECT * FROM tenants WHERE slug=? AND status='active'",(slug,))
    if org:
        return org
    return one(db,"""SELECT t.* FROM tenants t JOIN tenant_slugs s ON s.tenant_id=t.id
                     WHERE s.slug=? AND t.status='active'""",(slug,))


def is_active(db, tenant_id):
    return bool(one(db,"SELECT 1 FROM tenants WHERE id=? AND status='active'",(tenant_id,)))


def active_tenant_ids(db):
    return [row[0] for row in db.execute("SELECT id FROM tenants WHERE status='active' ORDER BY id")]


def list_with_member_count(db):
    """Each organization with how many of its own members are active (platform admins are never counted)."""
    return rows(db,'''SELECT t.*,(SELECT COUNT(*) FROM memberships m WHERE m.tenant_id=t.id AND m.active=1 AND m.expires_at IS NULL
                      AND m.user_id NOT IN (SELECT id FROM users WHERE platform_admin=1)) AS member_count FROM tenants t ORDER BY t.created_at''')


def set_status(db, tenant_id, status):
    db.execute('UPDATE tenants SET status=? WHERE id=?',(status,tenant_id))


def user_count(db):
    return db.execute('SELECT COUNT(*) FROM users').fetchone()[0]


# The platform team: accounts that may use the platform console (server and organizations), apart from any
# organization they work in.
def platform_admins(db):
    return rows(db,'SELECT id,name,email,created_at FROM users WHERE platform_admin=1 ORDER BY name')


def owner_id(db):
    """The platform's owner: the account made at first-run setup (it alone manages the platform admins)."""
    return setting(db,'platform_owner')


def remember_owner(db):
    """Name the owner once on an installation from before: the platform admin who was there first."""
    if setting(db,'platform_owner'):
        return
    first = one(db,'SELECT id FROM users WHERE platform_admin=1 ORDER BY created_at,rowid LIMIT 1')
    if first:
        save_setting(db,'platform_owner',first['id'])


def set_platform_admin(db, user_id, enabled):
    db.execute('UPDATE users SET platform_admin=? WHERE id=?',(int(enabled),user_id))


# Global FAQ
def add_publish_columns(db):
    """Databases from before drafts: every article there was already shown to its readers, so it stays published."""
    columns = {row[1] for row in db.execute('PRAGMA table_info(global_articles)')}
    if 'published_at' not in columns:
        db.execute('ALTER TABLE global_articles ADD COLUMN published_at TEXT')
        db.execute('ALTER TABLE global_articles ADD COLUMN draft TEXT')
        db.execute('UPDATE global_articles SET published_at=updated_at')
        db.commit()


def global_articles(db, audience=None):
    """Every global article with its waiting changes (for the platform admin), or the published articles written for
    one audience (for its readers)."""
    if audience:
        return rows(db,'''SELECT id,title,category,body,updated_at FROM global_articles
                          WHERE audience=? AND published_at IS NOT NULL ORDER BY category,title''',(audience,))
    return rows(db,'SELECT * FROM global_articles ORDER BY updated_at DESC')


def find_global_article(db, article_id):
    return one(db,'SELECT * FROM global_articles WHERE id=?',(article_id,))


def insert_problem_report(db, report_id, org, user, page, message, browser):
    db.execute('''INSERT INTO problem_reports(id,tenant_id,tenant_name,user_id,user_name,user_email,page,message,browser,created_at)
                  VALUES(?,?,?,?,?,?,?,?,?,?)''',
               (report_id,org and org['id'],(org or {}).get('name',''),user['user_id'],user.get('name',''),
                user.get('email',''),page,message,browser,now()))


def problem_reports(db, limit=200):
    """Newest first, the ones still to look at before the ones already dealt with."""
    return rows(db,"SELECT * FROM problem_reports ORDER BY status='done',created_at DESC LIMIT ?",(limit,))


def find_problem_report(db, report_id):
    return one(db,'SELECT * FROM problem_reports WHERE id=?',(report_id,))


def set_report_status(db, report_id, status, handler):
    db.execute('UPDATE problem_reports SET status=?,handled_at=?,handled_by=? WHERE id=?',
               (status,now() if status=='done' else None,handler if status=='done' else None,report_id))


def open_report_count(db):
    return db.execute("SELECT COUNT(*) FROM problem_reports WHERE status='open'").fetchone()[0]


def insert_global_article(db, article_id, title, category, body, audience, author, published=False):
    moment = now()
    db.execute('''INSERT INTO global_articles(id,title,category,body,audience,author,updated_at,published_at)
                  VALUES(?,?,?,?,?,?,?,?)''',(article_id,title,category,body,audience,author,moment,moment if published else None))


def update_global_article(db, article_id, title, category, body, audience, author):
    db.execute('UPDATE global_articles SET title=?,category=?,body=?,audience=?,author=?,updated_at=? WHERE id=?',
               (title,category,body,audience,author,now(),article_id))


def save_global_draft(db, article_id, draft, author):
    """Changes to a published article, kept apart until they are published (None: no waiting changes)."""
    db.execute('UPDATE global_articles SET draft=?,author=?,updated_at=? WHERE id=?',(draft,author,now(),article_id))


def set_global_published(db, article_id, published, author):
    moment = now()
    db.execute('UPDATE global_articles SET published_at=?,author=?,updated_at=? WHERE id=?',(moment if published else None,author,moment,article_id))


def delete_global_article(db, article_id):
    db.execute('DELETE FROM global_articles WHERE id=?',(article_id,))


def setting(db, key):
    row = one(db,'SELECT value FROM platform_settings WHERE key=?',(key,))
    return row['value'] if row else None


def save_setting(db, key, value):
    db.execute('INSERT INTO platform_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(key,value))


def registration_mail(db):
    """The saved registration-mail settings as JSON text, or None."""
    row = one(db,"SELECT value FROM platform_settings WHERE key='registration_mail'")
    return row['value'] if row else None


def save_registration_mail(db, value):
    db.execute("INSERT INTO platform_settings VALUES('registration_mail',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(value,))


# The SMTP password lives in a private file, never in the database, API responses or backups, sealed with the
# platform's secret key (utils/secret_box).
def registration_secret_path():
    return D.DATA/'secrets'/'registration-smtp.json'


def read_registration_secret():
    try:
        text = secret_box.read_file(registration_secret_path())
        return json.loads(text) if text else {}
    except (OSError, ValueError):
        return {}


def write_registration_secret(secret):
    secret_box.write_file(registration_secret_path(),json.dumps(secret))
