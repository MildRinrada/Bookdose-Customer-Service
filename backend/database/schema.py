"""Creates the tables each module declares in its model.py, and applies additive (repeatable) migrations."""
from backend.database import audit
from backend.modules.ai import model as ai
from backend.modules.auth import model as auth
from backend.modules.automation import model as automation
from backend.modules.channels import model as channels
from backend.modules.contacts import model as contacts
from backend.modules.conversations import model as conversations
from backend.modules.knowledge import model as knowledge
from backend.modules.organization import model as organization
from backend.modules.platform import model as platform
from backend.modules.tickets import model as tickets
from backend.modules.trash import model as trash

CONTROL_TABLES = (auth.CONTROL_TABLES, platform.CONTROL_TABLES, organization.CONTROL_TABLES, channels.CONTROL_TABLES, audit.TABLE)
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
