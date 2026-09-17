"""Platform security (docs/SECURITY-DESIGN.md), everything in the control database:

  login_failures    progressive lockout, one row per typed email ('signin:<email>' for the shared sign-in page,
                    'staff:<email>' / 'customer:<email>' for the staff and customer endpoints), whether or not
                    an account exists. failures counts inside a 15-minute window; five lock the key for a time that
                    grows with level. locked_at is when the last lock started (level decays one step per 24 h after
                    it); locked_until is NULL once the lock has been followed by a sign-in, a reset or an unlock.
                    notified_at is when the owner was last emailed about a lock (at most once per 24 h).
  security_events   what the checks saw: failed sign-ins, locks, expired sessions, CSRF / Origin / cross-organization
                    refusals, rate limits, bad webhook signatures and guest links, blocked addresses and every
                    Superadmin change. Identical events (kind, ip, subject) in the same minute share one row (count).
                    Never a password, code, token or message text. Kept 90 days.
  security_alerts   rules the worker checks every minute (thresholds in the security settings); one open alert per
                    rule and address, updated while it continues.
  ip_blocks         addresses refused before anything else (HTTP and WebSocket), for a time or permanently.

Security settings (session limits per actor, alert thresholds) are one JSON value in platform_settings ('security')."""

CONTROL_TABLES = '''
CREATE TABLE IF NOT EXISTS login_failures (
    key TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, window_start TEXT, locked_until TEXT,
    level INTEGER NOT NULL DEFAULT 0, last_ip TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
    locked_at TEXT, notified_at TEXT
);
CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
    actor TEXT NOT NULL CHECK(actor IN ('staff','platform','customer','guest','anonymous')),
    subject TEXT NOT NULL DEFAULT '', tenant_id TEXT, ip TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '',
    count INTEGER NOT NULL DEFAULT 1, detail TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS security_events_at ON security_events(at);
CREATE INDEX IF NOT EXISTS security_events_kind_at ON security_events(kind,at);
CREATE INDEX IF NOT EXISTS security_events_ip_at ON security_events(ip,at);
CREATE TABLE IF NOT EXISTS security_alerts (
    id INTEGER PRIMARY KEY, rule TEXT NOT NULL, severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
    started_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, ip TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '', acknowledged_by TEXT, acknowledged_at TEXT
);
CREATE INDEX IF NOT EXISTS security_alerts_rule ON security_alerts(rule,ip,acknowledged_at);
CREATE TABLE IF NOT EXISTS ip_blocks (
    ip TEXT PRIMARY KEY, reason TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT
);
'''

# Columns the sessions gained (existing rows get the time of the upgrade, so nobody is signed out by it).
SESSION_COLUMNS = {'sessions':('created_at','last_active_at'),'customer_sessions':('last_active_at',)}

# Progressive lockout
LOCK_FAILURES = 5
LOCK_WINDOW_SECONDS = 15*60
LOCK_SECONDS = {1:5*60,2:15*60,3:3600}
LOCK_MAX_SECONDS = 24*3600
LEVEL_DECAY_SECONDS = 24*3600
LOCK_MAIL_SECONDS = 24*3600
LOCK_MESSAGE = 'ลงชื่อเข้าใช้ผิดหลายครั้ง กรุณาลองใหม่ในอีก {minutes} นาที'
# The lock keys of one typed email ('<kind>:<email>'): the shared sign-in page, the staff and the customer sign-in.
SIGN_IN_KEYS = ('signin','staff','customer')

# Sessions
EXPIRED_MESSAGE = 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบอีกครั้ง'
DEFAULT_SETTINGS = {
    'sessions':{'staff':{'idle_minutes':60,'absolute_hours':12},
                'platform':{'idle_minutes':30,'absolute_hours':8},
                'customer':{'idle_days':7,'absolute_days':30}},
    'alerts':{'ip_failed_logins_10m':30,'platform_failed_logins_10m':100,'locks_1h':10,
              'ip_rate_limited_10m':200,'webhook_failures_10m':20},
}
IDLE_BOUNDS = (5*60,30*86400)
ABSOLUTE_BOUNDS = (3600,90*86400)
ALERT_BOUNDS = (1,1000000)

# Events: kind -> default severity
EVENT_KINDS = {
    'login_failed':'info','login_locked':'warning','login_after_lock':'info','twofa_failed':'warning',
    'password_reset_requested':'info','password_reset_completed':'info','session_expired':'info',
    'sessions_revoked':'warning','rate_limited':'info','csrf_rejected':'warning','origin_rejected':'warning',
    'cross_tenant_denied':'warning','support_access':'info','webhook_signature_failed':'warning',
    'guest_link_invalid':'info','ip_blocked_request':'info','admin_unlock':'warning','admin_ip_block':'warning',
    'security_settings_changed':'critical',
}
SEVERITIES = ('info','warning','critical')
ACTORS = ('staff','platform','customer','guest','anonymous')
EVENT_KEEP_DAYS = 90
EVENT_ROWS_PER_MINUTE = 1000
FAILED_LOGIN_KINDS = ('login_failed','twofa_failed')
REJECTED_KINDS = ('csrf_rejected','origin_rejected','cross_tenant_denied','ip_blocked_request')

# Alerts: rule -> (severity, setting key, event kind, per address, window seconds)
ALERT_RULES = {
    'ip_failed_logins':('warning','ip_failed_logins_10m','login_failed',True,600),
    'platform_failed_logins':('critical','platform_failed_logins_10m','login_failed',False,600),
    'locks':('critical','locks_1h','login_locked',False,3600),
    'ip_rate_limited':('warning','ip_rate_limited_10m','rate_limited',True,600),
    'webhook_failures':('warning','webhook_failures_10m','webhook_signature_failed',False,600),
}
ALERT_LABELS = {
    'ip_failed_logins':'เข้าสู่ระบบล้มเหลวจาก IP เดียวจำนวนมาก','platform_failed_logins':'เข้าสู่ระบบล้มเหลวทั้งแพลตฟอร์มจำนวนมาก',
    'locks':'บัญชีถูกล็อกจำนวนมาก','ip_rate_limited':'คำขอถี่ผิดปกติจาก IP เดียว','webhook_failures':'ลายเซ็น Webhook ไม่ถูกต้องจำนวนมาก',
}
ALERT_MAIL_SECONDS = 3600

# IP blocks
BLOCK_DURATIONS = {'1h':3600,'24h':86400,'7d':7*86400,'permanent':None}
BLOCKED_MESSAGE = 'ไม่สามารถเข้าถึงระบบได้จากเครือข่ายนี้'
BLOCK_CACHE_SECONDS = 30
