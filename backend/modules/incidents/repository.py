"""Queries of the known-issue notices (model.py)."""
from backend.database.db import one, rows
from backend.utils.dates import now

COLUMNS = 'id,title,detail,status,author_name,created_at,updated_at,resolved_at'


def shown_since(db, resolved_since):
    """Active notices, then the ones resolved since `resolved_since`, newest first."""
    return rows(db,f'''SELECT {COLUMNS} FROM known_issues WHERE status='active' OR resolved_at>=?
                       ORDER BY status='resolved',created_at DESC''',(resolved_since,))


def active_count(db):
    return db.execute("SELECT COUNT(*) FROM known_issues WHERE status='active'").fetchone()[0]


def find(db, issue_id):
    return one(db,f'SELECT {COLUMNS} FROM known_issues WHERE id=?',(issue_id,))


def insert(db, issue_id, title, detail, author):
    db.execute("INSERT INTO known_issues(id,title,detail,status,author_name,created_at,updated_at) VALUES(?,?,?,'active',?,?,?)",
               (issue_id,title,detail,author,now(),now()))


def update(db, issue_id, title, detail, status):
    db.execute('''UPDATE known_issues SET title=?,detail=?,status=?,updated_at=?,
                  resolved_at=CASE WHEN ?='resolved' THEN COALESCE(resolved_at,?) ELSE NULL END WHERE id=?''',
               (title,detail,status,now(),status,now(),issue_id))


def delete(db, issue_id):
    db.execute('DELETE FROM known_issues WHERE id=?',(issue_id,))
