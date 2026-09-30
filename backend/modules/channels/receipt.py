"""ข้อความรับเรื่อง: what a customer on LINE, Facebook or Instagram reads right after starting a new matter - that the
message arrived, and about how long the team will take. The web chat shows this as a queue card that keeps itself up
to date; a message sent on LINE or Messenger cannot change, so it says the expected wait rather than the place in the
queue (wrong a few minutes later), and it goes once per matter: the first message of a conversation, or the first
after its case was finished - never again while the customer and the team talk.

Under it, two quick-reply buttons: ดูลำดับคิวตอนนี้ answers with the place and the wait of that moment
(conversations/queue.py), and ไม่รีบ does what the chat page's button does (portal/no_rush.py). A press is not a
customer message: LINE sends it as a postback, Messenger and Instagram as a message carrying the button's payload.
Every answer is a system message in the chat (ai_message_meta 'system', like the out-of-hours notice), so the team
sees what the customer was told; it is not the team's first response and the customer still waits for the team.

Outside business hours only the out-of-hours notice goes (organization/hours.py); a chat the chatbot answers, and a
LINE group or room, get none. Off until the organization turns it on (ตั้งค่า → ภาพรวมและบริการ)."""
import json

from backend.database import audit
from backend.exceptions.errors import APIError
from backend.utils.security import uid
from backend.utils.validation import require

KEY = 'channel_receipt'
TOKEN = '{เวลารอ}'
MESSAGE_MAX = 500
DEFAULT = {'enabled':False,'message':f'ได้รับข้อความแล้ว ทีมงานจะตอบกลับ{TOKEN}'}
CHANNELS = ('line','facebook','instagram')
QUEUE,NO_RUSH = 'bookdose:queue','bookdose:no_rush'
# Buttons: LINE and Messenger both cut a label at 20 characters; what the customer's own bubble then reads.
BUTTONS = {QUEUE:('ดูลำดับคิวตอนนี้','ดูลำดับคิวตอนนี้'),NO_RUSH:('ไม่รีบ','ไม่รีบ ตอบพรุ่งนี้ก็ได้')}
NOT_WAITING = 'ตอนนี้ไม่มีข้อความที่รอทีมงานตอบ ถ้ามีเรื่องเพิ่มเติม พิมพ์บอกได้เลย'


def config(db):
    row = db.execute('SELECT value FROM settings WHERE key=?',(KEY,)).fetchone()
    try:
        value = json.loads(row[0]) if row and row[0] else None
    except ValueError:
        value = None
    return {**DEFAULT,**value} if isinstance(value,dict) else dict(DEFAULT)


def save(db, ctx, body):
    enabled,message = body.get('enabled',False),body.get('message','')
    require(type(enabled) is bool,'สถานะข้อความรับเรื่องไม่ถูกต้อง')
    require(isinstance(message,str) and 0<len(message.strip())<=MESSAGE_MAX,f'ข้อความรับเรื่องต้องมี 1-{MESSAGE_MAX} ตัวอักษร')
    value = {'enabled':enabled,'message':message.strip()}
    db.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(KEY,json.dumps(value,ensure_ascii=False)))
    audit.record(db,ctx['name'],'settings.updated',ctx['tenant_id'],f"ข้อความรับเรื่องทาง LINE และ Facebook ({'เปิด' if enabled else 'ปิด'})")
    db.commit()
    return value


# What the customer reads
def wait_text(status):
    """"ภายในประมาณ 10 นาที", "ภายในพรุ่งนี้ 18:00 น." (ไม่รีบ) or "โดยเร็วที่สุด" (nothing honest to promise)."""
    if status and status.get('no_rush'):
        return 'ภายใน'+status['no_rush']['text']
    minutes = status.get('wait_minutes') if status and not status.get('away') else None
    if minutes is None:
        return 'โดยเร็วที่สุด'
    if minutes<60:
        return f'ภายในประมาณ {max(1,minutes)} นาที'
    return f'ภายในประมาณ {round(minutes/60)} ชั่วโมง'


def queue_text(status):
    """The answer to ดูลำดับคิวตอนนี้."""
    if not status:
        return NOT_WAITING
    if status.get('no_rush'):
        return f"คุณเลือกไม่รีบไว้ ทีมงานจะตอบกลับ{wait_text(status)}"
    if status.get('away'):
        return f"ตอนนี้คุณอยู่ประมาณลำดับที่ {status['position']} ยังไม่มีทีมงานที่พร้อมตอบในขณะนี้ ทีมงานจะตอบกลับโดยเร็วที่สุด"
    return f"ตอนนี้คุณอยู่ประมาณลำดับที่ {status['position']} ทีมงานจะตอบกลับ{wait_text(status)}"


