"""สรุปผลงานประจำเดือน (model.py): one member's month in an organization, for their eyes only."""
import datetime as dt
import re
from statistics import median

from backend.database.db import one, rows
from backend.modules.achievements import badges
from backend.modules.achievements.model import EARLY_UNTIL, NIGHT_FROM, NIGHT_UNTIL, RECAP_MONTHS, THAI_MONTHS, WORK_TZ
from backend.utils.dates import iso, now, utc_now
from backend.utils.validation import require

MONTH = re.compile(r'(\d{4})-(0[1-9]|1[0-2])')
DONE = ('resolved','closed')
# The conversations of a month read for the reply times, at most (a very busy member's month is still quick).
WAIT_CONVERSATIONS = 600
# A customer's message this long before the month can still be what the month's first reply answered.
LOOKBACK_DAYS = 7


def _month_of(moment):
    return f'{moment.year:04d}-{moment.month:02d}'


def this_month(moment=None):
    return _month_of((moment or utc_now()).astimezone(WORK_TZ))


def last_month(moment=None):
    local = (moment or utc_now()).astimezone(WORK_TZ)
    return _month_of(local.replace(day=1)-dt.timedelta(days=1))


def open_months(moment=None):
    """This month (so far) and the RECAP_MONTHS before it, newest first."""
    local = (moment or utc_now()).astimezone(WORK_TZ).replace(day=1)
    found = []
    for _ in range(RECAP_MONTHS+1):
        found.append(_month_of(local))
        local = (local-dt.timedelta(days=1)).replace(day=1)
    return found


def label(month):
    year,number = int(month[:4]),int(month[5:])
    return f'{THAI_MONTHS[number-1]} {year+543}'


def bounds(month):
    """[start, end) of a month in Thai time, as stored UTC timestamps."""
    year,number = int(month[:4]),int(month[5:])
    start = dt.datetime(year,number,1,tzinfo=WORK_TZ)
    end = dt.datetime(year+(number==12),number%12+1,1,tzinfo=WORK_TZ)
    return iso(start.astimezone(dt.timezone.utc)),iso(end.astimezone(dt.timezone.utc))


def _thai(stamp):
    return dt.datetime.fromisoformat(stamp).astimezone(WORK_TZ)


def _minutes(since, until):
    return max(0.0,(dt.datetime.fromisoformat(until)-dt.datetime.fromisoformat(since)).total_seconds()/60)


def reply_waits(db, user_id, since, until):
    """Minutes each of the member's replies in [since, until) took: from the customer's first message not answered yet
    to the reply. Replies of the chatbot or the system do not answer; any person's reply does."""
    convs = [r[0] for r in db.execute(f'''SELECT DISTINCT m.conversation_id FROM messages m WHERE {badges.STAFF_REPLY}
                                         AND m.created_at>=? AND m.created_at<? LIMIT ?''',(user_id,since,until,WAIT_CONVERSATIONS))]
    if not convs:
        return []
    start = iso(dt.datetime.fromisoformat(since)-dt.timedelta(days=LOOKBACK_DAYS))
    waits,waiting = [],{}
    for m in rows(db,f'''SELECT m.conversation_id,m.kind,m.author_id,m.created_at,
                            EXISTS(SELECT 1 FROM ai_message_meta a WHERE a.message_id=m.id) AS automatic
                         FROM messages m WHERE m.conversation_id IN ({','.join('?'*len(convs))}) AND m.kind IN ('customer','reply')
                         AND m.deleted_at IS NULL AND m.created_at>=? AND m.created_at<? ORDER BY m.conversation_id,m.created_at,m.rowid''',
                  (*convs,start,until)):
        if m['kind']=='customer':
            waiting.setdefault(m['conversation_id'],m['created_at'])
        elif m['author_id'] and not m['automatic']:
            asked = waiting.pop(m['conversation_id'],None)
            if asked and m['author_id']==user_id and m['created_at']>=since:
                waits.append(_minutes(asked,m['created_at']))
    return waits


