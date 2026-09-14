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
