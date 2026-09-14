"""Tenant database: knowledge base articles, internal or published on the support page."""

VISIBILITIES = ('internal','public')

TENANT_TABLES = '''
CREATE TABLE knowledge_articles (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL,
    body TEXT NOT NULL, visibility TEXT NOT NULL CHECK(visibility IN ('public','internal')),
    author TEXT NOT NULL, updated_at TEXT NOT NULL
);
'''
