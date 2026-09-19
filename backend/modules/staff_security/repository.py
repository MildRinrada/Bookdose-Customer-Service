"""Queries of staff two-factor sign-in and passkeys (control database). The TOTP secret is sealed with the platform's
key (utils/secret_box) and opened as it is read; codes and tokens are stored only as SHA-256 hashes."""
from backend.database.db import one, rows
from backend.utils import secret_box
from backend.utils.dates import now


def _context(user_id):
    return f'staff_totp:{user_id}'


# Two-factor sign-in (TOTP)
def totp(cd, user_id):
    row = one(cd,'SELECT * FROM staff_totp WHERE user_id=?',(user_id,))
    if row:
        row['secret'] = secret_box.unseal_value(row['secret'],_context(user_id))
    return row


def start_totp(cd, user_id, secret):
    cd.execute('''INSERT INTO staff_totp(user_id,secret,confirmed_at,last_step,created_at) VALUES(?,?,NULL,0,?)
                  ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret,confirmed_at=NULL,last_step=0,created_at=excluded.created_at''',
               (user_id,secret_box.seal_value(secret,_context(user_id)),now()))


def confirm_totp(cd, user_id, step):
    return cd.execute('UPDATE staff_totp SET confirmed_at=?,last_step=? WHERE user_id=? AND confirmed_at IS NULL',
                      (now(),step,user_id)).rowcount


def use_totp_step(cd, user_id, step):
    return cd.execute('UPDATE staff_totp SET last_step=? WHERE user_id=? AND last_step<?',(step,user_id,step)).rowcount


def delete_totp(cd, user_id):
    cd.execute('DELETE FROM staff_totp WHERE user_id=?',(user_id,))


# Recovery codes
def recovery_codes(cd, user_id):
    return rows(cd,'SELECT * FROM staff_recovery_codes WHERE user_id=? ORDER BY rowid',(user_id,))


def replace_recovery_codes(cd, user_id, hashed):
    cd.execute('DELETE FROM staff_recovery_codes WHERE user_id=?',(user_id,))
    cd.executemany('INSERT INTO staff_recovery_codes(id,user_id,code_hash,created_at) VALUES(?,?,?,?)',
                   [(code_id,user_id,code_hash,now()) for code_id,code_hash in hashed])


def use_recovery_code(cd, code_id):
    return cd.execute('UPDATE staff_recovery_codes SET used_at=? WHERE id=? AND used_at IS NULL',(now(),code_id)).rowcount


def delete_recovery_codes(cd, user_id):
    cd.execute('DELETE FROM staff_recovery_codes WHERE user_id=?',(user_id,))


# Passkeys
def passkeys(cd, user_id):
    return rows(cd,'SELECT * FROM staff_passkeys WHERE user_id=? ORDER BY created_at,rowid',(user_id,))


def passkey(cd, user_id, passkey_id):
    return one(cd,'SELECT * FROM staff_passkeys WHERE user_id=? AND id=?',(user_id,passkey_id))


def passkey_by_credential(cd, credential_id):
    return one(cd,'SELECT * FROM staff_passkeys WHERE credential_id=?',(credential_id,))


def insert_passkey(cd, passkey_id, user_id, credential, name):
    cd.execute('''INSERT INTO staff_passkeys(id,user_id,credential_id,public_key,alg,sign_count,name,transports,created_at)
                  VALUES(?,?,?,?,?,?,?,?,?)''',(passkey_id,user_id,credential['credential_id'],credential['public_key'],
                  credential['alg'],credential['sign_count'],name,credential['transports_json'],now()))


def rename_passkey(cd, passkey_id, name):
    cd.execute('UPDATE staff_passkeys SET name=? WHERE id=?',(name,passkey_id))


def use_passkey(cd, passkey_id, sign_count):
    cd.execute('UPDATE staff_passkeys SET sign_count=?,last_used_at=? WHERE id=?',(sign_count,now(),passkey_id))


def delete_passkey(cd, passkey_id):
    cd.execute('DELETE FROM staff_passkeys WHERE id=?',(passkey_id,))


def delete_passkeys(cd, user_id):
    """Every passkey of the account (a completed password reset); returns how many there were."""
    return cd.execute('DELETE FROM staff_passkeys WHERE user_id=?',(user_id,)).rowcount


