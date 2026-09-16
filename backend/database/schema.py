"""Creates the tables each module declares in its model.py, and applies additive (repeatable) migrations. Tables of
features that were taken out stay untouched in databases that already have them."""
import json

from backend.database import audit
from backend.modules.ai import model as ai
from backend.modules.auth import model as auth
from backend.modules.automation import model as automation
from backend.modules.channels import model as channels
from backend.modules.contacts import model as contacts
from backend.modules.customer_security import model as customer_security
from backend.modules.customers import model as customers
from backend.modules.guest import model as guest
from backend.modules.conversations import model as conversations
from backend.modules.knowledge import model as knowledge
from backend.modules.org_links import model as org_links
from backend.modules.organization import model as organization
from backend.modules.platform import model as platform
from backend.modules.tickets import model as tickets
from backend.modules.trash import model as trash

CONTROL_TABLES = (auth.CONTROL_TABLES, platform.CONTROL_TABLES, organization.CONTROL_TABLES, channels.CONTROL_TABLES,
                  customers.CONTROL_TABLES, customer_security.CONTROL_TABLES, org_links.CONTROL_TABLES, guest.CONTROL_TABLES, audit.TABLE)
TENANT_TABLES = (organization.TENANT_TABLES, contacts.TENANT_TABLES, conversations.TENANT_TABLES, tickets.TENANT_TABLES,
                 knowledge.TENANT_TABLES, audit.TABLE)


def create_control_tables(db):
    from backend.modules.customers import migrate as customer_migrate
    for script in CONTROL_TABLES:
        db.executescript(script)
    customer_migrate.control_columns(db)


def create_tenant_tables(db):
    for script in TENANT_TABLES:
        db.executescript(script)
    upgrade_tenant(db)


def upgrade_tenant(db):
    """Tables added after the first release; safe to run on every start. Existing rows are left intact."""
    db.executescript(ai.TENANT_TABLES)
    db.executemany('INSERT OR IGNORE INTO settings VALUES(?,?)',ai.DEFAULT_SETTINGS)
    db.execute(contacts.NAME_TABLE)
    db.executescript(channels.TENANT_TABLES)
    db.execute(trash.TENANT_TABLES)
    db.executescript(automation.TENANT_TABLES)
    db.executemany('INSERT OR IGNORE INTO settings VALUES(?,?)',automation.DEFAULT_SETTINGS)
    db.executescript(customers.TENANT_TABLES)
    db.execute('INSERT OR IGNORE INTO settings VALUES(?,?)',('customer_categories',json.dumps(customers.DEFAULT_CATEGORIES,ensure_ascii=False)))
    # The system has no payments: the old default payment question is swapped for the current default in stored lists.
    row = db.execute("SELECT value FROM settings WHERE key='customer_categories'").fetchone()
    stored = json.loads(row[0]) if row else []
    if any(item.get('name')=='สอบถามเรื่องการชำระเงิน' for item in stored):
        names = {item.get('name') for item in stored}
        kept = [item for item in stored if item.get('name')!='สอบถามเรื่องการชำระเงิน']
        kept += [item for item in customers.DEFAULT_CATEGORIES if item['name'] not in names and item['name']=='ข้อเสนอแนะและร้องเรียน']
        db.execute("UPDATE settings SET value=? WHERE key='customer_categories'",(json.dumps(kept,ensure_ascii=False),))
    if 'comment' not in {row[1] for row in db.execute('PRAGMA table_info(csat_surveys)')}:
        db.execute("ALTER TABLE csat_surveys ADD COLUMN comment TEXT NOT NULL DEFAULT ''")
    # Guest web chat (customers chatting without an account): its tables and the switches of the chat and widget.
    db.executescript(guest.TENANT_TABLES)
    db.executemany('INSERT OR IGNORE INTO settings VALUES(?,?)',guest.DEFAULT_SETTINGS)
