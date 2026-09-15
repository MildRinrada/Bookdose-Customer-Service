"""Creates the tables each module declares in its model.py, and applies additive (repeatable) migrations."""
import json

from backend.database import audit
from backend.modules.ai import model as ai
from backend.modules.auth import model as auth
from backend.modules.automation import model as automation
from backend.modules.channels import model as channels
from backend.modules.contacts import model as contacts
from backend.modules.contracts import model as contracts
from backend.modules.customers import model as customers
from backend.modules.conversations import model as conversations
from backend.modules.knowledge import model as knowledge
from backend.modules.organization import model as organization
from backend.modules.platform import model as platform
from backend.modules.tickets import model as tickets
from backend.modules.trash import model as trash

CONTROL_TABLES = (auth.CONTROL_TABLES, platform.CONTROL_TABLES, organization.CONTROL_TABLES, channels.CONTROL_TABLES,
                  customers.CONTROL_TABLES, contracts.CONTROL_TABLES, audit.TABLE)
TENANT_TABLES = (organization.TENANT_TABLES, contacts.TENANT_TABLES, conversations.TENANT_TABLES, tickets.TENANT_TABLES,
                 knowledge.TENANT_TABLES, audit.TABLE)


def create_control_tables(db):
    for script in CONTROL_TABLES:
        db.executescript(script)


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
    db.executescript(contracts.TENANT_TABLES)
    db.execute('INSERT OR IGNORE INTO settings VALUES(?,?)',('customer_categories',json.dumps(customers.DEFAULT_CATEGORIES,ensure_ascii=False)))
    if 'comment' not in {row[1] for row in db.execute('PRAGMA table_info(csat_surveys)')}:
        db.execute("ALTER TABLE csat_surveys ADD COLUMN comment TEXT NOT NULL DEFAULT ''")
    _upgrade_contracts(db)


def _upgrade_contracts(db):
    """Contracts became projects (milestones worked on and inspected, invoices, warranty): new columns, and the
    milestone table rebuilt once for its wider list of statuses (SQLite cannot change a CHECK in place)."""
    for table,columns in contracts.ADDED_COLUMNS.items():
        present = {row[1] for row in db.execute(f'PRAGMA table_info({table})')}
        for name,definition in columns.items():
            if name not in present:
                db.execute(f'ALTER TABLE {table} ADD COLUMN {name} {definition}')
    sql = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='contract_milestones'").fetchone()[0]
    if 'in_progress' not in sql:
        db.executescript('ALTER TABLE contract_milestones RENAME TO contract_milestones_old;'+contracts.MILESTONE_TABLE+'''
            INSERT INTO contract_milestones(id,contract_id,seq,kind,title,due_date,amount,status,done_at,done_by)
                SELECT id,contract_id,seq,kind,title,due_date,amount,status,done_at,done_by FROM contract_milestones_old;
            DROP TABLE contract_milestones_old;''')
