"""แจ้งเตือนการเข้าสู่ระบบจากที่ใหม่: a platform admin who signs in from a device or a network their account has not
signed in from lately gets an email saying when, on what and from where, with a "ไม่ใช่ฉัน" link that ends that very
session at once and says to choose a new password.

  staff_sign_in_places  where a platform admin has signed in: the address and the kind of device (browser and
                        system, as the device list names it, so a browser update is not a new device), first and last
                        time. A place not used for PLACE_DAYS counts as new again.
  staff_sign_in_alerts  the "ไม่ใช่ฉัน" links (hashed, LINK_DAYS, used once), each naming the session it ends.

An account's first sign-in (no place known yet) is not told: there is nothing to compare it with. Nothing is sent while
the platform's mailbox is not set up, and a mail that fails never stops the sign-in. The link travels after # (the page
reads it and posts it), so a mail scanner that opens links ends nothing.

With the IP database on (ip_intel.py) the mail also says the country and the network, and whether that network rents
out servers (a cloud or a VPN), and two signs are read - never enough on their own to refuse anyone:
- เดินทางเป็นไปไม่ได้: a sign-in from a new place in another country than the sign-in before, less than
  TRAVEL_HOURS after it; its own alert opens in the console. Coming back to a known place afterwards is not flagged
  again: the switch was told with the sign-in that made it.
- the browser's time zone (sent by the page) is not one used in the address's country.
The names of proxy headers the web app saw on the request go into the security event, not the mail: some networks
add them to every request. Every sign-in told (and one that would be, while the mailbox is not set up) is a
'sign_in_new_place' event in the console."""
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
import secrets
import sys
import threading

from backend.database import audit, db as D
from backend.database.db import one, rows
from backend.utils.dates import after, now
from backend.utils.security import token_hash
from backend.utils.validation import require

PLACE_DAYS = 90
LINK_DAYS = 7
TRAVEL_HOURS = 2
SIGN_IN_ACTIONS = ('login','login_2fa','login_recovery','login_passkey')
BACKFILLED = 'sign_in_places_backfilled'
GONE = 'ลิงก์นี้หมดอายุหรือใช้ไปแล้ว หากยังสงสัยว่ามีคนเข้าบัญชีของคุณ ให้ตั้งรหัสผ่านใหม่ทันที'

TABLES = '''
CREATE TABLE IF NOT EXISTS staff_sign_in_places (
    user_id TEXT NOT NULL, ip TEXT NOT NULL, device TEXT NOT NULL, first_at TEXT NOT NULL, last_at TEXT NOT NULL,
    PRIMARY KEY(user_id,ip,device)
);
CREATE TABLE IF NOT EXISTS staff_sign_in_alerts (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '',
    device TEXT NOT NULL DEFAULT '', signed_in_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
);
'''


def _device(user_agent):
    from backend.modules.customer_security.schema import device_name
    return device_name(user_agent or '')


def upgrade(cd):
    """The tables, and once: the places platform admins already signed in from (their account history), so the first
    sign-in after this is compared with something."""
    cd.executescript(TABLES)
    # The country of each place (ip_intel), for a sign-in from another country too soon after.
    if 'country' not in {row[1] for row in cd.execute('PRAGMA table_info(staff_sign_in_places)')}:
        cd.execute("ALTER TABLE staff_sign_in_places ADD COLUMN country TEXT NOT NULL DEFAULT ''")
    if one(cd,'SELECT 1 FROM platform_settings WHERE key=?',(BACKFILLED,)):
        return
    for row in rows(cd,f'''SELECT a.user_id,a.ip,a.user_agent,MIN(a.created_at) AS first_at,MAX(a.created_at) AS last_at
                          FROM staff_activity a JOIN users u ON u.id=a.user_id WHERE u.platform_admin=1 AND a.ip<>''
                          AND a.action IN ({','.join('?'*len(SIGN_IN_ACTIONS))}) AND a.created_at>=?
                          GROUP BY a.user_id,a.ip,a.user_agent''',(*SIGN_IN_ACTIONS,after(days=-PLACE_DAYS))):
        cd.execute('''INSERT INTO staff_sign_in_places(user_id,ip,device,first_at,last_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,ip,device)
                      DO UPDATE SET first_at=min(first_at,excluded.first_at),last_at=max(last_at,excluded.last_at)''',
                   (row['user_id'],row['ip'],_device(row['user_agent']),row['first_at'],row['last_at']))
    cd.execute('INSERT OR IGNORE INTO platform_settings VALUES(?,?)',(BACKFILLED,'1'))


