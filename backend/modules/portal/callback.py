"""ขอให้ติดต่อกลับ: a customer - signed in or not - who would rather be called than type, picks a time in the chat and
how: by phone (the number they give) or by the organization's LINE (only when they linked it). The team gets it as a
case: the chat becomes one when it is not yet (the chatbot hands it over first), and the case carries a follow-up
reminder (เตือนติดตามผล) at the start of the time picked, with the way to reach them - the reminder they already
work from. The chat shows the request to both sides.

- The times offered are the next DAYS_AHEAD days in SLOTS, in Thai time, only while the organization is open when it
  set its hours (organization/hours.py), and never one ending within LEAD_MINUTES.
- One request waits per chat: asking again replaces it, and the customer may call it off. It stops waiting when the
  team marks the reminder done."""
import datetime as dt
import re

from backend.database import audit, db as D
from backend.database.db import one
from backend.modules.organization import hours
from backend.utils.dates import iso, now, utc_now
from backend.utils.security import uid
from backend.utils.validation import require

SLOTS = (('09:00','12:00'),('12:00','15:00'),('15:00','18:00'))
DAYS_AHEAD = 7
LEAD_MINUTES = 60
METHODS = ('phone','line')
NOTE_MAX = 300
PHONE = re.compile(r'(?:0\d{8,9}|\+\d{9,14})')

TABLE = '''
CREATE TABLE IF NOT EXISTS callback_requests (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, ticket_id TEXT NOT NULL,
    method TEXT NOT NULL CHECK(method IN ('phone','line')), phone TEXT NOT NULL DEFAULT '',
    starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', followup_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('waiting','cancelled')), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS callback_requests_conversation ON callback_requests(conversation_id,status);
'''


def slots(db, moment=None):
    """[{'start','end','day','label'}] the customer may pick from, soonest first (UTC ISO times; day and label in Thai
    time)."""
    moment = moment or utc_now()
    cfg = hours.config(db)
    today = moment.astimezone(hours.TZ).date()
    found = []
    for n in range(DAYS_AHEAD+1):
        day = today+dt.timedelta(days=n)
        for begin,end in SLOTS:
            start = dt.datetime.combine(day,dt.time.fromisoformat(begin),hours.TZ)
            finish = dt.datetime.combine(day,dt.time.fromisoformat(end),hours.TZ)
            if finish-dt.timedelta(minutes=LEAD_MINUTES)<=moment:
                continue
            middle = start+(finish-start)/2
            if cfg['enabled'] and not (hours.is_open(cfg,start) or hours.is_open(cfg,middle)):
                continue
            found.append({'start':iso(start.astimezone(dt.timezone.utc)),'end':iso(finish.astimezone(dt.timezone.utc)),
                          'day':day.isoformat(),'label':f'{begin}-{end}'})
    return found


def _line_ready(db, viewer):
    from backend.modules.customers import repository as customers
    from backend.modules.guest import repository as guests
    if viewer.get('visitor'):
        return bool(guests.line_link(db,viewer['visitor']['id']))
    return bool(viewer.get('account_id') and customers.line_link(db,viewer['account_id']))


def _waiting(db, conversation_id):
    """The request still waiting in the chat: not called off, and its reminder not done by the team."""
    return one(db,'''SELECT c.* FROM callback_requests c JOIN followups f ON f.id=c.followup_id
                     WHERE c.conversation_id=? AND c.status='waiting' AND f.done_at IS NULL ORDER BY c.created_at DESC LIMIT 1''',
               (conversation_id,))


def _view(row):
    return {'id':row['id'],'method':row['method'],'phone':row['phone'],'start':row['starts_at'],'end':row['ends_at'],'note':row['note']} if row else None


def state(db, conv, viewer):
    """What the chat's "ขอให้ติดต่อกลับ" shows: the request waiting, the times, whether LINE is there, and the number
    the organization already has for them (to start from)."""
    contact = one(db,'SELECT phone FROM contacts WHERE id=?',(conv['contact_id'],))
    return {'waiting':_view(_waiting(db,conv['id'])),'slots':slots(db),'line_ready':_line_ready(db,viewer),
            'phone':(contact['phone'] or '') if contact else ''}


