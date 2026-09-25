"""เฝ้าช่องทาง: when LINE, email or Facebook stops working for an organization - a token revoked, a mailbox password
changed, a server that no longer answers - its owners hear it at once instead of finding out from a customer who
waited. Checked every minute by the email worker: the mailbox is polled all the time anyway (its last_error), LINE and
Facebook are asked every VERIFY_MINUTES (every RECHECK_MINUTES while something is wrong), and a failed LINE delivery
counts at once. A problem that lasts GRACE_MINUTES is told once, by email to the organization's admins and in their
bell; its end is told once too. The LINE check also reads where LINE sends its webhook, for the setup steps."""
import datetime as dt
import json
import sys
import threading
import time
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from backend.database import db as D
from backend.exceptions.errors import ChannelError, CHANNEL_ERRORS
from backend.extensions import channel_transport as T
from backend.modules.channels import facebook, repository
from backend.utils.dates import now, utc_now

KINDS = ('line','email','facebook')
NAMES = {'line':'LINE','email':'อีเมล','facebook':'Facebook Messenger'}
BROKEN = ('credentials','oauth_expired','network','host')
GRACE_MINUTES = 10
VERIFY_MINUTES = 30
RECHECK_MINUTES = 5
ROUND_SECONDS = 60
TZ = dt.timezone(dt.timedelta(hours=7))

_last_round = {}
_lock = threading.Lock()


def _state(db, kind):
    """(enabled, last error code) of one channel."""
    row = repository.find_facebook_setting(db) if kind=='facebook' else repository.find_setting(db,kind)
    return (bool(row and row['enabled']),(row['last_error'] if row else '') or '')


def _health(db):
    return {r['kind']:dict(r) for r in db.execute('SELECT * FROM channel_health').fetchall()}


def _minutes_since(stamp):
    return (utc_now()-dt.datetime.fromisoformat(stamp)).total_seconds()/60 if stamp else None


def webhook(db):
    """Where LINE says it sends events ({'endpoint','active'}), as of the last check, or {}."""
    row = db.execute("SELECT webhook FROM channel_health WHERE kind='line'").fetchone()
    try:
        return json.loads(row[0]) if row and row[0] else {}
    except ValueError:
        return {}


def save_webhook(db, hook):
    db.execute("INSERT INTO channel_health(kind,webhook) VALUES('line',?) ON CONFLICT(kind) DO UPDATE SET webhook=excluded.webhook",(json.dumps(hook),))


def alerts(db):
    """What the admins' bell shows: the channels told as not working and still not working."""
    found = []
    for row in _health(db).values():
        if row['told_at'] and row['broken_since']:
            found.append({'kind':row['kind'],'name':NAMES.get(row['kind'],row['kind']),'since':row['broken_since'],
                          'error':CHANNEL_ERRORS.get(row['error'],CHANNEL_ERRORS['network'])})
    return found


def due(tenant_id):
    """At most one round a minute per organization (the worker comes every two seconds)."""
    with _lock:
        moment = time.monotonic()
        if moment-_last_round.get(tenant_id,0)<ROUND_SECONDS:
            return False
        _last_round[tenant_id] = moment
        return True


