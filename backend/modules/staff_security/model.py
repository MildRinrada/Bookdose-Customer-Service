"""Two-factor sign-in and passkeys for staff accounts (the members of organizations and the platform admins), kept
in the control database because one account works in every organization it belongs to. The same rules as the
customer's (customer_security/service.py): a TOTP step is accepted once, a recovery code works once, every passkey
challenge is random, one-time and short, a passkey with user verification counts as both factors, and adding or
removing a way in costs the account's password.

  staff_totp              the shared secret (sealed, utils/secret_box), when it was confirmed, the last step used.
  staff_recovery_codes    ten codes, stored hashed, each usable once.
  staff_passkeys          registered WebAuthn credentials (id, COSE public key, algorithm, signature counter).
  staff_challenges        one-time passkey challenges (hashed, five minutes).
  staff_login_challenges  a right password on an account that asks for a second step: a short-lived token in an
                          HttpOnly cookie, five tries.
  staff_activity          the account's own history, as a customer's (ตั้งค่าบัญชี → ความปลอดภัย): sign-ins, wrong
                          passwords, two-factor, passkeys, devices signed out, the password and the profile, each with
                          the address and browser it came from.
What happens to the account is also written to the platform's history (audit_logs), never a code or a secret.

The sessions themselves stay in auth.sessions, which gained id / user_agent / ip (SESSION_COLUMNS) so the owner can see
the devices signed in and sign one out."""

from backend.modules.customer_security.model import (ACTIVITY_KEEP_DAYS, ACTIVITY_LABELS, ACTIVITY_PAGE, CHALLENGE_MINUTES,
                                                     LOGIN_CHALLENGE_MINUTES, LOGIN_CHALLENGE_TRIES, RECOVERY_ALPHABET,
                                                     RECOVERY_COUNT, RECOVERY_GROUP, TOTP_ISSUER)

__all__ = ['ACTIVITY_KEEP_DAYS','ACTIVITY_LABELS','ACTIVITY_PAGE','CHALLENGE_MINUTES','LOGIN_CHALLENGE_MINUTES',
           'LOGIN_CHALLENGE_TRIES','RECOVERY_ALPHABET','RECOVERY_COUNT','RECOVERY_GROUP','TOTP_ISSUER','CONTROL_TABLES',
           'CHALLENGE_COOKIE','SESSION_COLUMNS']

CHALLENGE_COOKIE = 'bookdose_staff_2fa'

# Added to auth's sessions table: the id the device list names a session by (the token stays secret), and where it
# was opened from. Sessions from before the upgrade get an id and show as an unknown device.
SESSION_COLUMNS = {'id':"TEXT NOT NULL DEFAULT ''",'user_agent':"TEXT NOT NULL DEFAULT ''",'ip':"TEXT NOT NULL DEFAULT ''",
                   'browser':"TEXT NOT NULL DEFAULT ''",'confirmed_at':'TEXT'}
# 'confirmed_at': when the session last proved its password again before a dangerous act of the platform console
# (security/admin_guard.py); empty means its sign-in, which counts too.
# 'browser' groups the accounts signed in on one browser (the account switcher, like Google's): a new sign-in made
# while another account is signed in joins that account's group, and switching moves the cookie inside the group.
# A session on its own is a group of one (browser = its id). At most BROWSER_ACCOUNTS accounts share a browser.
BROWSER_ACCOUNTS = 5

CONTROL_TABLES = '''
CREATE TABLE IF NOT EXISTS staff_totp (
    user_id TEXT PRIMARY KEY, secret TEXT NOT NULL, confirmed_at TEXT, last_step INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_recovery_codes (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, code_hash TEXT NOT NULL, created_at TEXT NOT NULL, used_at TEXT
);
CREATE TABLE IF NOT EXISTS staff_passkeys (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, credential_id TEXT NOT NULL UNIQUE, public_key TEXT NOT NULL,
    alg INTEGER NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL DEFAULT '',
    transports TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, last_used_at TEXT
);
CREATE TABLE IF NOT EXISTS staff_challenges (
    challenge_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT '', purpose TEXT NOT NULL,
    rp_id TEXT NOT NULL, origin TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_login_challenges (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_activity (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS staff_recovery_user ON staff_recovery_codes(user_id);
CREATE INDEX IF NOT EXISTS staff_passkeys_user ON staff_passkeys(user_id);
CREATE INDEX IF NOT EXISTS staff_activity_user ON staff_activity(user_id,created_at);
'''
