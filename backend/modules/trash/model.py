"""Tenant database: the recycle bin.

A delete does not throw the rows away; it moves a snapshot of them here. The snapshot is the JSON of every row
the delete removed, so restoring writes back exactly what was there - no partial rebuild, no guessing.
Items left untouched are cleared for good after KEEP_DAYS."""

TENANT_TABLES = '''CREATE TABLE IF NOT EXISTS trash (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, entity TEXT NOT NULL, title TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL, actor TEXT NOT NULL, deleted_at TEXT NOT NULL
)'''

KEEP_DAYS = 30

# What can be thrown away, which tables its snapshot covers, and who may put it back.
KINDS = {
    'article': {'label':'บทความ',     'tables':('knowledge_articles',),        'roles':('admin','manager')},
    'contact': {'label':'ข้อมูลลูกค้า', 'tables':('contacts','contact_names','contact_profiles'),   'roles':('admin','manager')},
    'ticket':  {'label':'เคสบริการ',   'tables':('tickets','ticket_conversations','ticket_tags'),'roles':('admin',)},
}
