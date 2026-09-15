"""One-time move of the accounts that used to live inside each organization's database into the platform-wide
customer accounts. An email already moved from another organization keeps that account (and its password); this
organization's records point at it. Old sign-up links, reset links and sessions are dropped, so customers sign in
again once."""
from backend.database.db import rows
from backend.modules.customers.model import ADDED_CONTROL_COLUMNS

LEGACY_TABLES = ('customer_accounts','customer_signups','customer_resets','customer_sessions')


def control_columns(cd):
    """Columns added to the control tables after the first release (safe to repeat; existing rows get the default)."""
    for table,columns in ADDED_CONTROL_COLUMNS.items():
        present = {row[1] for row in cd.execute(f'PRAGMA table_info({table})')}
        for name,definition in columns.items():
            if name not in present:
                cd.execute(f'ALTER TABLE {table} ADD COLUMN {name} {definition}')


def legacy_accounts(cd, db, tenant_id):
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if 'customer_accounts' not in tables:
        return
    for old in rows(db,'SELECT * FROM customer_accounts ORDER BY created_at'):
        found = cd.execute('SELECT id FROM customer_accounts WHERE email=?',(old['email'],)).fetchone()
        account_id = found[0] if found else old['id']
        if not found:
            cd.execute('''INSERT INTO customer_accounts(id,name,email,phone,password,consent_version,consent_at,verified_at,created_at,
                          last_login_at,email_verified,notify_email) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''',
                       (old['id'],old['name'],old['email'],old['phone'],old['password'],old['consent_version'],old['consent_at'],
                        old['verified_at'],old['created_at'],old.get('last_login_at'),old.get('email_verified',1),old.get('notify_email',1)))
        if old.get('contact_id'):
            db.execute('INSERT OR IGNORE INTO customer_members VALUES(?,?,?)',(account_id,old['contact_id'],old['created_at']))
        if account_id!=old['id']:
            for table in ('customer_contacts','customer_seen'):
                db.execute(f'UPDATE OR IGNORE {table} SET account_id=? WHERE account_id=?',(account_id,old['id']))
                db.execute(f'DELETE FROM {table} WHERE account_id=?',(old['id'],))
            db.execute('UPDATE customer_notifications SET account_id=? WHERE account_id=?',(account_id,old['id']))
        cd.execute('INSERT OR IGNORE INTO customer_orgs VALUES(?,?,?)',(account_id,tenant_id,old['created_at']))
    cd.commit()
    for table in LEGACY_TABLES:
        if table in tables:
            db.execute(f'DROP TABLE {table}')
