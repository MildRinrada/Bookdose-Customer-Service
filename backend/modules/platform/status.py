"""The status page everyone can open (GET /api/status, no sign-in).

An organization whose screen has stopped working has one question: is it the system, or is it us? Without an answer
everybody phones at once, and the people who could fix it spend the outage on the phone instead. So this answers it
in one public page: what the system itself checks about itself, and whatever the platform team has written about an
incident they already know of.

Two rules shape what is in here:
  - Nothing about any one organization. The page is public, so it says how the platform is, never who is on it, how
    many there are, or whose channel is failing. An organization's own connections are checked on its own settings
    screen, where only its own people can look.
  - It must be cheap and it must not lie. The worst moment for this page is the moment everybody opens it at once,
    so the answer is worked out at most once every CACHE_SECONDS and shared. When a check cannot be made, it says
    so rather than reporting 'fine'.

The platform team's own note lives in platform_settings['status_notice']: a state, a sentence, and when it was last
touched. It is what turns "something is wrong" into "they know, they are on it", which is what stops the phone
ringing. It overrides a green check, never the other way round: if the checks see a problem, the page says so even
while the note says all is well."""
import json
import threading
import time

from backend.database import db as D
from backend.extensions import monitor
from backend.modules.platform import repository
from backend.utils.dates import now
from backend.utils.validation import require

NOTICE_KEY = 'status_notice'
# 'ok' is not offered as a notice state: a note saying everything is fine is what the checks are for.
NOTICE_STATES = ('watching','partial','down','maintenance')
NOTICE_MAX = 500
CACHE_SECONDS = 15
# How each state ranks, worst first, when the overall state is worked out.
RANK = {'down':0,'partial':1,'unknown':2,'starting':3,'ok':4}

STATE_LABELS = {'ok':'ปกติ','partial':'ใช้งานได้บางส่วน','down':'ขัดข้อง','unknown':'ตรวจสอบไม่ได้',
                'starting':'กำลังเริ่ม','watching':'กำลังตรวจสอบ','maintenance':'ปิดปรับปรุงตามแผน'}

_lock = threading.Lock()
_cached = {'at':0.0,'value':None}


def _worst(states):
    return min(states,key=lambda s:RANK.get(s,2)) if states else 'unknown'


def _api():
    """This answer is itself the proof that the web app reaches the API; what is worth saying is how long it has
    been up and whether it has been answering with errors."""
    snap = monitor.snapshot()
    recent = snap.get('server_errors') or 0
    requests = snap.get('requests') or 0
    # Errors on more than one request in twenty, over a meaningful number of requests, is not a one-off.
    bad = requests>=100 and recent/requests>0.05
    return {'key':'api','name':'เว็บและระบบหลัก',
            'state':'partial' if bad else 'ok',
            'detail':'ระบบตอบกลับผิดพลาดบ่อยกว่าปกติ' if bad else 'ตอบสนองตามปกติ',
            'since':snap.get('started_at')}


def _workers():
    """The work that happens without anybody watching: sending replies out to LINE / Email / Facebook, the customers'
    notification emails, AI jobs, and the escalation of cases past their SLA. When these stop, screens look fine and
    nothing leaves the building, which is exactly the case people cannot tell apart from a problem of their own."""
    snap = monitor.snapshot()
    workers = snap.get('workers') or []
    starting = [w for w in workers if w.get('starting')]
    stopped = [w for w in workers if not w.get('running')]
    if stopped:
        return {'key':'workers','name':'งานเบื้องหลัง','state':'partial',
                'detail':'บางงานหยุดทำงาน ข้อความที่รอส่งออกและการแจ้งเตือนอาจล่าช้า','since':None}
    if starting:
        # The server has just been restarted and these have not had time to report in yet. Saying "cannot tell" here
        # would read as a fault; it is a normal minute after a restart.
        return {'key':'workers','name':'งานเบื้องหลัง','state':'starting','detail':'เพิ่งเริ่มระบบใหม่ กำลังเริ่มงานเบื้องหลัง','since':None}
    return {'key':'workers','name':'งานเบื้องหลัง','state':'ok','detail':'ส่งข้อความและแจ้งเตือนได้ตามปกติ','since':None}