def noticed(cd, user_id, session_id, client):
    """A session was just made for user_id (auth.service, inside the sign-in's transaction): the place is remembered,
    and the mail to send once that transaction is committed comes back when a platform admin signed in from a new
    device or network (else None)."""
    user = one(cd,'SELECT id,name,email,platform_admin FROM users WHERE id=?',(user_id,))
    if not user or not user['platform_admin']:
        return None
    import json
    from backend.modules.security import ip_intel, repository
    client = client or {}
    ip,device,moment = client.get('ip',''),_device(client.get('user_agent','')),now()
    info = ip_intel.lookup(ip) or {}
    country = info.get('country','')
    known = rows(cd,'SELECT ip,device FROM staff_sign_in_places WHERE user_id=? AND last_at>=?',(user_id,after(days=-PLACE_DAYS)))
    before = one(cd,"SELECT country,last_at FROM staff_sign_in_places WHERE user_id=? AND country<>'' ORDER BY last_at DESC LIMIT 1",(user_id,))
    cd.execute('''INSERT INTO staff_sign_in_places(user_id,ip,device,first_at,last_at,country) VALUES(?,?,?,?,?,?)
                  ON CONFLICT(user_id,ip,device) DO UPDATE SET last_at=excluded.last_at,country=excluded.country''',
               (user_id,ip,device,moment,moment,country))
    new_device,new_ip = device not in {r['device'] for r in known},ip not in {r['ip'] for r in known}
    fresh = bool(known) and (new_device or new_ip)
    travel = bool(fresh and country and before and before['country']!=country and before['last_at']>=after(hours=-TRAVEL_HOURS))
    zone = client.get('timezone','')
    zones = ip_intel.zone_countries(zone)
    detail = {'account':user['email'],'device':device,'country':country,'network':info.get('org',''),'asn':info.get('asn'),
              'hosting':bool(info.get('hosting')),'new_device':new_device,'new_ip':new_ip,'impossible_travel':travel,
              'previous_country':before['country'] if travel else '','timezone':zone,
              'timezone_mismatch':bool(country and zones and country not in zones),'proxy':client.get('proxy','')}
    if not fresh:
        return None
    if travel:
        repository.insert_alert(cd,'impossible_travel','warning',1,ip,json.dumps(detail,ensure_ascii=False))
    job = {'email':user['email'],'name':user['name'],'token':None,'ip':ip,'device':device,'at':moment,'detail':detail}
    from backend.modules.platform import service as platform
    try:
        ready = platform.registration_ready(cd)
    except Exception:
        ready = False
    if ready:
        job['token'] = secrets.token_urlsafe(32)
        cd.execute('INSERT INTO staff_sign_in_alerts(token_hash,user_id,session_id,ip,device,signed_in_at,expires_at) VALUES(?,?,?,?,?,?,?)',
                   (token_hash(job['token']),user_id,session_id,ip,device,moment,after(days=LINK_DAYS)))
        cd.execute('DELETE FROM staff_sign_in_alerts WHERE expires_at<=?',(moment,))
    return job


def start(job):
    """After the sign-in's transaction: the console's event, then the mail of noticed() on its own thread, so the
    sign-in never waits for the mail server."""
    if not job:
        return
    from backend.modules.security import events
    detail = job['detail']
    events.record('sign_in_new_place',severity='warning' if detail['impossible_travel'] else 'info',actor='platform',
                  subject=job['email'],ip=job['ip'],detail=detail)
    if job['token']:
        _deliver(job)


def _deliver(job):
    threading.Thread(target=send,args=(job,),name='bookdose-sign-in-mail',daemon=True).start()


def _what(detail):
    if detail['new_device'] and detail['new_ip']:
        return 'อุปกรณ์และเครือข่ายที่ไม่เคยใช้'
    return 'อุปกรณ์ที่ไม่เคยใช้' if detail['new_device'] else 'เครือข่ายที่ไม่เคยใช้'


def _body(job):
    """The mail's text: what happened, where from, what looks wrong, and the link."""
    from backend.modules.security.ip_intel import country_name
    detail = job['detail']
    travel = detail['impossible_travel']
    opening = (f"มีการเข้าสู่ระบบบัญชีผู้ดูแลแพลตฟอร์มของคุณจาก{country_name(detail['country'])} หลังจากเข้าสู่ระบบจาก"
               f"{country_name(detail['previous_country'])} ไม่ถึง {TRAVEL_HOURS} ชั่วโมง ซึ่งเร็วเกินกว่าจะเดินทางได้จริง"
               if travel else f"มีการเข้าสู่ระบบบัญชีผู้ดูแลแพลตฟอร์มของคุณจาก{_what(detail)}ในช่วง {PLACE_DAYS} วันที่ผ่านมา")
    lines = [f"เวลา: {job['at'][:16].replace('T',' ')} (UTC)",f"อุปกรณ์: {job['device']}",f"IP: {job['ip'] or 'ไม่ทราบ'}"]
    if detail['country']:
        lines.append(f"ประเทศ: {country_name(detail['country'])}")
    if detail['network']:
        lines.append(f"ผู้ให้บริการเครือข่าย: {detail['network']}"+(' (เครือข่ายของผู้ให้บริการคลาวด์หรือ VPN)' if detail['hosting'] else ''))
    notes = []
    if detail['timezone_mismatch']:
        notes.append(f"เขตเวลาของเบราว์เซอร์ ({detail['timezone']}) ไม่ตรงกับประเทศของ IP")
    if detail['hosting'] and not travel:
        notes.append('เข้าผ่านเครือข่ายคลาวด์หรือ VPN ซึ่งมักใช้ปิดบังที่อยู่จริง')
    text = f"เรียนคุณ{job['name']}\n\n{opening}\n\n"+'\n'.join(lines)+'\n\n'
    if notes:
        text += 'ข้อสังเกต\n'+'\n'.join(f'- {note}' for note in notes)+'\n\n'
    return text


