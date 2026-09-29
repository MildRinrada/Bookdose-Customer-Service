"""เวลาทำการ: the hours the organization answers, and the reply a customer gets when they write outside them - on the
web chat, LINE, email and Facebook alike, once per closed stretch per conversation, so a customer writing three
messages at night reads the notice once, and again only after the next closing.

The notice is a system message (ai_message_meta source 'system'): it does not count as the team's first response,
and the conversation still reads as waiting for the team (conversations.repository leaves system messages out).
Holidays (วันหยุดพิเศษ) are closed all day. With `sla` on, a new case's SLA clock runs only while the organization
is open (sla_due), so a case written on Friday night is not late on Monday morning.
Hours are Thai time (UTC+7, no daylight saving)."""
import datetime as dt
import json
import re

from backend.exceptions.errors import APIError
from backend.utils.security import uid
from backend.utils.validation import require

TZ = dt.timezone(dt.timedelta(hours=7))
KEY = 'business_hours'
TOKEN = '{เวลาเปิด}'
MESSAGE_MAX = 500
HOLIDAYS_MAX = 60
HOLIDAY_NAME_MAX = 60
DAY_NAMES = ('จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์')
MONTHS = ('ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.')
DEFAULT = {'enabled':False,'sla':False,'days':[['09:00','18:00']]*5+[None,None],'holidays':[],
           'message':f'ขณะนี้อยู่นอกเวลาทำการ ได้รับข้อความของคุณแล้ว ทีมงานจะตอบกลับ{TOKEN}'}
TIME = re.compile(r'([01][0-9]|2[0-3]):[0-5][0-9]')
DATE = re.compile(r'[0-9]{4}-[0-9]{2}-[0-9]{2}')
# How far ahead an opening or an SLA deadline is looked for; past it the clock runs straight through.
AHEAD_DAYS = 3660

TABLE = '''
CREATE TABLE IF NOT EXISTS hours_notices (conversation_id TEXT PRIMARY KEY, sent_at TEXT NOT NULL);
'''


def config(db):
    row = db.execute('SELECT value FROM settings WHERE key=?',(KEY,)).fetchone()
    try:
        value = json.loads(row[0]) if row and row[0] else None
    except ValueError:
        value = None
    # Saved before holidays and the SLA switch existed: those start empty and off.
    return {**DEFAULT,**value} if isinstance(value,dict) else dict(DEFAULT)


def _holidays_form(items, today):
    """[{date, name}] in date order; days already past are dropped (they close nothing any more)."""
    require(isinstance(items,list),'ข้อมูลวันหยุดไม่ถูกต้อง')
    found = {}
    for item in items:
        require(isinstance(item,dict),'ข้อมูลวันหยุดไม่ถูกต้อง')
        date,name = item.get('date',''),item.get('name','')
        require(isinstance(date,str) and DATE.fullmatch(date),'วันที่ของวันหยุดไม่ถูกต้อง')
        try:
            day = dt.date.fromisoformat(date)
        except ValueError:
            raise APIError(400,'วันที่ของวันหยุดไม่ถูกต้อง')
        require(isinstance(name,str) and len(name.strip())<=HOLIDAY_NAME_MAX,f'ชื่อวันหยุดยาวได้ไม่เกิน {HOLIDAY_NAME_MAX} ตัวอักษร')
        if day>=today:
            found[date] = name.strip()
    require(len(found)<=HOLIDAYS_MAX,f'ตั้งวันหยุดพิเศษได้ไม่เกิน {HOLIDAYS_MAX} วัน')
    return [{'date':date,'name':found[date]} for date in sorted(found)]


def form(body, today=None):
    """{enabled, sla, days: 7 × [open, close] or null (Monday first), holidays, message} from the owner's form."""
    enabled,sla = body.get('enabled',False),body.get('sla',False)
    require(type(enabled) is bool and type(sla) is bool,'สถานะเวลาทำการไม่ถูกต้อง')
    days = body.get('days')
    require(isinstance(days,list) and len(days)==7,'กรุณาระบุเวลาทำการครบ 7 วัน')
    clean = []
    for name,day in zip(DAY_NAMES,days):
        if day is None:
            clean.append(None)
            continue
        require(isinstance(day,list) and len(day)==2 and all(isinstance(t,str) and TIME.fullmatch(t) for t in day),f'เวลาของวัน{name}ไม่ถูกต้อง')
        require(day[0]<day[1],f'วัน{name}: เวลาปิดต้องหลังเวลาเปิด')
        clean.append([day[0],day[1]])
    require(not (enabled or sla) or any(clean),'เปิดใช้เวลาทำการแล้วต้องมีอย่างน้อย 1 วันที่เปิด')
    holidays = _holidays_form(body.get('holidays',[]),today or dt.datetime.now(TZ).date())
    message = body.get('message','')
    require(isinstance(message,str) and 0<len(message.strip())<=MESSAGE_MAX,f'ข้อความนอกเวลาต้องมี 1-{MESSAGE_MAX} ตัวอักษร')
    return {'enabled':enabled,'sla':sla,'days':clean,'holidays':holidays,'message':message.strip()}


def save(db, ctx, body):
    from backend.database import audit
    value = form(body)
    db.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(KEY,json.dumps(value,ensure_ascii=False)))
    uses = [word for on,word in ((value['enabled'],'ตอบนอกเวลา'),(value['sla'],'นับ SLA เฉพาะเวลาทำการ')) if on]
    audit.record(db,ctx['name'],'settings.updated',ctx['tenant_id'],
                 f"เวลาทำการ ({', '.join(uses) or 'ปิด'}) · วันหยุดพิเศษ {len(value['holidays'])} วัน")
    db.commit()
    return value


