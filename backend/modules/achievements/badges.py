"""เหรียญความสำเร็จ (model.py): each badge is a measure of the member's own work and the number it has to reach.
Worked out from what the organization already records - cases, replies, ratings, the praise wall, raised hands - so
nothing new is counted just for badges, and a badge reached before badges existed is earned the first time it is
worked out."""
import threading
import time

from backend.database.db import rows
from backend.modules.achievements.model import CHECK_SECONDS, NIGHT_FROM, NIGHT_UNTIL
from backend.utils.dates import after, now

DONE = ('resolved','closed')

BADGES = [
    {'key':'first_close','name':'ปิดเคสแรก','detail':'ปิดเคสแรกของคุณสำเร็จ','measure':'closed','goal':1,'icon':'checkCircle'},
    {'key':'close_50','name':'นักปิดงาน','detail':'ปิดเคสครบ 50 เคส','measure':'closed','goal':50,'icon':'ticket'},
    {'key':'close_100','name':'ร้อยเคสร้อยใจ','detail':'ปิดเคสครบ 100 เคส','measure':'closed','goal':100,'icon':'ticket'},
    {'key':'close_500','name':'ตำนานปิดเคส','detail':'ปิดเคสครบ 500 เคส','measure':'closed','goal':500,'icon':'award'},
    {'key':'replies_1000','name':'พันคำตอบ','detail':'ตอบลูกค้าครบ 1,000 ข้อความ','measure':'replies','goal':1000,'icon':'chat'},
    {'key':'sla_streak_10','name':'ตรงเวลาเป๊ะ','detail':'ตอบครั้งแรกทันกำหนดทุกเคส 10 วันทำงานติดกัน','measure':'sla_streak','goal':10,'icon':'clock'},
    {'key':'five_star_10','name':'ขวัญใจลูกค้า','detail':'ได้ 5 ดาวครบ 10 ครั้ง','measure':'five_star','goal':10,'icon':'star'},
    {'key':'one_touch_25','name':'จบในคำตอบเดียว','detail':'แก้เคสจบในคำตอบเดียว 25 เคส','measure':'one_touch','goal':25,'icon':'bolt'},
    {'key':'calm_hero_3','name':'ใจเย็นเป็นเลิศ','detail':'ลูกค้าที่เคยไม่พอใจให้ 4 ดาวขึ้นไป 3 ครั้ง','measure':'calm_hero','goal':3,'icon':'heart'},
    {'key':'night_owl_20','name':'นกฮูกยามดึก','detail':'ตอบลูกค้าช่วงสี่ทุ่มถึงหกโมงเช้า 20 ครั้ง','measure':'night','goal':20,'icon':'moon'},
    {'key':'praised_5','name':'คำชมล้นกำแพง','detail':'ได้คำชมจากลูกค้าบนกำแพงคำชม 5 ครั้ง','measure':'praised','goal':5,'icon':'sparkle'},
    {'key':'helper_5','name':'มือช่วยของทีม','detail':'เข้าไปช่วยเพื่อนที่ยกมือขอช่วย 5 ครั้ง','measure':'helped','goal':5,'icon':'hand'},
    {'key':'cheer_10','name':'สายเชียร์','detail':'เป็นกำลังใจให้คำชมของเพื่อนบนกำแพงคำชม 10 ครั้ง','measure':'cheers','goal':10,'icon':'heart'},
]
BY_KEY = {b['key']:b for b in BADGES}

# A reply written by a person (not the chatbot or the system) and not taken back.
STAFF_REPLY = ("m.kind='reply' AND m.author_id=? AND m.deleted_at IS NULL "
               "AND NOT EXISTS(SELECT 1 FROM ai_message_meta a WHERE a.message_id=m.id)")
PEOPLE_REPLY = ("m.kind='reply' AND m.author_id IS NOT NULL AND m.deleted_at IS NULL "
                "AND NOT EXISTS(SELECT 1 FROM ai_message_meta a WHERE a.message_id=m.id)")
THAI_HOUR = "CAST(strftime('%H',m.created_at,'+7 hours') AS INTEGER)"
STREAK_DAYS = 180

_checked = {}
_lock = threading.Lock()


def _count(db, sql, params):
    return db.execute(sql,params).fetchone()[0] or 0


def one_touch_sql(where):
    """Finished cases of the member that the team answered once and that never came back (the report's แก้จบในครั้งเดียว)."""
    return f'''SELECT COUNT(*) FROM tickets t WHERE t.assignee_id=? AND t.status IN {DONE} AND {where}
               AND NOT EXISTS(SELECT 1 FROM ticket_reopens r WHERE r.ticket_id=t.id)
               AND (SELECT COUNT(*) FROM ticket_conversations tc JOIN messages m ON m.conversation_id=tc.conversation_id
                    WHERE tc.ticket_id=t.id AND {PEOPLE_REPLY})=1'''


