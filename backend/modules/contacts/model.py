"""Tenant database: customer (contact) records."""

TENANT_TABLES = '''
CREATE TABLE contacts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
'''

# Added later: what the team keeps about how to look after a customer (the edit form's second part): the team's own
# tags, a warning shown on the customer's chats and cases, how and when they like to be contacted, the language to
# answer in (the AI answers in it too), whether they agreed to be contacted back and when they asked to have their
# data deleted. One row per contact, made on its first save.
PREFERRED_CHANNELS = ('web','line','facebook','instagram','email','phone')
LANGUAGES = ('th','en')
CONSENTS = ('yes','no')
TAGS_MAX = 10
TAG_MAX = 30
WARNING_MAX = 300
HOURS_MAX = 80

PROFILE_TABLE = '''CREATE TABLE IF NOT EXISTS contact_profiles (
    contact_id TEXT PRIMARY KEY, preferred_channel TEXT NOT NULL DEFAULT '', contact_hours TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', warning TEXT NOT NULL DEFAULT '',
    consent TEXT NOT NULL DEFAULT '', consent_at TEXT, consent_by TEXT NOT NULL DEFAULT '',
    deletion_requested_at TEXT, deletion_requested_by TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)'''

# Added later: first and last name kept separately (contacts.name holds both).
NAME_TABLE = '''CREATE TABLE IF NOT EXISTS contact_names (
    contact_id TEXT PRIMARY KEY REFERENCES contacts(id), first_name TEXT NOT NULL,
    last_name TEXT NOT NULL DEFAULT '')'''