def delete_everything(cd, user_id):
    """Every second factor and passkey of the account (the server owner's reset, reset_account())."""
    for table in ('staff_totp','staff_recovery_codes','staff_passkeys','staff_login_challenges'):
        cd.execute(f'DELETE FROM {table} WHERE user_id=?',(user_id,))


# Signed-in devices (auth's sessions table; the token column is a hash and never leaves the server)
def add_session_columns(cd):
    """SESSION_COLUMNS added to existing databases; sessions from before get their id here (safe to repeat)."""
    from backend.modules.staff_security.model import SESSION_COLUMNS
    present = {row[1] for row in cd.execute('PRAGMA table_info(sessions)')}
    for name,definition in SESSION_COLUMNS.items():
        if name not in present:
            cd.execute(f'ALTER TABLE sessions ADD COLUMN {name} {definition}')
    cd.execute("UPDATE sessions SET id=lower(hex(randomblob(16))) WHERE id=''")
    cd.execute("UPDATE sessions SET browser=id WHERE browser=''")


def sessions_of(cd, user_id):
    return rows(cd,'SELECT * FROM sessions WHERE user_id=? ORDER BY last_active_at DESC,rowid DESC',(user_id,))


def delete_session_by_id(cd, user_id, session_id, keep_token):
    """Sign out one other device of the account (never the one asking: that is the sign-out button)."""
    return cd.execute('DELETE FROM sessions WHERE user_id=? AND id=? AND token<>?',(user_id,session_id,keep_token)).rowcount


def delete_other_sessions(cd, user_id, keep_token):
    return cd.execute('DELETE FROM sessions WHERE user_id=? AND token<>?',(user_id,keep_token)).rowcount


# The account's history
def insert_activity(cd, activity_id, user_id, action, detail, ip, user_agent):
    cd.execute('INSERT INTO staff_activity VALUES(?,?,?,?,?,?,?)',(activity_id,user_id,action,detail,ip,user_agent,now()))


def activity(cd, user_id, limit, offset):
    return rows(cd,'SELECT * FROM staff_activity WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?',
                (user_id,limit,offset))


def count_activity(cd, user_id):
    return cd.execute('SELECT COUNT(*) FROM staff_activity WHERE user_id=?',(user_id,)).fetchone()[0]


def purge_activity(cd, before):
    cd.execute('DELETE FROM staff_activity WHERE created_at<?',(before,))


# One-time challenges of a passkey ceremony
def insert_challenge(cd, challenge_hash, user_id, purpose, rp_id, origin, expires_at):
    cd.execute('DELETE FROM staff_challenges WHERE expires_at<=?',(now(),))
    cd.execute('INSERT INTO staff_challenges VALUES(?,?,?,?,?,?,?)',(challenge_hash,user_id,purpose,rp_id,origin,now(),expires_at))


def find_challenge(cd, challenge_hash, purpose):
    return one(cd,'SELECT * FROM staff_challenges WHERE challenge_hash=? AND purpose=? AND expires_at>?',(challenge_hash,purpose,now()))


def take_challenge(cd, challenge_hash):
    return cd.execute('DELETE FROM staff_challenges WHERE challenge_hash=?',(challenge_hash,)).rowcount


# The waiting second step of a sign-in
def insert_login_challenge(cd, token_hash, user_id, expires_at):
    cd.execute('DELETE FROM staff_login_challenges WHERE expires_at<=? OR user_id=?',(now(),user_id))
    cd.execute('INSERT INTO staff_login_challenges(token_hash,user_id,attempts,created_at,expires_at) VALUES(?,?,0,?,?)',
               (token_hash,user_id,now(),expires_at))


def login_challenge(cd, token_hash):
    return one(cd,'SELECT * FROM staff_login_challenges WHERE token_hash=? AND expires_at>?',(token_hash,now()))


def count_login_attempt(cd, token_hash):
    cd.execute('UPDATE staff_login_challenges SET attempts=attempts+1 WHERE token_hash=?',(token_hash,))


def delete_login_challenge(cd, token_hash):
    return cd.execute('DELETE FROM staff_login_challenges WHERE token_hash=?',(token_hash,)).rowcount
