"""Knowledge article queries."""
from backend.database.db import one, rows
from backend.utils.dates import now


def list_all(db):
    return rows(db,'SELECT * FROM knowledge_articles ORDER BY updated_at DESC')


def list_public(db):
    return rows(db,"SELECT id,title,category,body,updated_at FROM knowledge_articles WHERE visibility='public' ORDER BY updated_at DESC")


def exists(db, article_id):
    return bool(one(db,'SELECT id FROM knowledge_articles WHERE id=?',(article_id,)))


def find(db, article_id):
    return one(db,'SELECT * FROM knowledge_articles WHERE id=?',(article_id,))


def insert(db, article_id, title, category, body, visibility, author):
    db.execute('INSERT INTO knowledge_articles VALUES(?,?,?,?,?,?,?)',(article_id,title,category,body,visibility,author,now()))


def update(db, article_id, title, category, body, visibility, author):
    db.execute('UPDATE knowledge_articles SET title=?,category=?,body=?,visibility=?,author=?,updated_at=? WHERE id=?',(title,category,body,visibility,author,now(),article_id))


def delete(db, article_id):
    db.execute('DELETE FROM knowledge_articles WHERE id=?',(article_id,))
