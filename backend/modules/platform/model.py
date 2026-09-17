"""Control database: organizations (tenants), platform-wide settings such as the registration email, and the global
FAQ the platform admin writes once for every organization. Each global article has one audience: the platform's own
admins, the admins and staff of every organization, or the end customers of every organization.

An article reaches its readers only once published, because a mistake would show in every organization at once. A new
article is a draft (published_at NULL). Changes to a published article wait in `draft` (JSON of title, category, body
and audience) while readers keep the published version, until the admin publishes them or throws them away."""

TENANT_STATUSES = ('active','suspended')
GLOBAL_AUDIENCES = ('platform','staff','customer')

CONTROL_TABLES = '''
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS global_articles (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, body TEXT NOT NULL,
    audience TEXT NOT NULL CHECK(audience IN ('platform','staff','customer')),
    author TEXT NOT NULL, updated_at TEXT NOT NULL,
    published_at TEXT, draft TEXT
);
'''