def _storage():
    """A disk with no room left stops every organization from writing at once - the one failure that really is
    everybody's at the same time."""
    import shutil
    try:
        disk = shutil.disk_usage(D.DATA)
    except OSError:
        return {'key':'storage','name':'พื้นที่จัดเก็บ','state':'unknown','detail':'ตรวจสอบพื้นที่ดิสก์ไม่ได้','since':None}
    free = disk.free/disk.total if disk.total else 0
    if free<0.03:
        return {'key':'storage','name':'พื้นที่จัดเก็บ','state':'down','detail':'พื้นที่ดิสก์เกือบเต็ม ระบบอาจบันทึกข้อมูลไม่ได้','since':None}
    if free<0.1:
        return {'key':'storage','name':'พื้นที่จัดเก็บ','state':'partial','detail':'พื้นที่ดิสก์เหลือน้อย','since':None}
    return {'key':'storage','name':'พื้นที่จัดเก็บ','state':'ok','detail':'มีพื้นที่เพียงพอ','since':None}


def _mail(cd):
    """The platform's own mailbox: sign-up confirmations, password resets and the emails customers get when a team
    answers. An organization cannot tell from its own screen whether this works."""
    from backend.modules.platform import service
    ready = service.registration_ready(cd)
    return {'key':'mail','name':'อีเมลของระบบ','state':'ok' if ready else 'partial',
            'detail':'ส่งอีเมลได้ตามปกติ' if ready else 'ระบบยังส่งอีเมลไม่ได้ อีเมลยืนยันและลิงก์ลืมรหัสผ่านจะไม่ถูกส่ง','since':None}


def notice(cd):
    """What the platform team has written about an incident, or None."""
    try:
        found = json.loads(repository.setting(cd,NOTICE_KEY) or 'null')
    except ValueError:
        return None
    return found if isinstance(found,dict) and found.get('text') else None


def _build(cd):
    parts = [_api(),_workers(),_storage(),_mail(cd)]
    written = notice(cd)
    states = [p['state'] for p in parts]
    if written:
        states.append({'watching':'partial','partial':'partial','down':'down','maintenance':'partial'}.get(written['state'],'partial'))
    return {'state':_worst(states),'components':parts,'notice':written,'checked_at':now(),
            'labels':STATE_LABELS}


def public_status(cd):
    """The page's answer, worked out at most once every CACHE_SECONDS: everyone opens this at the same moment, and
    the moment they do is the moment the system can least afford the work."""
    moment = time.time()
    with _lock:
        if _cached['value'] and moment-_cached['at']<CACHE_SECONDS:
            return _cached['value']
    value = _build(cd)
    with _lock:
        _cached.update(at=moment,value=value)
    return value


def save_notice(cd, session, body):
    """The platform team says what is going on. Writing one is what turns a room full of people guessing into a room
    full of people waiting."""
    state,text = body.get('state'),body.get('text','')
    require(state in NOTICE_STATES,'สถานะไม่ถูกต้อง')
    require(isinstance(text,str) and 1<=len(text.strip())<=NOTICE_MAX,f'ข้อความต้องมี 1-{NOTICE_MAX} ตัวอักษร')
    written = {'state':state,'text':text.strip(),'updated_at':now(),'updated_by':session['name']}
    repository.save_setting(cd,NOTICE_KEY,json.dumps(written,ensure_ascii=False))
    cd.commit()
    _forget()
    return written


def clear_notice(cd, session):
    repository.save_setting(cd,NOTICE_KEY,'')
    cd.commit()
    _forget()


def _forget():
    with _lock:
        _cached.update(at=0.0,value=None)
