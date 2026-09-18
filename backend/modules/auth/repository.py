"""User, profile, session and pending-registration queries (control database)."""
from backend.database.db import one
from backend.utils.dates import now


# Users
def count_users(db):
    return db.execute('SELECT COUNT(*) FROM users').fetchone()[0]


def find_user_by_email(db, email):
    return one(db,'SELECT * FROM users WHERE email=?',(email,))


def password_of(db, user_id):
    return one(db,'SELECT password FROM users WHERE id=?',(user_id,))['password']


def insert_user(db, user_id, name, email, encoded_password, platform_admin=False):
    db.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',(user_id,name,email,encoded_password,int(platform_admin),now()))


def set_user_name(db, user_id, name):
    db.execute('UPDATE users SET name=? WHERE id=?',(name,user_id))


def set_password(db, user_id, encoded_password):
    db.execute('UPDATE users SET password=? WHERE id=?',(encoded_password,user_id))


def platform_admin_exists(db):
    return bool(one(db,'SELECT id FROM users WHERE platform_admin=1'))


def avatar_of(db, user_id):
    return (one(db,'SELECT avatar FROM user_profiles WHERE user_id=?',(user_id,)) or {}).get('avatar','')


def save_avatar(db, user_id, avatar):
    db.execute('INSERT INTO user_profiles VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET avatar=excluded.avatar',(user_id,avatar))


def mark_email_verified(db, user_id):
    db.execute('INSERT INTO email_verifications VALUES(?,?)',(user_id,now()))


# Sessions (the token column stores a hash of the cookie value)
def find_session(db, token_hash):
    """The session row with its user, whatever its limits say (auth.service.load_session judges them)."""
    return one(db,'''SELECT s.*,u.name,u.email,u.platform_admin FROM sessions s
               JOIN users u ON u.id=s.user_id WHERE s.token=?''',(token_hash,))


def insert_session(db, token_hash, user_id, tenant_id, csrf, expires_at):
    db.execute('INSERT INTO sessions(token,user_id,tenant_id,csrf,expires_at,created_at,last_active_at) VALUES(?,?,?,?,?,?,?)',
               (token_hash,user_id,tenant_id,csrf,expires_at,now(),now()))


def touch_session(db, token_hash):
    """The session was really used (a change, or the page's activity signal)."""
    moment = now()
    db.execute('UPDATE sessions SET last_active_at=? WHERE token=?',(moment,token_hash))
    return moment


def delete_expired_sessions(db):
    db.execute('DELETE FROM sessions WHERE expires_at<?',(now(),))


def delete_session(db, token_hash):
    db.execute('DELETE FROM sessions WHERE token=?',(token_hash,))


def delete_user_sessions(db, user_id):
    db.execute('DELETE FROM sessions WHERE user_id=?',(user_id,))


def set_session_tenant(db, token_hash, tenant_id):
    db.execute('UPDATE sessions SET tenant_id=? WHERE token=?',(tenant_id,token_hash))


# Pending registrations
def purge_pending(db, created_before):
    db.execute('DELETE FROM pending_registrations WHERE created_at<?',(created_before,))


def find_pending(db, email):
    return one(db,'SELECT * FROM pending_registrations WHERE email=?',(email,))


def find_pending_by_token(db, token_hash):
    return one(db,'SELECT * FROM pending_registrations WHERE token_hash=?',(token_hash,))


def save_pending(db, email, applicant, token_hash, expires_at):
    """Insert or replace the applicant's pending registration with a new link; created_at is kept from `applicant` when present."""
    db.execute('''INSERT INTO pending_registrations VALUES(?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(email) DO UPDATE SET name=excluded.name,password=excluded.password,
                  organization=excluded.organization,slug=excluded.slug,token_hash=excluded.token_hash,
                  expires_at=excluded.expires_at,created_at=excluded.created_at,last_sent_at=excluded.last_sent_at''',
               (email,applicant['name'],applicant['password'],applicant['organization'],applicant['slug'],
                token_hash,expires_at,applicant.get('created_at',now()),now()))


def delete_pending(db, email):
    db.execute('DELETE FROM pending_registrations WHERE email=?',(email,))


# Password-reset links (the token column stores a hash of the link's token)
def latest_reset(db, user_id):
    return one(db,'SELECT * FROM staff_resets WHERE user_id=? ORDER BY created_at DESC LIMIT 1',(user_id,))


def insert_reset(db, token_hash, user_id, expires_at):
    db.execute('INSERT INTO staff_resets VALUES(?,?,?,?)',(token_hash,user_id,expires_at,now()))


def find_reset(db, token_hash):
    """The link's user, while the link has not run out."""
    return one(db,'''SELECT r.*,u.email,u.name FROM staff_resets r JOIN users u ON u.id=r.user_id
                     WHERE r.token_hash=? AND r.expires_at>?''',(token_hash,now()))


def delete_resets(db, user_id):
    db.execute('DELETE FROM staff_resets WHERE user_id=?',(user_id,))


def purge_resets(db, created_before):
    db.execute('DELETE FROM staff_resets WHERE created_at<?',(created_before,))