def sla_streak(db, user_id):
    """The longest run of work days (Thai time, days with a first reply of theirs) on which every first reply the member's
    cases got was on time. A day without first replies neither counts nor breaks the run."""
    days = {}
    for r in rows(db,'''SELECT date(first_response_at,'+7 hours') AS day,first_response_at<=first_response_due_at AS on_time
                        FROM tickets WHERE assignee_id=? AND first_response_at>=?''',(user_id,after(days=-STREAK_DAYS))):
        days[r['day']] = days.get(r['day'],True) and bool(r['on_time'])
    best = run = 0
    for day in sorted(days):
        run = run+1 if days[day] else 0
        best = max(best,run)
    return best


def measures(db, user_id):
    """{measure: the member's number now}."""
    from backend.modules.tickets import hands
    return {
        'closed':_count(db,f'SELECT COUNT(*) FROM tickets WHERE assignee_id=? AND status IN {DONE}',(user_id,)),
        'replies':_count(db,f'SELECT COUNT(*) FROM messages m WHERE {STAFF_REPLY}',(user_id,)),
        'five_star':_count(db,'SELECT COUNT(*) FROM csat_surveys s JOIN tickets t ON t.id=s.ticket_id WHERE t.assignee_id=? AND s.rating=5',(user_id,)),
        'one_touch':_count(db,one_touch_sql('1=1'),(user_id,)),
        'calm_hero':_count(db,'''SELECT COUNT(*) FROM csat_surveys s JOIN tickets t ON t.id=s.ticket_id WHERE t.assignee_id=? AND s.rating>=4
                                 AND EXISTS(SELECT 1 FROM ticket_conversations tc JOIN conversation_mood_log l ON l.conversation_id=tc.conversation_id
                                            WHERE tc.ticket_id=t.id AND l.level>=1 AND l.created_at<=s.answered_at)''',(user_id,)),
        'night':_count(db,f'SELECT COUNT(*) FROM messages m WHERE {STAFF_REPLY} AND ({THAI_HOUR}>={NIGHT_FROM} OR {THAI_HOUR}<{NIGHT_UNTIL})',(user_id,)),
        'praised':_count(db,'SELECT COUNT(*) FROM kudos WHERE user_id=? AND hidden_at IS NULL',(user_id,)),
        'helped':hands.helped_count(db,user_id),
        'cheers':_count(db,'SELECT COUNT(*) FROM kudos_cheers WHERE user_id=?',(user_id,)),
        'sla_streak':sla_streak(db,user_id),
    }


def check(db, tenant_id, user_id, force=False):
    """Give the member the badges they have reached and not been given yet (at most every CHECK_SECONDS). The caller
    commits; returns the keys given now."""
    key,moment = (tenant_id,user_id),time.monotonic()
    with _lock:
        if not force and _checked.get(key,-1e9)>moment-CHECK_SECONDS:
            return []
        _checked[key] = moment
    have = {r[0] for r in db.execute('SELECT badge FROM staff_badges WHERE user_id=?',(user_id,))}
    if len(have)==len(BADGES):
        return []
    found = measures(db,user_id)
    given = [b['key'] for b in BADGES if b['key'] not in have and found[b['measure']]>=b['goal']]
    for badge in given:
        db.execute('INSERT OR IGNORE INTO staff_badges(user_id,badge,earned_at) VALUES(?,?,?)',(user_id,badge,now()))
    return given


def unseen(db, user_id):
    """Badges given and not yet celebrated, for the staff frame (the alerts)."""
    return [{**_public(BY_KEY[r['badge']]),'earned_at':r['earned_at']}
            for r in rows(db,'SELECT badge,earned_at FROM staff_badges WHERE user_id=? AND seen_at IS NULL ORDER BY earned_at',(user_id,))
            if r['badge'] in BY_KEY]


def _public(badge):
    return {k:badge[k] for k in ('key','name','detail','goal','icon')}


def view(db, tenant_id, user_id):
    """Every badge, earned or not: when it was earned, or how far along the member is."""
    check(db,tenant_id,user_id,force=True)
    db.commit()
    earned = {r['badge']:r['earned_at'] for r in rows(db,'SELECT badge,earned_at FROM staff_badges WHERE user_id=?',(user_id,))}
    found = measures(db,user_id)
    return [{**_public(b),'progress':min(found[b['measure']],b['goal']),'earned_at':earned.get(b['key'])} for b in BADGES]


def mark_seen(db, user_id, keys):
    for key in keys:
        db.execute('UPDATE staff_badges SET seen_at=? WHERE user_id=? AND badge=? AND seen_at IS NULL',(now(),user_id,key))


def earned_between(db, user_id, since, until):
    return [_public(BY_KEY[r[0]]) for r in db.execute('SELECT badge FROM staff_badges WHERE user_id=? AND earned_at>=? AND earned_at<? ORDER BY earned_at',
                                                       (user_id,since,until)) if r[0] in BY_KEY]
