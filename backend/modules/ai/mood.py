"""How the customer feels, read from what they write: so an angry customer's case is not left at the back of the queue
because it happened to arrive last.

Every message a customer sends is read twice at most. At once, by the words in it (below): free, instant, and able
to say which words it went by. Then, when the organization has connected an AI (an OpenAI key or its n8n workflow)
and its owner has not switched this off (ตั้งค่า → AI → อ่านอารมณ์ลูกค้าด้วย AI), by the AI, which reads the last few messages together and catches what words miss - a polite message from someone
at the end of their patience, sarcasm, a threat without the usual words - and its reading replaces the words'. An
organization without an AI keeps the words' reading.

A conversation holds one reading: that of the customer's latest message. A calmer message later is a calmer customer.
The reading is a level - 0 ปกติ, 1 ไม่พอใจ, 2 โกรธมาก - and whether the customer says it cannot wait (urgent),
with the reason in a few words. The queue uses it (tickets/service.py next_task, the lists): an upset customer's case
comes before the calm ones that have only waited longer. """
import re

from backend.database.db import one, rows
from backend.exceptions.errors import AIError
from backend.utils.dates import now

CALM, UPSET, ANGRY = 0, 1, 2
LEVEL_NAMES = {CALM:'ปกติ',UPSET:'ไม่พอใจ',ANGRY:'โกรธมาก'}
# A reply this short ("ok", "ค่ะ", a sticker's text) says nothing an AI would read better than the words do.
AI_MIN_CHARS = 6
RECENT_MESSAGES = 5

# Not preceded by a negation: "ไม่ด่วน", "ไม่ได้โกรธ" and "not urgent" are the opposite of what they contain.
_NOT = r'(?<!ไม่)(?<!ไม่ได้)(?<!ไม่ได้จะ)(?<!ไม่ต้อง)(?<!not )(?<!no )'

ANGRY_WORDS = [
    'สคบ', 'ฟ้อง', 'ทนาย', 'แจ้งความ', 'ประจาน', 'ห่วยแตก', 'ห่วยมาก', 'แย่มาก', 'แย่ที่สุด', 'เลวร้าย', 'โกง', 'หลอกลวง',
    'ต้มตุ๋น', 'ทนไม่ไหว', 'ไม่ไหวแล้ว', 'โมโห', 'โกรธมาก', 'เหี้ย', 'สัส', 'แม่ง', 'ควาย', 'ไร้ความรับผิดชอบ', 'ไม่เอาแล้ว',
    'scam', 'fraud', 'lawyer', 'lawsuit', 'sue you', 'worst', 'terrible', 'unacceptable', 'ridiculous', 'furious', 'wtf',
]
UPSET_WORDS = [
    'ไม่พอใจ', 'ผิดหวัง', 'รำคาญ', 'หงุดหงิด', 'โกรธ', 'เสียความรู้สึก', 'ช้ามาก', 'ช้าจัง', 'ช้าเกิน', 'รอนาน', 'รอมา', 'นานแล้ว',
    'ยังไม่ได้รับ', 'ยังไม่มีใคร', 'ไม่มีใครตอบ', 'ทำไมไม่ตอบ', 'ทำไมยัง', 'อีกแล้ว', 'หลายรอบ', 'กี่รอบ', 'กี่ครั้ง',
    'ขอคืนเงิน', 'ไม่ประทับใจ', 'บริการแย่', 'แย่', 'ห่วย',
    'disappointed', 'annoyed', 'frustrated', 'upset', 'angry', 'still waiting', 'nobody answered', 'refund',
]
URGENT_WORDS = [
    'ด่วน', 'เร่งด่วน', 'ภายในวันนี้', 'วันนี้เลย', 'ตอนนี้เลย', 'เดี๋ยวนี้', 'ทันที', 'ฉุกเฉิน', 'ระบบล่ม', 'ใช้งานไม่ได้เลย',
    'ใช้ไม่ได้เลย', 'เข้าไม่ได้เลย', 'รีบ', 'asap', 'urgent', 'immediately', 'emergency', 'right now', 'is down',
]


def _pattern(words):
    return re.compile(_NOT+'('+'|'.join(re.escape(w) for w in sorted(words,key=len,reverse=True))+')',re.I)


ANGRY_RE, UPSET_RE, URGENT_RE = _pattern(ANGRY_WORDS), _pattern(UPSET_WORDS), _pattern(URGENT_WORDS)
SHOUT_RE = re.compile(r'[!！]{3,}|[?？]{3,}|\b[A-Z]{5,}\b')


