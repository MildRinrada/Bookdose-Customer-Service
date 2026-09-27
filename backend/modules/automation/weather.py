"""พยากรณ์อากาศของกล่องข้อความ: the overview's first line, the day ahead in the words a weather report uses - ฟ้าใส,
ฝนตกหนัก, บ่ายนี้มีพายุ, อากาศร้อน - so a member knows at a glance what kind of day it is going to be.

What it reads, for the cases the member can see (their team, or everything for an owner):
  how many new cases today should bring: what has come in so far, and what the same weekday brought in the rest of
  the day over the last four weeks; compared with what that weekday usually brings. The two hours ahead that usually
  bring the most are named when they stand out (บ่ายนี้ ... ช่วง 13:00 ถึง 15:00).
  how customers feel today (ai/mood.py's log): more of them upset than usual is อากาศร้อน.
  what is already late: เมฆครึ้ม.
An organization with less than two weeks of cases has no usual yet; the line says so and speaks of today only.

Figures only, never words: nothing here leaves the organization or calls an AI."""
import datetime as dt
from statistics import median

from backend.database.db import one
from backend.utils.dates import iso, now, utc_now

HISTORY_WEEKS = 4
MIN_HISTORY_DAYS = 14
DONE = ('resolved','closed')


def _local(stamp, tz):
    """A stored UTC timestamp as the viewer's wall time (tz is the browser's getTimezoneOffset())."""
    return dt.datetime.fromisoformat(stamp)-dt.timedelta(minutes=tz)


def _when(hour):
    return 'เช้านี้' if hour<12 else 'บ่ายนี้' if hour<17 else 'เย็นนี้' if hour<20 else 'คืนนี้'


def _mood(db, since, until, team):
    where,params = ('AND c.team_id=?',(team,)) if team is not None else ('',())
    found = one(db,f'''SELECT COUNT(DISTINCT l.conversation_id) AS talked,COUNT(DISTINCT CASE WHEN l.level>=1 THEN l.conversation_id END) AS upset
                       FROM conversation_mood_log l JOIN conversations c ON c.id=l.conversation_id
                       WHERE l.created_at>=? AND l.created_at<? {where}''',(since,until,*params))
    return found['talked'] or 0,found['upset'] or 0


