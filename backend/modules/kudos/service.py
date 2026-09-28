"""กำแพงคำชม (model.py): finding praise in what customers write, the wall, cheering and taking an item down."""
import re

from backend.database import audit
from backend.database.db import begin, one, rows
from backend.exceptions.errors import APIError
from backend.modules.ai import mood
from backend.modules.kudos.model import (CARD_SHOWN, HEART_TEXT, KUDOS_TABLE, REPLY_DAYS, TEXT_MAX, THANKS_MIN_LETTERS,
                                         WALL_DAYS, WALL_MAX)
from backend.utils.dates import after, now
from backend.utils.security import uid
from backend.utils.validation import require

# Not preceded by a negation, as ai/mood.py reads: "ไม่ประทับใจ" and "not helpful" are the opposite of praise.
_NOT = r'(?<!ไม่)(?<!ไม่ค่อย)(?<!ไม่ได้)(?<!not )(?<!not very )'
THANKS_WORDS = ['ขอบคุณ', 'ขอบใจ', 'thank', 'thx', 'appreciate']
PRAISE_WORDS = [
    'ประทับใจ', 'บริการดี', 'ดีมาก', 'เยี่ยม', 'สุดยอด', 'ช่วยได้มาก', 'ช่วยได้เยอะ', 'รวดเร็ว', 'ไวมาก', 'ใจดี', 'น่ารักมาก',
    'เก่งมาก', 'ชื่นชม', 'ปลื้ม', 'excellent', 'amazing', 'awesome', 'helpful', 'fantastic', 'wonderful', 'great service',
    'great job', 'well done',
]


def _pattern(words):
    return re.compile(_NOT+'('+'|'.join(re.escape(w) for w in sorted(words,key=len,reverse=True))+')',re.I)


THANKS_RE, PRAISE_RE = _pattern(THANKS_WORDS), _pattern(PRAISE_WORDS)
# A message that still asks something is a question with good manners, not praise.
QUESTION_RE = re.compile(r'[?？]|ไหม|มั้ย|หรือเปล่า|รึเปล่า|เมื่อไหร่|เมื่อไร|ยังไง|อย่างไร|ทำไม|ที่ไหน|กี่|\b(how|when|why|where|can you|could you)\b',re.I)
EMAIL_RE = re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+')
PHONE_RE = re.compile(r'(?<!\d)(?:\+?66|0)[\d\s-]{8,11}\d')


def is_praise(text):
    """Does this customer message praise the team: praise words, or thanks in a sentence; calm, and asking nothing."""
    text = (text or '').strip()
    if not text or QUESTION_RE.search(text) or mood.by_words(text)[0]!=mood.CALM:
        return False
    if PRAISE_RE.search(text):
        return True
    return bool(THANKS_RE.search(text)) and sum(c.isalpha() for c in text)>=THANKS_MIN_LETTERS


def shown_text(text):
    """The words as the wall shows them: one line, no email address or phone number, at most TEXT_MAX."""
    text = PHONE_RE.sub('[เบอร์โทร]',EMAIL_RE.sub('[อีเมล]',text or ''))
    text = re.sub(r'\s+',' ',text).strip()
    return text if len(text)<=TEXT_MAX else text[:TEXT_MAX-1].rstrip()+'…'


def _last_reply(db, conversation_id, before):
    """The team member who wrote the conversation's last reply before `before` (people only, not the chatbot)."""
    return one(db,'''SELECT m.author_id,m.author_name FROM messages m WHERE m.conversation_id=? AND m.kind='reply'
                     AND m.author_id IS NOT NULL AND m.deleted_at IS NULL AND m.created_at>=? AND m.created_at<=?
                     AND NOT EXISTS(SELECT 1 FROM ai_message_meta a WHERE a.message_id=m.id)
                     ORDER BY m.created_at DESC,m.rowid DESC LIMIT 1''',(conversation_id,after(days=-REPLY_DAYS),before))


def _insert(db, source, source_id, user_id, user_name, text, rating, conversation_id, ticket_id):
    db.execute('''INSERT OR IGNORE INTO kudos(id,source,source_id,user_id,user_name,text,rating,conversation_id,ticket_id,created_at)
                  VALUES(?,?,?,?,?,?,?,?,?,?)''',
               (uid(),source,source_id,user_id,user_name or '',shown_text(text),rating,conversation_id,ticket_id,now()))


