"""ลูกค้าปิดเคสเอง: a customer finishes their own case - with the button on the web chat and the case page
(customers/perks.py), or by writing ปิดเคส on any channel (LINE, Facebook, email, the web chat too).

A written word is never enough on its own: the system asks "ต้องการปิดเคส BD-x ใช่ไหม" and finishes the case only on
ใช่ within ASK_MINUTES. ไม่ keeps it open and says so; anything else lets the question lapse and goes on as an
ordinary message. Only a message that is the word and nothing else (politeness particles aside) asks, so a sentence
that merely has the word in it, or one typed by mistake, closes nothing.

Finishing goes the way a member's finish does (automation.after_status_change: the survey, the thank-you card, a
raised hand lowered); the case's history says the customer did it, and its owner is told. The question and the
answers are system messages (ai_message_meta 'system'), never the team's first response."""
import re

from backend.database import audit, db as D
from backend.database.db import one
from backend.modules.ai import repository as ai_repository
from backend.modules.conversations import repository as conversations
from backend.modules.tickets import repository as tickets
from backend.realtime import events as realtime
from backend.utils.dates import after, now
from backend.utils.security import uid
from backend.utils.validation import require

ASK_MINUTES = 30
ACTOR = 'ลูกค้า'
DONE = ('resolved','closed')
CLOSE_WORDS = {'ปิดเคส','ปิดเคสได้','ปิดเคสให้หน่อย','ขอปิดเคส','ปิดเรื่อง','ปิดเรื่องได้','ขอปิดเรื่อง','จบเคส','จบเรื่อง',
               'แก้ไขแล้ว','แก้แล้ว','หายแล้ว','เรียบร้อยแล้ว','ใช้ได้แล้ว','close','close case','close the case','closed','resolved','done','solved'}
YES_WORDS = {'ใช่','ใช่แล้ว','ปิด','ปิดได้','ยืนยัน','ตกลง','โอเค','ได้','ok','okay','yes','y','sure','confirm'}
NO_WORDS = {'ไม่','ไม่ใช่','ไม่ปิด','ยัง','ยังไม่','ยังไม่ปิด','ยกเลิก','no','n','not yet','cancel'}
# What a message may end with and still be the word: ค่ะ, ครับ, นะ, เลย and so on, and any punctuation.
PARTICLES = ('นะคะ','นะครับ','นะค่ะ','ค่ะ','คะ','ครับ','คับ','ค่า','จ้า','จ้ะ','จ้ะ','นะ','เลย','น้า','ฮะ','ฮ่ะ','งับ')
NOISE = re.compile(r'[\s\.\!\?,，。…~\-\"“”\'‘’]+')
ASK = 'ต้องการปิดเคส BD-{number} ใช่ไหม ตอบ “ใช่” เพื่อปิดเคส หรือ “ไม่” เพื่อให้ทีมงานดูแลต่อ'
CLOSED = 'ปิดเคส BD-{number} แล้ว ขอบคุณที่แจ้งให้ทราบ หากปัญหากลับมาอีก พิมพ์บอกได้เลย เรื่องจะเปิดขึ้นอีกครั้ง'
KEPT = 'รับทราบ เรื่องยังเปิดอยู่ ทีมงานดูแลต่อให้'

TABLE = '''
CREATE TABLE IF NOT EXISTS close_questions (
    id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, conversation_id TEXT NOT NULL, message_id TEXT NOT NULL,
    asked_at TEXT NOT NULL, answered_at TEXT, answer TEXT NOT NULL DEFAULT ''
);
'''


def plain(text):
    """The message as a word to compare: lower case, one space between words, no punctuation, and no politeness at
    the end ("ปิดเคสได้เลยค่ะ" → "ปิดเคสได้", "ใช่ค่ะ" → "ใช่")."""
    word = NOISE.sub(' ',(text or '').lower()).strip()
    trimmed = True
    while trimmed:
        trimmed = False
        for particle in PARTICLES:
            if word.endswith(particle) and len(word)>len(particle):
                word = word[:-len(particle)].strip()
                trimmed = True
    return word


def pending(db, conversation_id):
    """The question asked in this conversation that still waits for its answer, or None."""
    return one(db,'''SELECT * FROM close_questions WHERE conversation_id=? AND answered_at IS NULL AND asked_at>=?
                     ORDER BY asked_at DESC LIMIT 1''',(conversation_id,after(seconds=-ASK_MINUTES*60)))


