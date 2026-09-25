"""ปิดเคสเมื่อลูกค้าเงียบ: a case waiting for the customer (รอลูกค้า) that hears nothing back does not sit in the lists
for ever. After `remind_days` of silence the customer is asked once whether they still need help; after `close_days`
more the case closes, with a last message saying a reply opens it again (a customer who writes reopens any closed
case: tickets.repository.reopen_for_conversation).

Silence is counted from the case's last change and the last message in its conversations that is not the system's
own (a staff note counts: somebody is still on it). Both messages are system messages (ai_message_meta 'system'),
so neither is the team's first response. A paused case (พักเคส) waits for its moment first. Off by default; the
automation worker runs it each round."""
import datetime as dt
import json

from backend.database import audit, db as D
from backend.modules.ai import repository as ai_repository
from backend.modules.conversations import repository as conversations
from backend.modules.tickets import repository as tickets
from backend.realtime import events as realtime
from backend.utils.dates import iso, utc_now
from backend.utils.security import uid
from backend.utils.validation import require

KEY = 'quiet_close'
TOKEN = '{วัน}'
DAYS_MAX = 30
MESSAGE_MAX = 500
ACTOR = 'ระบบอัตโนมัติ'
DEFAULT = {'enabled':False,'remind_days':3,'close_days':2,
           'remind_message':f'หากยังต้องการความช่วยเหลือเรื่องนี้ ตอบกลับข้อความนี้ได้เลย หากไม่ได้รับข้อความเพิ่มเติม ระบบจะปิดเรื่องนี้ใน {TOKEN} วัน',
           'close_message':'ปิดเรื่องนี้แล้ว เพราะยังไม่ได้รับข้อความเพิ่มเติม หากยังต้องการความช่วยเหลือ ตอบกลับข้อความนี้ได้เลย เรื่องจะเปิดขึ้นอีกครั้ง'}

TABLE = '''
CREATE TABLE IF NOT EXISTS quiet_reminders (ticket_id TEXT PRIMARY KEY, reminded_at TEXT NOT NULL);
'''


def config(db):
    row = db.execute('SELECT value FROM settings WHERE key=?',(KEY,)).fetchone()
    try:
        value = json.loads(row[0]) if row and row[0] else None
    except ValueError:
        value = None
    return {**DEFAULT,**value} if isinstance(value,dict) else dict(DEFAULT)


def form(body):
    enabled = body.get('enabled',False)
    require(type(enabled) is bool,'สถานะการปิดเคสอัตโนมัติไม่ถูกต้อง')
    found = {'enabled':enabled}
    for key,label in (('remind_days','ถามลูกค้าอีกครั้งหลังเงียบ'),('close_days','ปิดเคสหลังถาม')):
        value = body.get(key)
        require(type(value) is int and 1<=value<=DAYS_MAX,f'{label} ต้องเป็น 1-{DAYS_MAX} วัน')
        found[key] = value
    for key,label in (('remind_message','ข้อความถามลูกค้า'),('close_message','ข้อความตอนปิดเคส')):
        text = body.get(key,'')
        require(isinstance(text,str) and 0<len(text.strip())<=MESSAGE_MAX,f'{label}ต้องมี 1-{MESSAGE_MAX} ตัวอักษร')
        found[key] = text.strip()
    return found


def save(db, ctx, body):
    value = form(body)
    db.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(KEY,json.dumps(value,ensure_ascii=False)))
    audit.record(db,ctx['name'],'settings.updated',ctx['tenant_id'],
                 f"ปิดเคสเมื่อลูกค้าเงียบ ({'ถามหลัง %d วัน ปิดหลังถาม %d วัน' % (value['remind_days'],value['close_days']) if value['enabled'] else 'ปิด'})")
    db.commit()
    return value


