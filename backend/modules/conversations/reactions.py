"""รีแอคข้อความ: on the web chat the customer answers a team reply with an emoji (resting the pointer on the reply
shows them: 👍 ❤️ 😂 😮 😢 🙏) instead of typing "ขอบคุณค่ะ". Typed after a case is finished, those words are a
message, and a message sends the case back to the team (tickets.reopen_for_conversation) for a thank-you nobody needs
to answer. A reaction is not a message: it reopens nothing, moves nothing in the queue and leaves the thank-you card
where it is. It only tells the team, on their reply, how the customer took it.

One reaction per reply: choosing another changes it, choosing the same again takes it back. Not on the satisfaction
survey (its stars are the answer), nor on a reply the team took back.

  message_reactions  the customer's reaction to a team reply of a web conversation."""
from backend.database.db import begin, one, rows
from backend.realtime import events as realtime
from backend.utils.dates import now
from backend.utils.validation import require

# 👍 ❤️ 😂 😮 😢 🙏 (frontend inbox/components/MessageThread REACTIONS).
REACTIONS = ('like','heart','laugh','wow','sad','thanks')

REACTIONS_TABLE = '''CREATE TABLE IF NOT EXISTS {name} (
    message_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
    reaction TEXT NOT NULL CHECK(reaction IN ('like','heart','laugh','wow','sad','thanks')), created_at TEXT NOT NULL
)'''
TABLE = REACTIONS_TABLE.format(name='message_reactions')+''';
CREATE INDEX IF NOT EXISTS message_reactions_conversation ON message_reactions(conversation_id);
'''


def widen(db):
    """A database made while there were only 👍 and ❤️ rebuilds the table with the current list; SQLite cannot change a
    CHECK in place. Every reaction is kept. Runs once."""
    row = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='message_reactions'").fetchone()
    if not row or "'thanks'" in row[0]:
        return
    db.commit()
    try:
        db.execute('BEGIN IMMEDIATE')
        db.execute('DROP TABLE IF EXISTS message_reactions_wide')
        db.execute(REACTIONS_TABLE.format(name='message_reactions_wide'))
        db.execute('INSERT INTO message_reactions_wide SELECT message_id,conversation_id,reaction,created_at FROM message_reactions')
        db.execute('DROP TABLE message_reactions')
        db.execute('ALTER TABLE message_reactions_wide RENAME TO message_reactions')
        db.execute('CREATE INDEX IF NOT EXISTS message_reactions_conversation ON message_reactions(conversation_id)')
        db.commit()
    except Exception:
        db.rollback()
        raise


def of_conversation(db, conversation_id):
    """{message id: reaction} of a conversation."""
    return {r['message_id']:r['reaction'] for r in rows(db,'SELECT message_id,reaction FROM message_reactions WHERE conversation_id=?',
                                                         (conversation_id,))}


def react(db, conv, message_id, body):
    """The customer's reaction to a team reply of their web conversation `conv` (already checked to be theirs):
    {'reaction': one of REACTIONS, or None to take it back}. The team's screens and the customer's other tabs hear
    about it."""
    from backend.modules.automation import service as automation
    reaction = body.get('reaction')
    require(reaction is None or reaction in REACTIONS,'รีแอคนี้ใช้ไม่ได้')
    require(conv['channel']=='web','รีแอคได้เฉพาะแชทบนเว็บ')
    begin(db)
    message = one(db,'SELECT id,kind,deleted_at FROM messages WHERE id=? AND conversation_id=?',(message_id,conv['id']))
    require(message and message['kind']=='reply' and not message['deleted_at'],'ไม่พบข้อความนี้',404)
    require(message_id not in automation.survey_message_ids(db,conv['id']),'ให้คะแนนด้วยดาวในแบบประเมินแทนนะคะ')
    if reaction:
        db.execute('''INSERT INTO message_reactions(message_id,conversation_id,reaction,created_at) VALUES(?,?,?,?)
                      ON CONFLICT(message_id) DO UPDATE SET reaction=excluded.reaction,created_at=excluded.created_at''',
                   (message_id,conv['id'],reaction,now()))
    else:
        db.execute('DELETE FROM message_reactions WHERE message_id=?',(message_id,))
    # Not a new message: the inbox list keeps its order.
    realtime.conversation(db,conv['id'],listed=False)
    db.commit()
    return {'reaction':reaction}
