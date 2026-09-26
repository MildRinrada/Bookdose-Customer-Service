"""Platform security (docs/security/README.md), everything in the control database:

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
  honeytokens       traps a Superadmin plants (docs/security/monitoring-and-traps.md): a decoy account email, an API key, a password
                    or a shared-file link that no real user ever uses. Only the SHA-256 of the secret is kept (the
                    decoy email itself is kept too: it is what a sign-in types); lookup_prefix (its first 12
                    characters) lets a request be checked in memory before anything is hashed.

Security settings (session limits per actor, alert thresholds, honeypots) are one JSON value in platform_settings
('security')."""

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
CREATE TABLE IF NOT EXISTS honeytokens (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('decoy_account','api_key','password','link')),
    label TEXT NOT NULL, placed_at_note TEXT NOT NULL DEFAULT '', secret_hash TEXT NOT NULL, lookup_prefix TEXT NOT NULL,
    decoy_email TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    trigger_count INTEGER NOT NULL DEFAULT 0, last_triggered_at TEXT, last_ip TEXT
);
CREATE INDEX IF NOT EXISTS honeytokens_prefix ON honeytokens(lookup_prefix);
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
    'honeypot':{'paths_enabled':True,'forms_enabled':True,'custom_api_paths':[],
                'block_on_path_hits':{'enabled':True,'hits':3,'window_minutes':10,'duration':'1h'},
                'block_on_honeytoken':{'enabled':True,'duration':'24h'}},
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
    # Cloudflare Turnstile (backend/extensions/turnstile.py)
    'captcha_failed':'warning','captcha_unavailable':'warning',
    # Honeypots and honeytokens (docs/security/monitoring-and-traps.md)
    'honeypot_path':'warning','honeypot_form':'warning','honeytoken_triggered':'critical','trap_ip_block':'warning',
}
TRAP_EVENT_KINDS = ('honeypot_path','honeypot_form','honeytoken_triggered','trap_ip_block')
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
    'honeytoken':'มีการใช้กับดัก (Honeytoken)',
}
ALERT_MAIL_SECONDS = 3600

# IP blocks
BLOCK_DURATIONS = {'1h':3600,'24h':86400,'7d':7*86400,'permanent':None}
BLOCKED_MESSAGE = 'ไม่สามารถเข้าถึงระบบได้จากเครือข่ายนี้'
BLOCK_CACHE_SECONDS = 30

# Honeypots and honeytokens (docs/security/monitoring-and-traps.md)
# Decoy paths nobody using the app ever opens: API ones (answered like any unknown API path) and the page ones the
# Next.js app reports through POST /api/trap (also caught here when a scanner reaches this server directly).
# Lower case, no trailing slash; 'prefix' covers the path itself and everything below it.
DECOY_API_PATHS = ('/api/admin','/api/v1/users','/api/users/export','/api/debug','/api/internal/config','/api/graphql',
                   '/api/swagger.json','/api/.env')
DECOY_PAGE_PATHS = ('/.env','/.env.local','/.git/config','/wp-login.php','/wp-admin','/xmlrpc.php','/phpmyadmin','/pma',
                    '/admin.php','/administrator','/server-status','/actuator/env','/config.json','/backup.zip',
                    '/backup.sql','/db.sql','/.ds_store','/id_rsa')
DECOY_PAGE_PREFIXES = ('/vendor/phpunit',)
MAX_CUSTOM_PATHS = 50
# Namespaces a custom decoy may never sit in: routed by pattern or by other servers (the Python realtime sockets).
RESERVED_API_PREFIXES = ('/api/public/','/api/customer/','/api/webhooks/','/api/realtime/','/api/channel-files/')
TRAP_PATH = '/api/trap'
# The header the Next.js app puts on its own trap reports (it strips it from every browser request it forwards).
TRAP_HEADER = 'X-Bookdose-Trap'
FILE_LINK_PREFIX = '/files/'
# The hidden form field (a visually hidden text box people never fill). 'company_website' is accepted as well.
HIDDEN_FIELDS = ('website','company_website')
HIDDEN_FORMS = ('sign_in','staff_register','customer_register','customer_forgot','guest_chat')
HONEYTOKEN_KINDS = ('decoy_account','api_key','password','link')
MAX_HONEYTOKENS = 200
API_KEY_MARKER = 'bdk_live_'
LOOKUP_PREFIX_LENGTH = 12
MAX_SCAN_BODY_BYTES = 1024*1024
TRAP_CACHE_SECONDS = 30
HONEYTOKEN_MAIL_SECONDS = 3600
TRAP_BLOCKER = 'ระบบกับดัก'
PATH_HIT_BOUNDS = {'hits':(1,1000),'window_minutes':(1,1440)}
