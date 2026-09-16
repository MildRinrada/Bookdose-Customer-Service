"""Queries of the customer account's security (control database only). Secrets are stored the way they are used:
the TOTP secret as it must be (it is a shared secret), every code and token only as a SHA-256 hash."""
from backend.database.db import one, rows
from backend.utils.dates import now


# Two-factor sign-in (TOTP)
def totp(cd, account_id):
    return one(cd,'SELECT * FROM customer_totp WHERE account_id=?',(account_id,))


def start_totp(cd, account_id, secret):
    """A setup that is not confirmed yet; a second setup replaces the first."""
    cd.execute('''INSERT INTO customer_totp(account_id,secret,confirmed_at,last_step,created_at) VALUES(?,?,NULL,0,?)
                  ON CONFLICT(account_id) DO UPDATE SET secret=excluded.secret,confirmed_at=NULL,last_step=0,created_at=excluded.created_at''',
               (account_id,secret,now()))


def confirm_totp(cd, account_id, step):
    """Turn two-factor sign-in on, only from a setup still waiting to be confirmed."""
    return cd.execute('UPDATE customer_totp SET confirmed_at=?,last_step=? WHERE account_id=? AND confirmed_at IS NULL',
                      (now(),step,account_id)).rowcount


def use_totp_step(cd, account_id, step):
    """Mark the step a code was accepted for; 0 rows means another request used it first (never accepted twice)."""
    return cd.execute('UPDATE customer_totp SET last_step=? WHERE account_id=? AND last_step<?',(step,account_id,step)).rowcount


def delete_totp(cd, account_id):
    cd.execute('DELETE FROM customer_totp WHERE account_id=?',(account_id,))


# Recovery codes
def recovery_codes(cd, account_id):
    return rows(cd,'SELECT * FROM customer_recovery_codes WHERE account_id=? ORDER BY rowid',(account_id,))


def replace_recovery_codes(cd, account_id, hashed):
    cd.execute('DELETE FROM customer_recovery_codes WHERE account_id=?',(account_id,))
    cd.executemany('INSERT INTO customer_recovery_codes(id,account_id,code_hash,created_at) VALUES(?,?,?,?)',
                   [(code_id,account_id,code_hash,now()) for code_id,code_hash in hashed])


def use_recovery_code(cd, code_id):
    """0 rows when it was already used: a code works exactly once."""
    return cd.execute('UPDATE customer_recovery_codes SET used_at=? WHERE id=? AND used_at IS NULL',(now(),code_id)).rowcount


def delete_recovery_codes(cd, account_id):
    cd.execute('DELETE FROM customer_recovery_codes WHERE account_id=?',(account_id,))


# Passkeys
def passkeys(cd, account_id):
    return rows(cd,'SELECT * FROM customer_passkeys WHERE account_id=? ORDER BY created_at,rowid',(account_id,))


def passkey(cd, account_id, passkey_id):
    return one(cd,'SELECT * FROM customer_passkeys WHERE account_id=? AND id=?',(account_id,passkey_id))


def passkey_by_credential(cd, credential_id):
    return one(cd,'SELECT * FROM customer_passkeys WHERE credential_id=?',(credential_id,))


def insert_passkey(cd, passkey_id, account_id, credential, name):
    cd.execute('''INSERT INTO customer_passkeys(id,account_id,credential_id,public_key,alg,sign_count,name,transports,created_at)
                  VALUES(?,?,?,?,?,?,?,?,?)''',(passkey_id,account_id,credential['credential_id'],credential['public_key'],
                  credential['alg'],credential['sign_count'],name,credential['transports_json'],now()))


def rename_passkey(cd, passkey_id, name):
    cd.execute('UPDATE customer_passkeys SET name=? WHERE id=?',(name,passkey_id))


def use_passkey(cd, passkey_id, sign_count):
    cd.execute('UPDATE customer_passkeys SET sign_count=?,last_used_at=? WHERE id=?',(sign_count,now(),passkey_id))


def delete_passkey(cd, passkey_id):
    cd.execute('DELETE FROM customer_passkeys WHERE id=?',(passkey_id,))


def delete_passkeys(cd, account_id):
    """Every passkey of the account (a password reset starts from nothing); how many there were."""
    return cd.execute('DELETE FROM customer_passkeys WHERE account_id=?',(account_id,)).rowcount


# One-time challenges of a passkey ceremony
def insert_challenge(cd, challenge_hash, account_id, purpose, rp_id, origin, expires_at):
    cd.execute('DELETE FROM customer_challenges WHERE expires_at<=?',(now(),))
    cd.execute('INSERT INTO customer_challenges VALUES(?,?,?,?,?,?,?)',
               (challenge_hash,account_id,purpose,rp_id,origin,now(),expires_at))


def find_challenge(cd, challenge_hash, purpose):
    return one(cd,'SELECT * FROM customer_challenges WHERE challenge_hash=? AND purpose=? AND expires_at>?',
               (challenge_hash,purpose,now()))


def take_challenge(cd, challenge_hash):
    """Remove it; 0 rows means it was already used (a challenge is good for exactly one answer)."""
    return cd.execute('DELETE FROM customer_challenges WHERE challenge_hash=?',(challenge_hash,)).rowcount


# The waiting second step of a sign-in
def insert_login_challenge(cd, token_hash, account_id, expires_at):
    cd.execute('DELETE FROM customer_login_challenges WHERE expires_at<=? OR account_id=?',(now(),account_id))
    cd.execute('INSERT INTO customer_login_challenges(token_hash,account_id,attempts,created_at,expires_at) VALUES(?,?,0,?,?)',
               (token_hash,account_id,now(),expires_at))


def login_challenge(cd, token_hash):
    return one(cd,'SELECT * FROM customer_login_challenges WHERE token_hash=? AND expires_at>?',(token_hash,now()))


def count_login_attempt(cd, token_hash):
    cd.execute('UPDATE customer_login_challenges SET attempts=attempts+1 WHERE token_hash=?',(token_hash,))


def delete_login_challenge(cd, token_hash):
    return cd.execute('DELETE FROM customer_login_challenges WHERE token_hash=?',(token_hash,)).rowcount


# Activity log
def insert_activity(cd, activity_id, account_id, action, detail, ip, user_agent):
    cd.execute('INSERT INTO customer_activity VALUES(?,?,?,?,?,?,?)',
               (activity_id,account_id,action,detail,ip,user_agent,now()))


def activity(cd, account_id, limit, offset):
    return rows(cd,'SELECT * FROM customer_activity WHERE account_id=? ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?',
                (account_id,limit,offset))


def count_activity(cd, account_id):
    return cd.execute('SELECT COUNT(*) FROM customer_activity WHERE account_id=?',(account_id,)).fetchone()[0]


def purge_activity(cd, before):
    cd.execute('DELETE FROM customer_activity WHERE created_at<?',(before,))
