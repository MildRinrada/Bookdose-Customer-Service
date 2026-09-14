"""Tenant database: customer (contact) records."""

TENANT_TABLES = '''
CREATE TABLE contacts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
'''

# Added later: first and last name kept separately (contacts.name holds both).
NAME_TABLE = '''CREATE TABLE IF NOT EXISTS contact_names (
    contact_id TEXT PRIMARY KEY REFERENCES contacts(id), first_name TEXT NOT NULL,
    last_name TEXT NOT NULL DEFAULT '')'''
