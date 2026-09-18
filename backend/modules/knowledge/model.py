"""Tenant database: knowledge base articles, internal or published on the support page.

  knowledge_articles   the articles.
  knowledge_uses       each time a member copied an article, put it in a reply or sent its link (USE_KINDS); one per
                       member, article and kind within USE_REPEAT_MINUTES, so clicking twice counts once.
  knowledge_marks      each member's own mark on an article: helpful (1) or not (-1), and pinned to the top of their
                       list (pin_order, 1 first; 0 = not pinned).
  knowledge_revisions  the version an article had before each save that changed it (REVISIONS_KEPT per article)."""

VISIBILITIES = ('internal','public')
USE_KINDS = ('copy','insert','link')
USE_REPEAT_MINUTES = 10
PINS_MAX = 20
REVISIONS_KEPT = 50

TENANT_TABLES = '''
CREATE TABLE knowledge_articles (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL,
    body TEXT NOT NULL, visibility TEXT NOT NULL CHECK(visibility IN ('public','internal')),
    author TEXT NOT NULL, updated_at TEXT NOT NULL
);
'''

# Added later (backend/database/schema.py upgrade_tenant).
ACTIVITY_TABLES = '''
CREATE TABLE IF NOT EXISTS knowledge_uses (
    id TEXT PRIMARY KEY, article_id TEXT NOT NULL, user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('copy','insert','link')), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_uses_article ON knowledge_uses(article_id,user_id,kind,created_at);
CREATE TABLE IF NOT EXISTS knowledge_marks (
    article_id TEXT NOT NULL, user_id TEXT NOT NULL,
    vote INTEGER NOT NULL DEFAULT 0 CHECK(vote IN (-1,0,1)), pin_order INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL, PRIMARY KEY(article_id,user_id)
);
CREATE TABLE IF NOT EXISTS knowledge_revisions (
    id TEXT PRIMARY KEY, article_id TEXT NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL, body TEXT NOT NULL,
    visibility TEXT NOT NULL, author TEXT NOT NULL, saved_at TEXT NOT NULL, replaced_by TEXT NOT NULL, replaced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_revisions_article ON knowledge_revisions(article_id,replaced_at);
'''
