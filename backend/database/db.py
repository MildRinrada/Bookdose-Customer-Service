"""SQLite connections: a control database for the platform and one physically separate database per organization."""
import contextlib
import os
import sqlite3
import threading

from config import settings

# Read at call time everywhere (tests point it at a temporary folder).
DATA = settings.DATA_DIR


class Connection(sqlite3.Connection):
    """A connection that can run work once its changes are committed (realtime hints, backend/realtime): callbacks
    registered with after_commit() run right after the next successful commit(), in the order registered, and are
    dropped by rollback() or when the connection closes without committing."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._after_commit = {}

    def after_commit(self, key, callback):
        """Run callback after the next commit; a second callback with the same key is ignored (one per change)."""
        self._after_commit.setdefault(key, callback)

    def commit(self):
        super().commit()
        callbacks = list(self._after_commit.values())
        self._after_commit.clear()
        for callback in callbacks:
            try:
                callback()
            except Exception as error:
                # The change itself is saved; a failing follow-up must not turn it into an error.
                print(f'After commit: {type(error).__name__}', flush=True)

    def rollback(self):
        self._after_commit.clear()
        super().rollback()


def after_commit(db, key, callback):
    """callback() once db's current changes are committed (at once for a connection without the hook)."""
    if isinstance(db, Connection):
        db.after_commit(key, callback)
    else:
        callback()


# A restore from the platform console (platform/restore.py) replaces the databases under a running server: while it
# does, every other thread waits at its next connection, and the restore waits for the connections already open.
_gate = threading.Condition()
_open = {}            # thread id -> connections it has open
_holder = None        # the thread restoring, which alone may connect meanwhile


@contextlib.contextmanager
def paused(wait_seconds=30):
    """Hold every other thread's database work while the block runs (after the connections they have open close, or
    wait_seconds, whichever comes first)."""
    global _holder
    me = threading.get_ident()
    with _gate:
        if _holder is not None and _holder != me:
            raise RuntimeError('Another thread holds the databases')
        _holder = me
        _gate.wait_for(lambda: not any(n for t, n in _open.items() if t != me), timeout=wait_seconds)
    try:
        yield
    finally:
        with _gate:
            _holder = None
            _gate.notify_all()


def _enter():
    me = threading.get_ident()
    with _gate:
        _gate.wait_for(lambda: _holder is None or _holder == me)
        _open[me] = _open.get(me, 0) + 1


def _leave():
    me = threading.get_ident()
    with _gate:
        _open[me] -= 1
        if not _open[me]:
            del _open[me]
        _gate.notify_all()


@contextlib.contextmanager
def connect(path):
    """Commit when the block succeeds, roll back when it raises."""
    _enter()
    try:
        db = sqlite3.connect(path, timeout=15, factory=Connection)
    except Exception:
        _leave()
        raise
    try:
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA journal_mode=WAL')
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
        _leave()


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


def tenant_id_of(db):
    """The organization a tenant connection belongs to: its file is named after it (tenant_path)."""
    return os.path.splitext(os.path.basename(db.execute('PRAGMA database_list').fetchone()[2]))[0]


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
    # Secret files still in plain text (from before encryption) are sealed with the platform's key.
    from backend.utils import secret_box
    secret_box.seal_existing_files()
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
