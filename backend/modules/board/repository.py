"""board_notes (each organization's database)."""
from backend.database.db import one, rows
from backend.utils.dates import now


def handover(db, since, limit):
    return rows(db,'''SELECT id,user_id,author_name,body,created_at FROM board_notes WHERE kind='handover' AND created_at>=?
                    ORDER BY created_at DESC,rowid DESC LIMIT ?''',(since,limit))


def todos(db, user_id, done_since):
    """The member's open to-dos (timed ones first, by time) and the ones ticked since `done_since`."""
    return rows(db,'''SELECT id,body,due_at,done_at,created_at FROM board_notes WHERE kind='todo' AND user_id=?
                    AND (done_at IS NULL OR done_at>=?) ORDER BY done_at IS NOT NULL,due_at IS NULL,due_at,created_at''',(user_id,done_since))


def open_todo_count(db, user_id):
    return db.execute("SELECT COUNT(*) FROM board_notes WHERE kind='todo' AND user_id=? AND done_at IS NULL",(user_id,)).fetchone()[0]


def find(db, note_id):
    return one(db,'SELECT * FROM board_notes WHERE id=?',(note_id,))


def insert(db, note_id, kind, user_id, author_name, body, due_at):
    db.execute('INSERT INTO board_notes(id,kind,user_id,author_name,body,due_at,created_at) VALUES(?,?,?,?,?,?,?)',
               (note_id,kind,user_id,author_name,body,due_at,now()))


def set_done(db, note_id, done):
    db.execute('UPDATE board_notes SET done_at=? WHERE id=?',(now() if done else None,note_id))


def delete(db, note_id):
    db.execute('DELETE FROM board_notes WHERE id=?',(note_id,))
