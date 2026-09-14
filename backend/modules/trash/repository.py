"""Recycle bin queries."""
from backend.database.db import one, rows


def insert(db, item_id, kind, entity, title, detail, payload, actor, deleted_at):
    db.execute('INSERT INTO trash VALUES(?,?,?,?,?,?,?,?)',(item_id,kind,entity,title,detail,payload,actor,deleted_at))


def list_all(db):
    return rows(db,'SELECT id,kind,entity,title,detail,actor,deleted_at FROM trash ORDER BY deleted_at DESC')


def find(db, item_id):
    return one(db,'SELECT * FROM trash WHERE id=?',(item_id,))


def delete(db, item_id):
    db.execute('DELETE FROM trash WHERE id=?',(item_id,))


def delete_expired(db, cutoff):
    return db.execute('DELETE FROM trash WHERE deleted_at<?',(cutoff,)).rowcount


def row_exists(db, table, row_id, column='id'):
    return bool(one(db,f'SELECT 1 AS found FROM {table} WHERE {column}=?',(row_id,)))


def conversation_free(db, conversation_id):
    """A conversation can be linked back to its case only while it still exists and belongs to no other case."""
    return bool(one(db,'SELECT 1 AS found FROM conversations WHERE id=?',(conversation_id,))) \
        and not one(db,'SELECT 1 AS found FROM ticket_conversations WHERE conversation_id=?',(conversation_id,))
