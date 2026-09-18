"""Control database: user accounts, profile pictures, sign-in sessions, self-registration and password-reset links.
A pending registration has no account or organization access until its email is verified."""

CONTROL_TABLES = '''
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password TEXT NOT NULL, platform_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), tenant_id TEXT,
    csrf TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_registrations (
    email TEXT PRIMARY KEY COLLATE NOCASE, name TEXT NOT NULL, password TEXT NOT NULL,
    organization TEXT NOT NULL, slug TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL, last_sent_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_verifications (
    user_id TEXT PRIMARY KEY REFERENCES users(id), verified_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id), avatar TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS staff_resets (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS staff_resets_user ON staff_resets(user_id,created_at);
'''

# A staff member who forgot their password gets one link at a time; it lasts an hour and signs nobody in by itself.
RESET_SECONDS = 3600
RESET_RESEND_SECONDS = 60