def by_words(text):
    """(level, urgent, reason) from the words of one message; reason names what it went by."""
    text = text or ''
    angry = {m.group(1).lower() for m in ANGRY_RE.finditer(text)}
    upset = {m.group(1).lower() for m in UPSET_RE.finditer(text)}
    urgent = {m.group(1).lower() for m in URGENT_RE.finditer(text)}
    shout = bool(SHOUT_RE.search(text))
    level = ANGRY if angry or (upset and shout) else UPSET if upset or shout else CALM
    found = [*sorted(angry),*sorted(upset-angry),*sorted(urgent)]
    # "ห่วย" inside "ห่วยแตก" is the same word found twice.
    found = [w for w in dict.fromkeys(found) if not any(w!=other and w in other for other in found)][:4]
    reason = ('เจอคำว่า '+', '.join(f'"{w}"' for w in found) if found else '')+(' · ใช้เครื่องหมายซ้ำ' if shout else '')
    return level,bool(urgent),reason.strip(' ·')


def save(db, conversation_id, message_id, level, urgent, reason, source):
    db.execute('''INSERT INTO conversation_moods(conversation_id,level,urgent,reason,source,message_id,updated_at) VALUES(?,?,?,?,?,?,?)
                  ON CONFLICT(conversation_id) DO UPDATE SET level=excluded.level,urgent=excluded.urgent,reason=excluded.reason,
                  source=excluded.source,message_id=excluded.message_id,updated_at=excluded.updated_at''',
               (conversation_id,int(level),int(bool(urgent)),reason[:200],source,message_id,now()))


def of(db, conversation_id):
    return one(db,'SELECT level,urgent,reason,source,updated_at FROM conversation_moods WHERE conversation_id=?',(conversation_id,))


def on_customer_message(db, tenant_id, conversation_id, body):
    """Read a new customer message by its words now, and queue the AI's reading when the organization has an AI.
    Inside the caller's transaction; nothing here calls out."""
    from backend.modules.ai import service as ai
    from backend.modules.conversations import repository as conversations
    message_id = conversations.latest_message_id(db,conversation_id,'customer')
    level,urgent,reason = by_words(body)
    save(db,conversation_id,message_id,level,urgent,reason,'words')
    # The owner may keep the AI out of it (ตั้งค่า → AI): the words' reading above is all there is then.
    if len((body or '').strip())<AI_MIN_CHARS or not ai.has_key(tenant_id) or not ai.config(db)['mood_enabled']:
        return
    # Only the newest message's reading counts: an older one still waiting is not worth a provider call.
    db.execute("UPDATE ai_jobs SET status='cancelled',error='stale',updated_at=? WHERE conversation_id=? AND mode='mood' AND status='pending'",
               (now(),conversation_id))
    try:
        ai.enqueue(db,tenant_id,'mood',conversation_id,payload=payload(db,conversation_id))
    except AIError:
        # Over the day's AI limit, or the AI switched off: the words' reading stands.
        pass


def backfill(db):
    """Open conversations from before this reading existed: their customer's latest message read by its words, once,
    so the queue does not start blind. Never by the AI - that would be a provider call per old conversation."""
    found = rows(db,'''SELECT c.id,m.id AS message_id,m.body FROM conversations c
                        JOIN messages m ON m.id=(SELECT id FROM messages WHERE conversation_id=c.id AND kind='customer'
                                                 ORDER BY created_at DESC,rowid DESC LIMIT 1)
                        WHERE c.status='open' AND c.id NOT IN (SELECT conversation_id FROM conversation_moods)''')
    for conv in found:
        level,urgent,reason = by_words(conv['body'])
        save(db,conv['id'],conv['message_id'],level,urgent,reason,'words')
    return len(found)


def payload(db, conversation_id):
    """What the AI reads: the conversation's last few public messages, customer's and team's, text only - no names,
    contact details or attachments."""
    messages = rows(db,f'''SELECT kind,body FROM messages WHERE conversation_id=? AND kind IN ('customer','reply')
                          ORDER BY created_at DESC,rowid DESC LIMIT {RECENT_MESSAGES}''',(conversation_id,))
    return {'messages':[{'from':'customer' if m['kind']=='customer' else 'team','text':m['body'][:1500]} for m in reversed(messages)]}


def validate(result):
    """The AI's reading, or AIError: a level 0-2, urgent true/false and a short Thai reason."""
    if not isinstance(result,dict) or result.get('level') not in (0,1,2) or type(result.get('urgent')) is not bool \
            or not isinstance(result.get('reason'),str) or len(result['reason'])>300:
        raise AIError('invalid_output')
    return {'level':result['level'],'urgent':result['urgent'],'reason':result['reason'].strip()}


def apply_ai(db, job, result):
    """Put the AI's reading on the conversation, unless the customer has written again since (a newer job reads
    that). Returns whether it changed anything."""
    from backend.modules.conversations import repository as conversations
    latest = conversations.latest_message_id(db,job['conversation_id'],'customer')
    current = of(db,job['conversation_id'])
    if not current or latest!=job['trigger_id']:
        return False
    save(db,job['conversation_id'],latest,result['level'],result['urgent'],result['reason'] or LEVEL_NAMES[result['level']],'ai')
    return True
