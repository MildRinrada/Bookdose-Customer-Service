"""SQLite connections: a control database for the platform and one physically separate database per organization."""
import contextlib
import sqlite3

from config import settings

# Read at call time everywhere (tests point it at a temporary folder).
DATA = settings.DATA_DIR


@contextlib.contextmanager
def connect(path):
    """Commit when the block succeeds, roll back when it raises."""
    db = sqlite3.connect(path, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA journal_mode=WAL')
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def control():
    return connect(DATA / 'control.sqlite3')


def tenant_path(tenant_id):
    if len(tenant_id) != 32 or any(c not in '0123456789abcdef' for c in tenant_id):
        raise ValueError('Invalid tenant ID')
    return DATA / 'tenants' / f'{tenant_id}.sqlite3'


def tenant(tenant_id):
    path = tenant_path(tenant_id)
    if not path.is_file():
        raise ValueError('Unknown tenant')
    return connect(path)


def create_tenant_database(tenant_id):
    """Connection to a new, empty tenant database file."""
    return connect(tenant_path(tenant_id))


def rows(db, sql, params=()):
    return [dict(row) for row in db.execute(sql, params).fetchall()]


def one(db, sql, params=()):
    row = db.execute(sql, params).fetchone()
    return dict(row) if row else None


def begin(db):
    """Start a write transaction now, so concurrent writers wait instead of failing halfway."""
    db.execute('BEGIN IMMEDIATE')


def find_in_team(db, table, entity_id, team_id=None):
    """A case or conversation by id; with team_id, only if it belongs to that team."""
    assert table in ('tickets','conversations')
    if team_id is None:
        return one(db, f'SELECT * FROM {table} WHERE id=?', (entity_id,))
    return one(db, f'SELECT * FROM {table} WHERE id=? AND team_id=?', (entity_id, team_id))


def init():
    """Create the data folders and control tables, and bring every tenant database up to date."""
    from backend.database import schema, seed
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    (DATA / 'tenants').mkdir(exist_ok=True, mode=0o700)
    (DATA / 'files').mkdir(exist_ok=True, mode=0o700)
    with control() as db:
        schema.create_control_tables(db)
        seed.seed_global_faq(db)
        tenant_ids = [row[0] for row in db.execute('SELECT id FROM tenants')]
    from backend.modules.customers import migrate
    for tenant_id in tenant_ids:
        with tenant(tenant_id) as td:
            schema.upgrade_tenant(td)
            with control() as db:
                migrate.legacy_accounts(db, td, tenant_id)
