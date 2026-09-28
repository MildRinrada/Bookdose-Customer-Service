"""Security of a customer account (staff sign-in is untouched): two-factor sign-in, passkeys, the devices that are
signed in, and what happened to the account.

Everything lives in the control database, because one account works with every organization.
  customer_totp            one row per account: the shared secret, when it was confirmed, and the last step a code
                           was accepted for (a step is never accepted twice). No row, or confirmed_at NULL, means
                           two-factor sign-in is not on yet.
  customer_recovery_codes  ten codes, stored hashed, each usable once; shown to the customer only when made.
  customer_passkeys        a registered WebAuthn credential: its id, the COSE public key, the algorithm and the
                           signature counter (a counter that does not move forward means a copy - refused).
  customer_challenges      the one-time random value of a passkey registration or sign-in (5 minutes). Stored
                           hashed and deleted the moment it is used, so a challenge can never be replayed.
  customer_login_challenges  a password was right but the account asks for a second step: a short-lived token in
                           an HttpOnly cookie, five tries.
  customer_activity        the account's own history (sign-ins, two-factor, passkeys, sessions, the password).
Secrets are never written to it: only what happened, from which address and browser.

The sessions themselves stay in customers.customer_sessions, which gained id / user_agent / ip / last_seen_at."""

TOTP_ISSUER = 'Bookdose'          # what an authenticator app calls the account (ASCII, so the QR stays small)
RECOVERY_COUNT = 10
RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'   # no 0/O/1/I: a code is read off a printout
RECOVERY_GROUP = 5                # the code is two groups of five, written 'XXXXX-XXXXX'
CHALLENGE_MINUTES = 5
LOGIN_CHALLENGE_MINUTES = 5
LOGIN_CHALLENGE_TRIES = 5
SEEN_SECONDS = 300                # last_seen_at of a session is written at most this often
ACTIVITY_PAGE = 20
ACTIVITY_KEEP_DAYS = 365

# What the activity log records, and the Thai words the customer reads. 'login_failed' is only ever recorded for an
# email that has an account, so the log of one account cannot be filled by guessing another's.
ACTIVITY_LABELS = {
    'login':'เข้าสู่ระบบ','login_failed':'รหัสผ่านไม่ถูกต้อง','login_2fa':'เข้าสู่ระบบด้วยรหัสยืนยันสองขั้นตอน',
    'login_recovery':'เข้าสู่ระบบด้วยรหัสสำรอง','login_passkey':'เข้าสู่ระบบด้วย Passkey','logout':'ออกจากระบบ',
    'totp_on':'เปิดการยืนยันสองขั้นตอน','totp_off':'ปิดการยืนยันสองขั้นตอน','recovery_new':'สร้างรหัสสำรองชุดใหม่',
    'passkey_added':'เพิ่ม Passkey','passkey_renamed':'เปลี่ยนชื่อ Passkey','passkey_removed':'ลบ Passkey',
    'passkey_refused':'ปฏิเสธ Passkey ที่อาจถูกทำสำเนา','passkeys_cleared':'ลบ Passkey ทั้งหมดเมื่อตั้งรหัสผ่านใหม่',
    'password':'เปลี่ยนรหัสผ่าน','password_reset':'ตั้งรหัสผ่านใหม่จากลิงก์',
    'profile':'แก้ไขข้อมูลส่วนตัว','session_revoked':'ออกจากระบบอุปกรณ์เครื่องหนึ่ง','sessions_revoked':'ออกจากระบบทุกอุปกรณ์',
    'account_linked':'มีบัญชีอื่นเข้าสู่ระบบร่วมในเบราว์เซอร์เดียวกัน','account_switched':'สลับเข้าบัญชีนี้จากบัญชีอื่น',
    # Platform admins only (security/admin_guard.py, sign_in_alerts.py)
    'reauth':'ยืนยันรหัสผ่านก่อนทำรายการสำคัญ','reauth_failed':'ยืนยันรหัสผ่านไม่ถูกต้อง',
    'reauth_signed_out':'ออกจากระบบเพราะยืนยันรหัสผ่านผิดหลายครั้ง','sign_in_disowned':'แจ้งว่าไม่ใช่ฉัน และยุติการเข้าสู่ระบบครั้งนั้น',
}

CONTROL_TABLES = '''
CREATE TABLE IF NOT EXISTS customer_totp (
    account_id TEXT PRIMARY KEY, secret TEXT NOT NULL, confirmed_at TEXT, last_step INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_recovery_codes (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, code_hash TEXT NOT NULL, created_at TEXT NOT NULL, used_at TEXT
);
CREATE TABLE IF NOT EXISTS customer_passkeys (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, credential_id TEXT NOT NULL UNIQUE, public_key TEXT NOT NULL,
    alg INTEGER NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL DEFAULT '',
    transports TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, last_used_at TEXT
);
CREATE TABLE IF NOT EXISTS customer_challenges (
    challenge_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL DEFAULT '', purpose TEXT NOT NULL,
    rp_id TEXT NOT NULL, origin TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_login_challenges (
    token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_activity (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_recovery_account ON customer_recovery_codes(account_id);
CREATE INDEX IF NOT EXISTS customer_passkeys_account ON customer_passkeys(account_id);
CREATE INDEX IF NOT EXISTS customer_activity_account ON customer_activity(account_id,created_at);
'''
