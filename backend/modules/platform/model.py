"""Control database: organizations (tenants), platform-wide settings such as the registration email, and the global
FAQ the platform admin writes once for every organization. Each global article has one audience: the platform's own
admins, the admins and staff of every organization, or the end customers of every organization.

An article reaches its readers only once published, because a mistake would show in every organization at once. A new
article is a draft (published_at NULL). Changes to a published article wait in `draft` (JSON of title, category, body
and audience) while readers keep the published version, until the admin publishes them or throws them away.

problem_reports is what a member of any organization sends from the ? in the top bar: a bug, something that does not
work, something missing. It belongs to the platform, not to an organization - the organization's own admins cannot
fix the product - so it is kept here and read in the platform console. The message is the member's own words; the
page and the browser are recorded with it so the report can be reproduced."""

TENANT_STATUSES = ('active','suspended')
GLOBAL_AUDIENCES = ('platform','staff','customer')
REPORT_STATUSES = ('open','done')
REPORT_MAX = 4000

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
CREATE TABLE IF NOT EXISTS problem_reports (
    id TEXT PRIMARY KEY,
    tenant_id TEXT, tenant_name TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL, user_name TEXT NOT NULL DEFAULT '', user_email TEXT NOT NULL DEFAULT '',
    page TEXT NOT NULL DEFAULT '', message TEXT NOT NULL, browser TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
    created_at TEXT NOT NULL, handled_at TEXT, handled_by TEXT
);
CREATE INDEX IF NOT EXISTS problem_reports_open ON problem_reports(status,created_at);
'''
