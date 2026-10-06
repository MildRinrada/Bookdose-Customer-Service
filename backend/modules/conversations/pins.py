"""ปักหมุดข้อความในแชท: a message either side wants to keep to hand - the address the team asked for, the order
number, what was agreed - is pinned, and sits in a strip above the conversation that jumps to the message itself.

Shared, the way a pin in a group chat both sides read is: the team and the customer see the same pins and either may
pin or take a pin back. MOST at a time, so the strip stays a strip rather than becoming a second thread. Not on a
message that was taken back, and only on a web chat: a LINE thread's pins belong to LINE, not here.

An internal note may be pinned too - the team pins what the team needs - and the customer never sees it, because the
strip is built from the messages each side is given (conversations/service.message_list) and a note is not in theirs.

  message_pins  what is pinned in a conversation."""
from backend.database.db import begin, one, rows
from backend.realtime import events as realtime
from backend.utils.dates import now
from backend.utils.validation import require

# As many as a strip above the messages can hold without pushing the conversation off the screen.
MOST = 3
FULL = f'ปักหมุดได้ครั้งละ {MOST} ข้อความ · เอาหมุดเดิมออกก่อนแล้วค่อยปักใหม่'

TABLE = '''
CREATE TABLE IF NOT EXISTS message_pins (
    message_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, pinned_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS message_pins_conversation ON message_pins(conversation_id);
'''


def of_conversation(db, conversation_id):
    """The ids pinned in this conversation."""
    return {r['message_id'] for r in rows(db,'SELECT message_id FROM message_pins WHERE conversation_id=?',(conversation_id,))}


def forget(db, message_id):
    """A message that is taken back takes its pin with it; the strip must not point at words that are gone."""
    db.execute('DELETE FROM message_pins WHERE message_id=?',(message_id,))


def pin(db, conv, message_id, who, body):
    """Pin or unpin a message of `conv` (already checked to be the asker's): {'pinned': true/false}. Both sides hear
    about it. `who` is the name kept with the pin, for the team's own screens."""
    wanted = bool(body.get('pinned',True))
    require(conv['channel']=='web','ปักหมุดได้เฉพาะแชทบนเว็บ')
    begin(db)
    message = one(db,'SELECT id,kind,deleted_at FROM messages WHERE id=? AND conversation_id=?',(message_id,conv['id']))
    require(message and not message['deleted_at'],'ไม่พบข้อความนี้',404)
    if wanted:
        already = one(db,'SELECT COUNT(*) AS many FROM message_pins WHERE conversation_id=?',(conv['id'],))['many']
        pinned_now = one(db,'SELECT message_id FROM message_pins WHERE message_id=?',(message_id,))
        require(pinned_now or already<MOST,FULL,409)
        db.execute('''INSERT INTO message_pins(message_id,conversation_id,pinned_by,created_at) VALUES(?,?,?,?)
                      ON CONFLICT(message_id) DO UPDATE SET pinned_by=excluded.pinned_by,created_at=excluded.created_at''',
                   (message_id,conv['id'],who,now()))
    else:
        forget(db,message_id)
    # Not a new message: the inbox list keeps its order.
    realtime.conversation(db,conv['id'],public=message['kind']!='note',listed=False)
    db.commit()
    return {'pinned':wanted}