def take_message(db, tenant_id, conversation_id, text):
    """A customer message on any channel, already stored (conversations.service.store_message): the word that asks
    to close, or the answer to the question. True when the message was that and nothing else - it then neither
    reopens nor routes the case."""
    word = plain(text)
    if not word:
        return False
    asked = pending(db,conversation_id)
    if asked:
        if word in YES_WORDS:
            _answer(db,asked,'yes')
            case = one(db,'SELECT * FROM tickets WHERE id=?',(asked['ticket_id'],))
            if case and case['status'] not in DONE:
                finish(db,tenant_id,case,ACTOR)
                _post(db,tenant_id,conversation_id,CLOSED.format(number=case['number']))
            return True
        if word in NO_WORDS:
            _answer(db,asked,'no')
            _post(db,tenant_id,conversation_id,KEPT)
            audit.record(db,ACTOR,'ticket.close_declined',asked['ticket_id'],'')
            return True
        # Anything else: the question lapses and the message goes on as usual.
        _answer(db,asked,'other')
        return False
    ticket = tickets.for_conversation(db,conversation_id)
    if word in CLOSE_WORDS and ticket and ticket['status'] not in DONE:
        mid = _post(db,tenant_id,conversation_id,ASK.format(number=ticket['number']))
        db.execute('INSERT INTO close_questions(id,ticket_id,conversation_id,message_id,asked_at) VALUES(?,?,?,?,?)',
                   (uid(),ticket['id'],conversation_id,mid,now()))
        audit.record(db,ACTOR,'ticket.close_asked',ticket['id'],text[:200])
        return True
    return False


def resolve_from_chat(db, tenant_id, conv, who):
    """The button on the web chat: finish the chat's case now - the button asked already - and say so in the chat."""
    ticket = tickets.for_conversation(db,conv['id'])
    require(ticket,'แชทนี้ยังไม่มีเคสให้ปิด',409)
    require(ticket['status'] not in DONE,'เคสนี้จบไปแล้ว',409)
    D.begin(db)
    case = one(db,'SELECT * FROM tickets WHERE id=?',(ticket['id'],))
    finish(db,tenant_id,case,who)
    _post(db,tenant_id,conv['id'],CLOSED.format(number=case['number']))
    db.commit()
    return {'ticket_id':case['id']}


def finish(db, tenant_id, case, who):
    """Resolve the case as a member would (tickets.update, then what follows a finish), say in its history that the
    customer did, and tell its owner. Inside the caller's transaction. `case`: the whole tickets row."""
    from backend.modules.automation import service as automation
    tickets.update(db,case['id'],'resolved',case['priority'],case['team_id'],case['assignee_id'],now())
    ctx = {'tenant_id':tenant_id,'id':None,'name':who}
    automation.after_status_change(db,ctx,case,'resolved')
    realtime.ticket(db,case['id'],public=True,teams=(case['team_id'],),conversations_listed=True)
    audit.record(db,who,'ticket.customer_resolved',case['id'],'')
    if case['assignee_id']:
        from backend.modules.staff_prefs import service as staff_prefs
        staff_prefs.queue(db,case['assignee_id'],'customer_reply',f"ลูกค้าแจ้งว่าแก้ไขแล้ว เคส BD-{case['number']}",
                          case['subject'],f"/tickets/{case['id']}")


def _answer(db, asked, answer):
    db.execute('UPDATE close_questions SET answered_at=?,answer=? WHERE id=?',(now(),answer,asked['id']))


def _post(db, tenant_id, conversation_id, text):
    """A system message in the conversation, delivered the way the channel delivers (as the quiet-customer reminder
    is: automation/quiet.py). Returns its id."""
    from backend.modules.customers import service as customers
    from backend.modules.organization import hours
    conv = conversations.find(db,conversation_id)
    mid = uid()
    conversations.insert_message(db,mid,conv['id'],None,'ระบบ','reply',text)
    ai_repository.insert_message_meta(db,mid,'system','[]')
    conversations.touch(db,conv['id'])
    if conv['channel']=='web':
        customers.notify_reply(db,conv['id'])
    else:
        hours._deliver(db,tenant_id,conv,mid)
    realtime.conversation(db,conv['id'])
    return mid