def when_text(start, end):
    a,b = (dt.datetime.fromisoformat(t).astimezone(hours.TZ) for t in (start,end))
    return f"วัน{hours.DAY_NAMES[a.weekday()]}ที่ {a.day} {hours.MONTHS[a.month-1]} เวลา {a:%H:%M}-{b:%H:%M} น."


def _ticket(db, conv):
    """The chat's case, opened when it has none (a chat the chatbot looks after is handed to the team first)."""
    from backend.modules.ai import service as ai
    from backend.modules.tickets import repository as tickets, service as ticket_service
    if ai.conversation_state(db,conv['id'])['mode']=='bot':
        return ai.handoff(db,conv['id'],'callback')
    ticket = tickets.for_conversation(db,conv['id'])
    if ticket:
        tickets.reopen(db,ticket['id'])
        return ticket['id']
    return ticket_service.open_ticket(db,conv['contact_id'],conv['team_id'],conv['subject'],'normal',conversation_id=conv['id'])


def _drop(db, row):
    from backend.modules.automation import repository as automation
    db.execute("UPDATE callback_requests SET status='cancelled' WHERE id=?",(row['id'],))
    automation.finish_followup(db,row['followup_id'])


def request(db, conv, viewer, author, body):
    """POST …/callback {method, phone, start, note} to ask, or {cancel: true} to call the waiting one off."""
    from backend.modules.ai import service as ai
    from backend.modules.automation import repository as automation
    from backend.realtime import events as realtime
    body = body if isinstance(body,dict) else {}
    D.begin(db)
    waiting = _waiting(db,conv['id'])
    if body.get('cancel') is True:
        require(waiting,'ไม่มีคำขอให้ติดต่อกลับที่รออยู่')
        _drop(db,waiting)
        ai.system_message(db,conv['id'],'ยกเลิกคำขอให้ติดต่อกลับแล้ว')
        audit.record(db,author,'callback.cancelled',waiting['ticket_id'])
        realtime.ticket(db,waiting['ticket_id'],public=True)
        db.commit()
        return {'waiting':None}
    method = body.get('method')
    require(method in METHODS,'เลือกช่องทางที่ให้ติดต่อกลับ')
    phone = ''
    if method=='phone':
        raw = body.get('phone')
        phone = re.sub(r'[\s()-]','',raw) if isinstance(raw,str) else ''
        require(PHONE.fullmatch(phone),'กรอกเบอร์โทรให้ถูกต้อง เช่น 0812345678')
    else:
        require(_line_ready(db,viewer),'ยังไม่ได้เชื่อม LINE กับองค์กรนี้ เลือกให้โทรกลับแทน หรือเชื่อม LINE ก่อน')
    slot = next((s for s in slots(db) if s['start']==body.get('start')),None)
    require(slot,'ช่วงเวลานี้เลือกไม่ได้แล้ว กรุณาเลือกใหม่')
    note = body.get('note','')
    require(isinstance(note,str) and len(note)<=NOTE_MAX,f'รายละเอียดเพิ่มเติมยาวได้ไม่เกิน {NOTE_MAX} ตัวอักษร')
    note = ' '.join(note.split())
    if waiting:
        _drop(db,waiting)
    ticket_id = _ticket(db,conv)
    how = f'โทรหา {phone}' if method=='phone' else 'ส่งข้อความทาง LINE'
    when = when_text(slot['start'],slot['end'])
    assignee = one(db,'SELECT assignee_id FROM tickets WHERE id=?',(ticket_id,))
    followup_id = uid()
    automation.insert_followup(db,followup_id,ticket_id,slot['start'],f'ลูกค้าขอให้ติดต่อกลับ: {how} {when}'+(f' ({note})' if note else ''),
                               (assignee['assignee_id'] if assignee else None) or '',author)
    db.execute('INSERT INTO callback_requests VALUES(?,?,?,?,?,?,?,?,?,?,?)',
               (uid(),conv['id'],ticket_id,method,phone,slot['start'],slot['end'],note,followup_id,'waiting',now()))
    ai.system_message(db,conv['id'],f'ขอให้ติดต่อกลับ: {how} {when} ทีมงานจะติดต่อกลับในช่วงเวลานี้')
    audit.record(db,author,'callback.requested',ticket_id,f'{how} {when}')
    realtime.ticket(db,ticket_id,public=True)
    db.commit()
    return {'waiting':_view(_waiting(db,conv['id']))}