def run(tenant_id):
    """One round for one organization: ask LINE and Facebook when it is time, then tell what started or ended.
    Returns the (kind, 'broken' | 'recovered') told."""
    with D.tenant(tenant_id) as db:
        health = _health(db)
        ask = []
        for kind in ('line','facebook'):
            enabled,error = _state(db,kind)
            last = _minutes_since((health.get(kind) or {}).get('verified_at'))
            every = RECHECK_MINUTES if error in BROKEN else VERIFY_MINUTES
            if enabled and (last is None or last>=every):
                ask.append(kind)
        secrets = {kind:(repository.read_secret(tenant_id,kind) if kind=='line' else facebook.read_secret(tenant_id)) for kind in ask}
    results = {}
    for kind in ask:
        # Outside any transaction: these are calls to LINE / Facebook.
        try:
            if kind=='line':
                T.verify_line(secrets[kind])
                results[kind] = ('',_line_webhook(secrets[kind]))
            else:
                T.verify_facebook(secrets[kind].get('page_access_token',''))
                results[kind] = ('',None)
        except ChannelError as error:
            # A moment's hiccup at LINE / Facebook is not a broken channel; a refused token or no answer is.
            results[kind] = (error.code if error.code in BROKEN else '',None)
        except Exception:
            results[kind] = ('network',None)
    told = []
    with D.control() as cd, D.tenant(tenant_id) as db:
        D.begin(db)
        for kind,(error,hook) in results.items():
            if kind=='line':
                repository.set_check_result(db,'line',error)
            else:
                repository.set_facebook_check(db,error)
            db.execute('INSERT INTO channel_health(kind,verified_at) VALUES(?,?) ON CONFLICT(kind) DO UPDATE SET verified_at=excluded.verified_at',(kind,now()))
            if hook is not None:
                save_webhook(db,hook)
        health = _health(db)
        for kind in KINDS:
            enabled,error = _state(db,kind)
            row = health.get(kind)
            broken = enabled and error in BROKEN
            if broken and not (row and row['broken_since']):
                db.execute('INSERT INTO channel_health(kind,broken_since,error) VALUES(?,?,?) ON CONFLICT(kind) DO UPDATE SET broken_since=excluded.broken_since,error=excluded.error,told_at=NULL',(kind,now(),error))
            elif broken and not row['told_at'] and _minutes_since(row['broken_since'])>=GRACE_MINUTES:
                db.execute('UPDATE channel_health SET told_at=?,error=? WHERE kind=?',(now(),error,kind))
                told.append((kind,'broken',row['broken_since'],error))
            elif not broken and row and row['broken_since']:
                if row['told_at'] and enabled:
                    told.append((kind,'recovered',row['broken_since'],row['error']))
                db.execute("UPDATE channel_health SET broken_since=NULL,told_at=NULL,error='' WHERE kind=?",(kind,))
        db.commit()
        if not told:
            return []
        from backend.modules.organization import repository as organization
        from backend.modules.platform import repository as platform_repository, service as platform
        org = platform_repository.tenant_summary(cd,tenant_id) or {}
        admins = organization.organization_admins(cd,tenant_id)
        mail = (platform.registration_config(cd),platform.registration_secret()) if platform.registration_ready(cd) else None
    if mail:
        for kind,change,since,error in told:
            for admin in admins:
                _send(mail,admin,org.get('name',''),kind,change,since,error)
    return [(kind,change) for kind,change,_,_ in told]


def _line_webhook(secret):
    try:
        return T.line_webhook_info(secret)
    except ChannelError:
        return None


def clock(stamp):
    """"10:32 น." today, "25 ก.ย. 10:32 น." another day (Thai time)."""
    local = dt.datetime.fromisoformat(stamp).astimezone(TZ)
    months = ('ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.')
    day = '' if local.date()==utc_now().astimezone(TZ).date() else f'{local.day} {months[local.month-1]} '
    return f'{day}{local:%H:%M} น.'


def _send(mail, admin, organization, kind, change, since, error):
    cfg,secret = mail
    name = NAMES[kind]
    link = f"{cfg.get('public_base_url','').rstrip('/')}/settings?tab={kind}"
    if change=='broken':
        subject = f'{name} ของ {organization} รับส่งข้อความไม่ได้'
        text = (f'สวัสดีคุณ{admin["name"]}\n\nตั้งแต่ {clock(since)} ระบบรับหรือส่งข้อความทาง {name} ขององค์กร {organization} ไม่ได้\n'
                f'สาเหตุ: {CHANNEL_ERRORS.get(error,CHANNEL_ERRORS["network"])}\n\n'
                f'แก้ได้ที่ ตั้งค่าองค์กร → LINE / Email / Facebook → {name}\n{link}\n\n'
                'เมื่อกลับมาใช้ได้ ระบบจะแจ้งอีกครั้ง อีเมลนี้ส่งถึงเจ้าขององค์กรทุกคน\n')
    else:
        subject = f'{name} ของ {organization} กลับมาใช้ได้แล้ว'
        text = (f'สวัสดีคุณ{admin["name"]}\n\n{name} ขององค์กร {organization} กลับมารับส่งข้อความได้แล้ว '
                f'(ใช้ไม่ได้ตั้งแต่ {clock(since)})\n\nลองดูข้อความที่ลูกค้าส่งมาในช่วงนั้นในกล่องข้อความ\n')
    try:
        message = EmailMessage()
        message['Subject'],message['From'],message['To'] = subject,cfg['address'],admin['email']
        message['Date'],message['Message-ID'],message['Auto-Submitted'] = formatdate(localtime=False,usegmt=True),make_msgid(),'auto-generated'
        message.set_content(text)
        T.send_email(cfg,secret,admin['email'],message)
    except Exception as failure:
        print(f'[{now()}] Channel alert mail: {type(failure).__name__}',file=sys.stderr,flush=True)
