"""Control database: organizations (tenants), platform-wide settings such as the registration email, and the global
FAQ the platform admin writes once for every organization. Each global article has one audience: the platform's own
admins, the admins and staff of every organization, or the end customers of every organization."""

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
    author TEXT NOT NULL, updated_at TEXT NOT NULL
);
'''