def send(job):
    from backend.extensions import channel_transport as T
    from backend.modules.platform import service as platform
    try:
        with D.control() as cd:
            cfg = platform.registration_config(cd)
        link = f"{(cfg.get('public_base_url') or '').rstrip('/')}/not-me#t={job['token']}"
        mail = EmailMessage()
        mail['Subject'] = ('พบการเข้าสู่ระบบบัญชีผู้ดูแลแพลตฟอร์มของคุณที่น่าสงสัย' if job['detail']['impossible_travel']
                           else 'มีการเข้าสู่ระบบบัญชีผู้ดูแลแพลตฟอร์มของคุณจากที่ใหม่')
        mail['From'],mail['To'] = cfg['address'],job['email']
        mail['Date'],mail['Message-ID'],mail['Auto-Submitted'] = formatdate(localtime=False,usegmt=True),make_msgid(),'auto-generated'
        mail.set_content(_body(job)+'หากเป็นคุณ ไม่ต้องดำเนินการใด\n\n'
                         'หากไม่ใช่คุณ กรุณาเปิดลิงก์ด้านล่างเพื่อยุติการเข้าสู่ระบบครั้งนี้ทันที แล้วตั้งรหัสผ่านใหม่\n'
                         f"{link}\n\nลิงก์นี้ใช้ได้ {LINK_DAYS} วัน และใช้ได้ครั้งเดียว\n")
        T.send_email(cfg,platform.registration_secret(),job['email'],mail)
    except Exception as error:
        print(f'[{now()}] Sign-in notice: {type(error).__name__}',file=sys.stderr,flush=True)


def _alert(cd, body):
    value = body.get('token')
    require(isinstance(value,str) and 20<=len(value)<=100,GONE,410)
    row = one(cd,'SELECT a.*,u.email,u.name FROM staff_sign_in_alerts a JOIN users u ON u.id=a.user_id WHERE a.token_hash=?',(token_hash(value),))
    require(row and not row['used_at'] and row['expires_at']>now(),GONE,410)
    return row


def check(cd, body):
    """POST /api/sign-in-alerts/check: what the link is about, for the page to show before anything is ended."""
    from backend.modules.security import ip_intel
    row = _alert(cd,body)
    active = bool(one(cd,'SELECT 1 FROM sessions WHERE id=? AND user_id=?',(row['session_id'],row['user_id'])))
    info = ip_intel.lookup(row['ip']) or {}
    return {'signed_in_at':row['signed_in_at'],'device':row['device'],'ip':row['ip'],'active':active,
            'country':info.get('country',''),'network':info.get('org',''),'hosting':bool(info.get('hosting'))}


def disown(cd, body, client=None):
    """POST /api/sign-in-alerts/not-me: end the session the link names, forget that place (a sign-in from there is told
    again), and raise the alarm: a critical event, an open alert in the console, and a line in the account's history."""
    import json
    from backend.modules.security import events, repository
    from backend.modules.staff_security import service as staff_security
    client = client or {}
    D.begin(cd)
    row = _alert(cd,body)
    cd.execute('UPDATE staff_sign_in_alerts SET used_at=? WHERE token_hash=?',(now(),row['token_hash']))
    ended = cd.execute('DELETE FROM sessions WHERE id=? AND user_id=?',(row['session_id'],row['user_id'])).rowcount>0
    cd.execute('DELETE FROM staff_sign_in_places WHERE user_id=? AND ip=? AND device=?',(row['user_id'],row['ip'],row['device']))
    staff_security.note(cd,row['user_id'],'sign_in_disowned',f"{row['device']} {row['ip']}".strip(),client=client)
    audit.record(cd,row['user_id'],'account.sign_in_disowned',row['user_id'],row['ip'])
    detail = {'account':row['email'],'device':row['device'],'signed_in_at':row['signed_in_at'],'ended':ended}
    repository.insert_alert(cd,'sign_in_disowned','critical',1,row['ip'],json.dumps(detail,ensure_ascii=False))
    cd.commit()
    # The address is the one the owner disowned (to block it from the console), not the one the link was opened from.
    events.record('sign_in_disowned',severity='critical',actor='platform',subject=row['email'],ip=row['ip'],detail=detail)
    return {'ended':ended}