def _buttons(status):
    """The buttons worth showing: none once nobody waits, ไม่รีบ only while it is not already said."""
    if not status:
        return []
    return [QUEUE]+([] if status.get('no_rush') else [NO_RUSH])


# Sending
def _thread_ok(db, conv):
    """LINE: a one-to-one chat only (a group's bot answers only when called)."""
    if conv['channel']!='line':
        return True
    from backend.modules.channels import repository
    thread = repository.find_line_thread(db,conv['id'])
    return not thread or thread['source_type']=='user'


def _post(db, tenant_id, conv, text, buttons):
    """A system message in the chat, sent on its channel with the buttons under it."""
    from backend.modules.ai import repository as ai_repository
    from backend.modules.channels import facebook, repository, service as channels
    from backend.modules.channels.move import SYSTEM_ACTOR
    from backend.modules.conversations import repository as conversations
    if not repository.link_for_conversation(db,conv['id']):
        return None
    if conv['channel']=='line':
        row = channels.setting(db,'line')
        on = row and row['enabled']
    else:
        row = repository.find_facebook_setting(db)
        on = row and row['enabled'] and (conv['channel']==facebook.KIND or facebook.instagram_on(row))
    if not on:
        return None
    mid = uid()
    conversations.insert_message(db,mid,conv['id'],None,'ระบบ','reply',text)
    ai_repository.insert_message_meta(db,mid,'system','[]')
    ctx = {'tenant_id':tenant_id,'id':SYSTEM_ACTOR}
    if conv['channel']=='line':
        job = channels.enqueue_reply(db,ctx,conv,mid)
        items = [{'type':'action','action':{'type':'postback','label':BUTTONS[b][0],'data':b,'displayText':BUTTONS[b][1]}} for b in buttons]
        message = {'type':'text','text':text,**({'quickReply':{'items':items}} if items else {})}
        repository.insert_outbox_payload(db,job,json.dumps([message],ensure_ascii=False))
    else:
        job = facebook.enqueue_reply(db,ctx,conv,mid)
        if buttons:
            replies = [{'content_type':'text','title':BUTTONS[b][0],'payload':b} for b in buttons]
            repository.insert_outbox_payload(db,job,json.dumps({'quick_replies':replies},ensure_ascii=False))
    return mid


def is_new_matter(db, conversation_id):
    """Before store_message reopens anything: the customer's message starts a matter - the conversation's first, or
    the first since it (or its case) was finished."""
    from backend.modules.conversations import repository as conversations
    from backend.modules.tickets import repository as tickets
    conv = conversations.find(db,conversation_id)
    if not conv or conv['channel'] not in CHANNELS:
        return False
    if conversations.customer_message_count(db,conversation_id)==1 or conv['status']!='open':
        return True
    ticket = tickets.for_conversation(db,conversation_id)
    return bool(ticket and ticket['status'] in ('resolved','closed'))


def after_customer_message(db, tenant_id, conversation_id):
    """Inside store_message's transaction, once routing is done (a new chat's team decides the wait): the receipt,
    when it is on and the chat is waiting for a person. Returns the message id or None."""
    from backend.modules.channels import service as channels
    from backend.modules.conversations import queue, repository as conversations
    if not config(db)['enabled']:
        return None
    conv = conversations.find(db,conversation_id)
    if not conv or conv['channel'] not in CHANNELS or not _thread_ok(db,conv):
        return None
    if conv['channel']=='line' and channels.bot_enabled(db,conv):
        return None
    status = queue.of(db,tenant_id,conv)
    if not status:
        return None
    text = config(db)['message'].replace(TOKEN,wait_text(status))
    return _post(db,tenant_id,conv,text,_buttons(status))


def on_button(db, tenant_id, conversation_id, action):
    """A customer pressed one of the buttons under a receipt (or under an earlier answer): answered at once."""
    from backend.modules.conversations import queue, repository as conversations
    from backend.modules.portal import no_rush
    conv = conversations.find(db,conversation_id)
    if not conv or action not in BUTTONS or not _thread_ok(db,conv):
        return None
    if action==NO_RUSH:
        try:
            no_rush.set_state(db,conv,f'ลูกค้าทาง {conv["channel"].upper() if conv["channel"]=="line" else conv["channel"].title()}',True)
        except APIError:
            pass    # no longer waiting: the answer below says so
    status = queue.of(db,tenant_id,conv)
    if action==NO_RUSH and status and status.get('no_rush'):
        text = f"รับทราบ ทีมงานจะตอบกลับ{wait_text(status)}"
    else:
        text = queue_text(status)
    mid = _post(db,tenant_id,conv,text,_buttons(status))
    from backend.realtime import events as realtime
    realtime.conversation(db,conversation_id)
    return mid