def forecast(db, team, tz):
    """{'kind', 'title', 'detail', 'notes', 'expected', 'usual'}: kind is storm, rain, hot, cloudy, clear or fair."""
    moment = utc_now()
    local = moment-dt.timedelta(minutes=tz)
    midnight = local.replace(hour=0,minute=0,second=0,microsecond=0)
    day_start = iso(midnight+dt.timedelta(minutes=tz))
    history_start = iso(midnight-dt.timedelta(days=7*HISTORY_WEEKS)+dt.timedelta(minutes=tz))
    where,params = ('AND team_id=?',(team,)) if team is not None else ('',())

    # New cases by the viewer's day and hour, over the last four weeks and today.
    by_day = {}
    for (stamp,) in db.execute(f'SELECT created_at FROM tickets WHERE created_at>=? {where}',(history_start,*params)):
        at = _local(stamp,tz)
        hours = by_day.setdefault(at.date(),[0]*24)
        hours[at.hour] += 1
    today = by_day.get(midnight.date(),[0]*24)
    so_far = sum(today)
    first = db.execute(f'SELECT MIN(created_at) FROM tickets WHERE 1=1 {where}',params).fetchone()[0]
    known_days = (local-_local(first,tz)).days if first else 0

    notes = []
    late = one(db,f'''SELECT COUNT(*) AS n FROM tickets WHERE status NOT IN {DONE} {where}
                      AND ((first_response_at IS NULL AND first_response_due_at<?) OR resolution_due_at<?)''',(*params,now(),now()))['n']
    talked,upset = _mood(db,day_start,now(),team)
    base_talked,base_upset = _mood(db,history_start,day_start,team)
    share = upset/talked if talked else 0
    usual_share = base_upset/base_talked if base_talked>=20 else None
    hot = upset>=3 and (share>=0.3 if usual_share is None else share>=max(1.5*usual_share,usual_share+0.1))
    hot_text = f'วันนี้มีลูกค้าไม่พอใจ {upset} คน มากกว่าปกติ ตอบใจเย็น ๆ ค่อย ๆ อธิบายนะ'
    late_text = f'มีเคสเกินกำหนดอยู่ {late} เคส เคลียร์ก่อนเคสใหม่จะเข้ามา'

    if known_days<MIN_HISTORY_DAYS:
        wait = MIN_HISTORY_DAYS-known_days
        learning = f'ระบบกำลังเรียนรู้ อีกราว {wait} วันจะบอกได้ว่าวันไหนเคสเข้าเยอะ'
        if hot:
            return {'kind':'hot','title':'อากาศร้อน ลูกค้าอารมณ์ร้อนกว่าปกติ','detail':hot_text,'notes':[late_text] if late else [],'expected':None,'usual':None}
        if late:
            return {'kind':'cloudy','title':'เมฆครึ้ม','detail':late_text,'notes':[learning],'expected':None,'usual':None}
        return {'kind':'fair','title':'อากาศดี','detail':f'วันนี้เข้ามาแล้ว {so_far} เคส','notes':[learning],'expected':None,'usual':None}

    # The same weekday of the last four weeks that the organization already had cases on.
    samples = []
    for week in range(1,HISTORY_WEEKS+1):
        day = (midnight-dt.timedelta(days=7*week)).date()
        if known_days>=7*week:
            samples.append(by_day.get(day,[0]*24))
    usual = median(sum(s) for s in samples) if samples else 0
    hour = local.hour
    left_of_hour = 1-local.minute/60
    mean = [sum(s[h] for s in samples)/len(samples) for h in range(24)] if samples else [0]*24
    expected = round(so_far+mean[hour]*left_of_hour+sum(mean[hour+1:]))
    usual = round(usual)

    # The two hours ahead that usually bring the most, when they stand well above the day's average hour.
    window = None
    if hour<22:
        best = max(range(hour+1,23),key=lambda h:mean[h]+mean[h+1])
        busy = mean[best]+mean[best+1]
        if busy>=3 and busy>=2*1.5*(sum(mean)/24 or 1):
            window = best
    span = f' หนักสุดช่วง {window:02d}:00 ถึง {window+2:02d}:00' if window is not None else ''

    if expected>=1.8*max(usual,1) and expected-usual>=5:
        kind = 'storm'
        title = f'{_when(window)}มีพายุ' if window is not None else 'วันนี้มีพายุ'
        detail = f'เคสน่าจะเข้าราว {expected} เคส เกือบเท่าตัวของปกติ ({usual} เคส){span}'
    elif expected>=1.3*max(usual,1) and expected-usual>=3:
        kind = 'rain'
        title = f'{_when(window)}ฝนตกหนัก' if window is not None else 'ฝนตกหนักกว่าปกติ'
        detail = f'เคสน่าจะเข้าราว {expected} เคส ปกติราว {usual} เคส{span}'
    elif hot:
        kind,title,detail = 'hot','อากาศร้อน ลูกค้าอารมณ์ร้อนกว่าปกติ',hot_text
    elif late:
        kind,title,detail = 'cloudy','เมฆครึ้ม',late_text
    elif usual<1 and expected<1:
        kind,title,detail = 'clear','วันนี้ฟ้าใส','ช่วงนี้เคสเข้าน้อย วันนี้น่าจะสบาย ๆ'
    elif expected<=0.7*usual and usual-expected>=2:
        kind,title,detail = 'clear','วันนี้ฟ้าใส',f'เคสน่าจะเข้าน้อยกว่าปกติ ราว {expected} เคส ปกติราว {usual} เคส'
    else:
        kind,title,detail = 'fair','อากาศดี',f'เคสน่าจะเข้าราว {expected} เคส ใกล้เคียงปกติ'
    if hot and kind!='hot':
        notes.append(hot_text)
    if late and kind!='cloudy':
        notes.append(late_text)
    return {'kind':kind,'title':title,'detail':detail,'notes':notes,'expected':expected,'usual':usual}
