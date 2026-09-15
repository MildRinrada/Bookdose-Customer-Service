"""Organization and platform-setting queries (control database), and the registration SMTP password file."""
import json

from backend.database import db as D
from backend.database.db import one, rows
from backend.utils.dates import now
from backend.utils.files import write_private_file


def insert_tenant(db, tenant_id, name, slug):
    db.execute('INSERT INTO tenants(id,name,slug,created_at) VALUES(?,?,?,?)',(tenant_id,name,slug,now()))


def slug_taken(db, slug):
    return bool(one(db,'SELECT id FROM tenants WHERE slug=?',(slug,)))


def find_tenant(db, tenant_id):
    return one(db,'SELECT id,name FROM tenants WHERE id=?',(tenant_id,))


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
    return one(db,"SELECT * FROM tenants WHERE slug=? AND status='active'",(slug,))


def is_active(db, tenant_id):
    return bool(one(db,"SELECT 1 FROM tenants WHERE id=? AND status='active'",(tenant_id,)))


def active_tenant_ids(db):
    return [row[0] for row in db.execute("SELECT id FROM tenants WHERE status='active' ORDER BY id")]


def list_with_member_count(db):
    return rows(db,'''SELECT t.*,(SELECT COUNT(*) FROM memberships m WHERE m.tenant_id=t.id AND m.active=1) AS member_count FROM tenants t ORDER BY t.created_at''')


def set_status(db, tenant_id, status):
    db.execute('UPDATE tenants SET status=? WHERE id=?',(status,tenant_id))


def user_count(db):
    return db.execute('SELECT COUNT(*) FROM users').fetchone()[0]


# The platform team: accounts that may use the platform console (server and organizations), apart from any
# organization they work in.
def platform_admins(db):
    return rows(db,'SELECT id,name,email,created_at FROM users WHERE platform_admin=1 ORDER BY name')


def set_platform_admin(db, user_id, enabled):
    db.execute('UPDATE users SET platform_admin=? WHERE id=?',(int(enabled),user_id))


# Global FAQ
def global_articles(db, audience=None):
    """Every global article (for the platform admin), or those written for one audience (for its readers)."""
    if audience:
        return rows(db,'SELECT id,title,category,body,updated_at FROM global_articles WHERE audience=? ORDER BY category,title',(audience,))
    return rows(db,'SELECT * FROM global_articles ORDER BY updated_at DESC')


def find_global_article(db, article_id):
    return one(db,'SELECT * FROM global_articles WHERE id=?',(article_id,))


def insert_global_article(db, article_id, title, category, body, audience, author):
    db.execute('INSERT INTO global_articles VALUES(?,?,?,?,?,?,?)',(article_id,title,category,body,audience,author,now()))


def update_global_article(db, article_id, title, category, body, audience, author):
    db.execute('UPDATE global_articles SET title=?,category=?,body=?,audience=?,author=?,updated_at=? WHERE id=?',
               (title,category,body,audience,author,now(),article_id))


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


# The SMTP password lives in a private file, never in the database, API responses or backups.
def registration_secret_path():
    return D.DATA/'secrets'/'registration-smtp.json'


def read_registration_secret():
    try:
        return json.loads(registration_secret_path().read_text())
    except (OSError, ValueError):
        return {}


def write_registration_secret(secret):
    write_private_file(registration_secret_path(),json.dumps(secret))