def _counts(db, user_id, since, until):
    closed = db.execute(f'SELECT COUNT(*) FROM tickets WHERE assignee_id=? AND status IN {DONE} AND resolved_at>=? AND resolved_at<?',
                        (user_id,since,until)).fetchone()[0]
    replies = db.execute(f'SELECT COUNT(*) FROM messages m WHERE {badges.STAFF_REPLY} AND m.created_at>=? AND m.created_at<?',
                         (user_id,since,until)).fetchone()[0]
    return closed,replies


def _title(f):
    """What kind of month it was, in fun: the first that fits, with the figure that earned it."""
    replies,closed = f['replies'],f['closed']
    median_reply = f['median_minutes']
    rules = [
        ('night','นักดับไฟยามดึก',f['night']>=10 and f['night']>=0.25*replies,f"ตอบลูกค้าช่วงสี่ทุ่มถึงหกโมงเช้า {f['night']} ครั้ง"),
        ('one_touch','มือปิดเคสรอบเดียว',closed>=5 and f['one_touch']>=max(5,0.5*closed),f"ปิดจบในคำตอบเดียว {f['one_touch']} จาก {closed} เคส"),
        ('darling','ขวัญใจลูกค้า',f['five_star']>=3,f"ได้ 5 ดาว {f['five_star']} ครั้ง"),
        ('lightning','สายฟ้าแลบ',median_reply is not None and f['waits']>=10 and median_reply<=5,
         f"ครึ่งหนึ่งของคำตอบส่งถึงลูกค้าภายใน {_duration(median_reply)}" if median_reply is not None else ''),
        ('praised','ดาวเด่นบนกำแพง',f['praise']['count']>=3,f"ลูกค้าชมคุณ {f['praise']['count']} ครั้ง"),
        ('record','ทำลายสถิติตัวเอง',f['previous']['closed']>=5 and closed>f['previous']['closed'],
         f"ปิดเคสมากกว่าเดือนก่อน {closed-f['previous']['closed']} เคส"),
        ('helper','มือช่วยของทีม',f['helped']>=3,f"เข้าไปช่วยเพื่อนที่ยกมือ {f['helped']} ครั้ง"),
        ('weekend','นักรบวันหยุด',f['weekend']>=10 and f['weekend']>=0.3*replies,f"ตอบลูกค้าวันเสาร์อาทิตย์ {f['weekend']} ครั้ง"),
        ('early','นกตื่นเช้า',f['early']>=10 and f['early']>=0.25*replies,f"ตอบลูกค้าก่อนแปดโมงเช้า {f['early']} ครั้ง"),
        ('marathon','นักวิ่งมาราธอน',replies>=300,f'ตอบลูกค้า {replies:,} ข้อความ'),
    ]
    for key,name,fits,reason in rules:
        if fits:
            return {'key':key,'name':name,'reason':reason}
    return {'key':'guardian','name':'ผู้พิทักษ์ลูกค้า','reason':f"ดูแลลูกค้า {f['customers']} คนในเดือนนี้"}


def _duration(minutes):
    if minutes<1:
        return f'{max(1,round(minutes*60))} วินาที'
    if minutes<60:
        return f'{round(minutes)} นาที'
    hours,left = divmod(round(minutes),60)
    return f'{hours} ชั่วโมง'+(f' {left} นาที' if left else '')


def month_arg(query):
    value = (query.get('month') or [''])[0]
    if not value:
        return last_month()
    require(MONTH.fullmatch(value),'เดือนไม่ถูกต้อง')
    require(value in open_months(),f'ดูย้อนหลังได้ {RECAP_MONTHS} เดือน')
    return value