def _waiting(db, moment):
    """The cases waiting for the customer (not paused), with their last activity and the reminder already sent."""
    return [dict(r) for r in db.execute('''
        SELECT t.*,q.reminded_at,
               (SELECT MAX(m.created_at) FROM messages m JOIN ticket_conversations tc ON tc.conversation_id=m.conversation_id
                 WHERE tc.ticket_id=t.id AND m.id NOT IN (SELECT message_id FROM ai_message_meta WHERE source='system')) AS last_message
        FROM tickets t LEFT JOIN quiet_reminders q ON q.ticket_id=t.id
        WHERE t.status='pending_customer' AND (t.snoozed_until IS NULL OR t.snoozed_until<=?)''',(iso(moment),)).fetchall()]


def run(db, tenant_id, moment=None):
    """One round: ask the customers gone quiet, close the cases asked and still quiet. Returns [(case id, 'reminded' |
    'closed')]."""
    cfg = config(db)
    if not cfg['enabled']:
        return []
    moment = moment or utc_now()
    done = []
    D.begin(db)
    # A case that left รอลูกค้า starts again from nothing when it comes back.
    db.execute("DELETE FROM quiet_reminders WHERE ticket_id NOT IN (SELECT id FROM tickets WHERE status='pending_customer')")
    for case in _waiting(db,moment):
        activity = max(case['updated_at'],case['last_message'] or '')
        reminded = case['reminded_at'] if case['reminded_at'] and case['reminded_at']>=activity else None
        if reminded:
            if moment-dt.datetime.fromisoformat(reminded)>=dt.timedelta(days=cfg['close_days']):
                _close(db,tenant_id,case,cfg['close_message'],moment)
                done.append((case['id'],'closed'))
        elif moment-dt.datetime.fromisoformat(activity)>=dt.timedelta(days=cfg['remind_days']):
            if _post(db,tenant_id,case,cfg['remind_message'].replace(TOKEN,str(cfg['close_days']))):
                db.execute('INSERT INTO quiet_reminders VALUES(?,?) ON CONFLICT(ticket_id) DO UPDATE SET reminded_at=excluded.reminded_at',
                           (case['id'],iso(moment)))
                audit.record(db,ACTOR,'ticket.quiet_reminded',case['id'],f"ลูกค้าเงียบ {cfg['remind_days']} วัน · ถามว่ายังต้องการความช่วยเหลือไหม")
                done.append((case['id'],'reminded'))
    db.commit()
    return done


def _close(db, tenant_id, case, text, moment):
    tickets.update(db,case['id'],'closed',case['priority'],case['team_id'],case['assignee_id'],iso(moment))
    db.execute('DELETE FROM quiet_reminders WHERE ticket_id=?',(case['id'],))
    _post(db,tenant_id,case,text)
    audit.record(db,ACTOR,'ticket.updated',case['id'],json.dumps({'status':{'before':case['status'],'after':'closed'}},ensure_ascii=False))
    audit.record(db,ACTOR,'ticket.quiet_closed',case['id'],'ลูกค้าไม่ตอบกลับหลังถามแล้ว')
    realtime.ticket(db,case['id'],public=True,conversations_listed=True)


def _post(db, tenant_id, case, text):
    """The message in the case's conversation that reaches the customer, as the system's own. False when there is
    none (a case recorded by staff): a case nobody can be asked is not reminded, and so never closed."""
    from backend.modules.automation.service import _reply_conversation
    from backend.modules.customers import service as customers
    from backend.modules.organization import hours
    conv = _reply_conversation(db,case)
    if not conv:
        return False
    mid = uid()
    conversations.insert_message(db,mid,conv['id'],None,'ระบบ','reply',text)
    ai_repository.insert_message_meta(db,mid,'system','[]')
    conversations.touch(db,conv['id'])
    if conv['channel']=='web':
        customers.notify_reply(db,conv['id'])
    else:
        hours._deliver(db,tenant_id,conv,mid)
    realtime.conversation(db,conv['id'])
    return True