def on_customer_message(db, conversation_id, message_id, text):
    """A customer wrote (conversations.store_message, inside its transaction): praise goes on the wall for the team
    member whose reply it answers - once a day per member and conversation, however often the customer says thanks."""
    if not is_praise(text):
        return
    reply = _last_reply(db,conversation_id,now())
    if not reply:
        return
    if one(db,'SELECT 1 FROM kudos WHERE conversation_id=? AND user_id=? AND created_at>=?',(conversation_id,reply['author_id'],after(days=-1))):
        return
    ticket = one(db,'SELECT ticket_id FROM ticket_conversations WHERE conversation_id=?',(conversation_id,))
    _insert(db,'message',message_id,reply['author_id'],reply['author_name'],text,None,conversation_id,ticket['ticket_id'] if ticket else None)


def on_rating(db, survey, rating, comment):
    """Five stars with a comment (the customer page's survey): the case's owner is praised. Inside the caller's
    transaction."""
    if rating!=5 or not (comment or '').strip() or mood.by_words(comment)[0]!=mood.CALM:
        return
    ticket = one(db,'SELECT id,assignee_id FROM tickets WHERE id=?',(survey['ticket_id'],))
    if not ticket or not ticket['assignee_id']:
        return
    # The name the owner signed their replies with in this case, if any; the page shows the member's current name.
    named = one(db,'''SELECT m.author_name FROM messages m JOIN ticket_conversations tc ON tc.conversation_id=m.conversation_id
                      WHERE tc.ticket_id=? AND m.author_id=? ORDER BY m.created_at DESC LIMIT 1''',(ticket['id'],ticket['assignee_id']))
    _insert(db,'csat',survey['id'],ticket['assignee_id'],named['author_name'] if named else '',comment,5,survey['conversation_id'],ticket['id'])


def on_thanks_heart(db, card, name):
    """The customer sent a heart back from the thank-you card `card` (a thanks_cards row, automation/thanks.py): the
    member it thanks is praised - once per card and closing, however often it is tapped. Inside the caller's
    transaction."""
    _insert(db,'thanks',heart_key(card),card['user_id'],name,HEART_TEXT,None,card['conversation_id'],card['ticket_id'])


def heart_key(card):
    """The card as it was given this time: a case finished again gives the card anew, and a new heart with it."""
    return f"{card['id']}@{card['created_at']}"


def hearted(db, card):
    return bool(one(db,"SELECT 1 FROM kudos WHERE source='thanks' AND source_id=?",(heart_key(card),)))


# The wall
def _visible(where='1=1'):
    # An item whose conversation is in the recycle bin is not shown (the conversation row is gone until restored).
    return f'''FROM kudos k JOIN conversations cv ON cv.id=k.conversation_id WHERE k.hidden_at IS NULL AND k.created_at>=? AND {where}'''


def _dress(db, ctx, items):
    """Each item with who cheered it, whether this member did, and what they may do with it."""
    ids = [k['id'] for k in items]
    cheers = {}
    if ids:
        for c in rows(db,f"SELECT kudos_id,user_id,user_name FROM kudos_cheers WHERE kudos_id IN ({','.join('?'*len(ids))}) ORDER BY created_at",ids):
            cheers.setdefault(c['kudos_id'],[]).append({'user_id':c['user_id'],'name':c['user_name']})
    for k in items:
        k['cheers'] = cheers.get(k['id'],[])
        k['cheered'] = any(c['user_id']==ctx['id'] for c in k['cheers'])
        k['mine'] = k['user_id']==ctx['id']
        k['removable'] = k['mine'] or ctx['role']=='admin'
    return items


def wall(db, ctx, limit=WALL_MAX):
    """{'items': newest first, 'total': in the last WALL_DAYS, 'days'}: the whole organization sees the same wall."""
    since = after(days=-WALL_DAYS)
    items = rows(db,f'SELECT k.id,k.source,k.user_id,k.user_name,k.text,k.rating,k.created_at {_visible()} ORDER BY k.created_at DESC,k.rowid DESC LIMIT ?',
                 (since,limit))
    total = db.execute(f'SELECT COUNT(*) {_visible()}',(since,)).fetchone()[0]
    return {'items':_dress(db,ctx,items),'total':total,'days':WALL_DAYS}