def recap(db, ctx, month):
    user_id = ctx['id']
    since,until = bounds(month)
    closed,replies = _counts(db,user_id,since,until)
    prev_since,prev_until = bounds(_month_of(_thai(since)-dt.timedelta(days=1)))
    prev_closed,prev_replies = _counts(db,user_id,prev_since,prev_until)
    by_day,night,early,weekend,customers = {},0,0,0,set()
    for r in rows(db,f'''SELECT m.created_at,c.contact_id FROM messages m JOIN conversations c ON c.id=m.conversation_id
                         WHERE {badges.STAFF_REPLY} AND m.created_at>=? AND m.created_at<?''',(user_id,since,until)):
        at = _thai(r['created_at'])
        by_day[at.date()] = by_day.get(at.date(),0)+1
        night += at.hour>=NIGHT_FROM or at.hour<NIGHT_UNTIL
        early += NIGHT_UNTIL<=at.hour<EARLY_UNTIL
        weekend += at.weekday()>=5
        customers.add(r['contact_id'])
    busiest = max(by_day.items(),key=lambda item:(item[1],item[0])) if by_day else None
    waits = reply_waits(db,user_id,since,until)
    ratings = [r[0] for r in db.execute('''SELECT s.rating FROM csat_surveys s JOIN tickets t ON t.id=s.ticket_id WHERE t.assignee_id=?
                                           AND s.answered_at>=? AND s.answered_at<? AND s.rating IS NOT NULL''',(user_id,since,until))]
    praise = rows(db,'''SELECT k.text,k.rating FROM kudos k JOIN conversations c ON c.id=k.conversation_id WHERE k.user_id=?
                        AND k.hidden_at IS NULL AND k.created_at>=? AND k.created_at<? ORDER BY k.created_at DESC''',(user_id,since,until))
    found = {
        'month':month,'label':label(month),'partial':month==this_month(),'name':ctx['name'],
        'closed':closed,'replies':replies,'customers':len(customers),
        'busiest':{'day':busiest[0].isoformat(),'count':busiest[1]} if busiest else None,
        'fastest_minutes':round(min(waits),2) if waits else None,
        'median_minutes':round(median(waits),1) if waits else None,'waits':len(waits),
        'five_star':sum(1 for r in ratings if r==5),'csat':round(sum(ratings)/len(ratings),2) if ratings else None,'csat_count':len(ratings),
        'praise':{'count':len(praise),'texts':[p['text'] for p in praise[:2]]},
        'one_touch':db.execute(badges.one_touch_sql('t.resolved_at>=? AND t.resolved_at<?'),(user_id,since,until)).fetchone()[0],
        'night':night,'early':early,'weekend':weekend,
        'helped':db.execute('SELECT COUNT(*) FROM help_requests WHERE helper_id=? AND raised_by!=? AND helped_at>=? AND helped_at<?',
                            (user_id,user_id,since,until)).fetchone()[0],
        'badges':badges.earned_between(db,user_id,since,until),
        'previous':{'closed':prev_closed,'replies':prev_replies},
    }
    found['empty'] = not replies and not closed
    found['title'] = _title(found)
    return found


def pending(cd, db, ctx):
    """Last month's card, when it should pop up now: the member had work in it, has not seen it, and did not switch the
    pop-up off (ตั้งค่าบัญชี → การแจ้งเตือน)."""
    from backend.modules.staff_prefs import service as staff_prefs
    if cd is None or ctx.get('read_only') or not staff_prefs.prefs_of(cd,ctx['id'])['notify'].get('recap',True):
        return None
    month = last_month()
    if one(db,'SELECT 1 FROM staff_recaps_seen WHERE user_id=? AND month=?',(ctx['id'],month)):
        return None
    since,until = bounds(month)
    worked = one(db,f'''SELECT 1 FROM messages m WHERE {badges.STAFF_REPLY} AND m.created_at>=? AND m.created_at<? LIMIT 1''',
                 (ctx['id'],since,until)) or one(db,f'''SELECT 1 FROM tickets WHERE assignee_id=? AND status IN {DONE}
                                                        AND resolved_at>=? AND resolved_at<? LIMIT 1''',(ctx['id'],since,until))
    return {'month':month,'label':label(month)} if worked else None


def mark_seen(db, ctx, body):
    month = body.get('month')
    require(isinstance(month,str) and MONTH.fullmatch(month),'เดือนไม่ถูกต้อง')
    db.execute('INSERT OR IGNORE INTO staff_recaps_seen VALUES(?,?,?)',(ctx['id'],month,now()))
    db.commit()
    return {'ok':True}