def _at(day, text):
    hour,minute = map(int,text.split(':'))
    return dt.datetime(day.year,day.month,day.day,hour,minute,tzinfo=TZ)


def _spans(cfg, moment, back, ahead):
    """(open, close) of the days from `back` days before `moment` to `ahead` days after, in order; holidays are closed."""
    today = moment.astimezone(TZ).date()
    closed = {h['date'] for h in cfg.get('holidays') or []}
    for offset in range(-back,ahead+1):
        day = today+dt.timedelta(days=offset)
        hours = cfg['days'][day.weekday()]
        if hours and day.isoformat() not in closed:
            yield _at(day,hours[0]),_at(day,hours[1])


def is_open(cfg, moment):
    return any(start<=moment<end for start,end in _spans(cfg,moment,0,0))


def next_open(cfg, moment):
    return next((start for start,_ in _spans(cfg,moment,0,AHEAD_DAYS) if start>moment),None)


def last_close(cfg, moment):
    # Back past the longest run of holidays allowed, so a long break is still one closed stretch.
    return max((end for _,end in _spans(cfg,moment,HOLIDAYS_MAX+7,0) if end<=moment),default=None)


def next_day_close(cfg, moment):
    """When the next working day after `moment`'s ends: the closing time of the first open day after today (holidays
    and closed days skipped), or None when nothing is open ahead."""
    today = moment.astimezone(TZ).date()
    return next((end for _,end in _spans(cfg,moment,0,HOLIDAYS_MAX+14) if end.date()>today),None)


def deadline(cfg, start, hours):
    """The moment `hours` of opening time after `start`: the clock stops while closed (nights, closed days, holidays)."""
    left = dt.timedelta(hours=hours)
    for opening,closing in _spans(cfg,start,0,AHEAD_DAYS):
        if closing<=start:
            continue
        begin = max(opening,start)
        if begin+left<=closing:
            return begin+left
        left -= closing-begin
    return start+dt.timedelta(hours=hours)


def sla_in_opening_time(db):
    """Whether the SLA clock runs only while open: the customer's pages then promise a reply "within 4 hours of
    opening time" rather than just "within 4 hours"."""
    cfg = config(db)
    return bool(cfg.get('sla') and any(cfg['days']))


def sla_due(db, start, hours):
    """A new case's SLA deadline: `hours` after `start`, counted in opening time when the organization chose that."""
    cfg = config(db)
    if cfg.get('sla') and any(cfg['days']):
        return deadline(cfg,start,hours)
    return start+dt.timedelta(hours=hours)


def when_text(target, moment):
    """"วันนี้ 09:00", "พรุ่งนี้ 09:00", "วันจันทร์ 09:00" or, a week or more away, "17 เม.ย. 09:00" (Thai time)."""
    local,today = target.astimezone(TZ),moment.astimezone(TZ).date()
    days = (local.date()-today).days
    word = ('วันนี้' if days==0 else 'พรุ่งนี้' if days==1 else 'วัน'+DAY_NAMES[local.weekday()] if days<7
            else f'{local.day} {MONTHS[local.month-1]}')
    return word+local.strftime(' %H:%M')


def notice_text(cfg, moment):
    opening = next_open(cfg,moment)
    text = cfg['message']
    if TOKEN in text:
        text = text.replace(TOKEN,(' '+when_text(opening,moment)) if opening else 'โดยเร็วที่สุด')
    return text


def after_customer_message(db, tenant_id, conversation_id, moment=None):
    """Inside store_message's transaction: the out-of-hours notice, when it is due. Returns the message id or None."""
    from backend.modules.ai import repository as ai_repository
    from backend.modules.conversations import repository as conversations
    cfg = config(db)
    moment = moment or dt.datetime.now(dt.timezone.utc)
    if not cfg.get('enabled') or not any(cfg['days']) or is_open(cfg,moment):
        return None
    conv = conversations.find(db,conversation_id)
    if not conv or conv['channel']=='manual':
        return None
    sent = db.execute('SELECT sent_at FROM hours_notices WHERE conversation_id=?',(conversation_id,)).fetchone()
    closed = last_close(cfg,moment)
    if sent and (not closed or sent[0]>=closed.astimezone(dt.timezone.utc).isoformat(timespec='seconds')):
        return None
    mid = uid()
    conversations.insert_message(db,mid,conversation_id,None,'ระบบ','reply',notice_text(cfg,moment))
    ai_repository.insert_message_meta(db,mid,'system','[]')
    db.execute('INSERT INTO hours_notices VALUES(?,?) ON CONFLICT(conversation_id) DO UPDATE SET sent_at=excluded.sent_at',
               (conversation_id,moment.astimezone(dt.timezone.utc).isoformat(timespec='seconds')))
    _deliver(db,tenant_id,conv,mid)
    return mid


def _deliver(db, tenant_id, conv, mid):
    """LINE, email and Facebook get it through their outbox as the system's own message (channels/move.SYSTEM_ACTOR);
    the web chat shows it at once."""
    from backend.modules.channels import facebook, repository as channel_repository, service as channels
    from backend.modules.channels.move import SYSTEM_ACTOR
    ctx = {'tenant_id':tenant_id,'id':SYSTEM_ACTOR}
    if conv['channel'] in ('line','email'):
        row = channels.setting(db,conv['channel'])
        if row and row['enabled'] and channel_repository.link_for_conversation(db,conv['id']):
            channels.enqueue_reply(db,ctx,conv,mid)
    elif conv['channel'] in facebook.KINDS:
        row = channel_repository.find_facebook_setting(db)
        on = row and row['enabled'] and (conv['channel']==facebook.KIND or facebook.instagram_on(row))
        if on and channel_repository.link_for_conversation(db,conv['id']):
            facebook.enqueue_reply(db,ctx,conv,mid)