def card(db, ctx):
    """The overview's card: the newest few."""
    return wall(db,ctx,CARD_SHOWN)


def mine_since(db, user_id, since):
    """Praise from customers' messages and hearts from the thank-you card to this member since `since` (the staff
    frame celebrates new ones; five stars are celebrated from the survey already)."""
    return rows(db,f"SELECT k.id,k.source,k.text,k.created_at {_visible('k.user_id=? AND k.source IN (?,?)')} ORDER BY k.created_at DESC LIMIT 10",
                (since,user_id,'message','thanks'))


def _find(db, kudos_id):
    found = one(db,f'SELECT k.* {_visible("k.id=?")}',(after(days=-WALL_DAYS),kudos_id))
    if not found:
        raise APIError(404,'ไม่พบคำชมนี้ อาจถูกนำออกจากกำแพงแล้ว')
    return found


def cheer(db, ctx, kudos_id, body):
    """เป็นกำลังใจ, or take it back: one per member, not on praise of their own."""
    on = body.get('on')
    require(type(on) is bool,'ข้อมูลไม่ถูกต้อง')
    begin(db)
    found = _find(db,kudos_id)
    require(found['user_id']!=ctx['id'],'คำชมนี้เป็นของคุณเอง ให้เพื่อนเป็นกำลังใจให้นะ',403)
    if on:
        db.execute('INSERT OR IGNORE INTO kudos_cheers VALUES(?,?,?,?)',(kudos_id,ctx['id'],ctx['name'],now()))
    else:
        db.execute('DELETE FROM kudos_cheers WHERE kudos_id=? AND user_id=?',(kudos_id,ctx['id']))
    db.commit()
    return {'ok':True}


def hide(db, ctx, kudos_id):
    """Take an item down: the praised member, or the organization's owners."""
    begin(db)
    found = _find(db,kudos_id)
    require(found['user_id']==ctx['id'] or ctx['role']=='admin','นำออกได้เฉพาะคำชมของคุณเอง หรือโดยเจ้าขององค์กร',403)
    db.execute('UPDATE kudos SET hidden_at=?,hidden_by=? WHERE id=?',(now(),ctx['name'],kudos_id))
    audit.record(db,ctx['name'],'kudos.hidden',kudos_id,found['text'][:120])
    db.commit()
    return {'ok':True}


def widen_sources(db):
    """Databases from before hearts from the thank-you card rebuild kudos with the current source list; SQLite cannot
    change a CHECK in place. Every item is kept. Runs once."""
    row = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='kudos'").fetchone()
    if not row or "'thanks'" in row[0]:
        return
    columns = ','.join(r[1] for r in db.execute('PRAGMA table_info(kudos)').fetchall())
    db.commit()
    db.execute('PRAGMA foreign_keys=OFF')
    try:
        db.execute('BEGIN IMMEDIATE')
        db.execute('DROP TABLE IF EXISTS kudos_wide')
        db.execute(KUDOS_TABLE.format(name='kudos_wide'))
        db.execute(f'INSERT INTO kudos_wide({columns}) SELECT {columns} FROM kudos')
        db.execute('DROP TABLE kudos')
        db.execute('ALTER TABLE kudos_wide RENAME TO kudos')
        db.execute('CREATE INDEX IF NOT EXISTS kudos_recent ON kudos(created_at)')
        db.execute('CREATE INDEX IF NOT EXISTS kudos_user ON kudos(user_id,created_at)')
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.execute('PRAGMA foreign_keys=ON')


def forget_conversations(db, conversation_ids):
    """The customer's words go with the customer (PDPA erasure, the retention round): off the wall, cheers and all."""
    for conv in conversation_ids:
        db.execute('DELETE FROM kudos_cheers WHERE kudos_id IN (SELECT id FROM kudos WHERE conversation_id=?)',(conv,))
        db.execute('DELETE FROM kudos WHERE conversation_id=?',(conv,))
