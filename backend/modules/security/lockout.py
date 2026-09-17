"""Progressive lockout after repeated wrong sign-in secrets (password, and for customers the two-factor code, a recovery
code or a refused passkey), counted per typed email - 'signin:<email>' (the shared sign-in page), 'staff:<email>' or
'customer:<email>' - whether or not an account exists, so the answers never tell which emails are registered. A lock
on one of an email's keys refuses the others too (related_keys).

5 failures inside 15 minutes lock the key: level 1 for 5 minutes, 2 for 15 minutes, 3 for an hour, 4 and above for
24 hours. The level drops by one for every 24 hours without a new lock. While locked every attempt, right or wrong, is
answered 429 with retry_after and is not counted (the lock is not extended). A successful sign-in clears the count
(not the level); a completed password reset or a Superadmin clears the lock too.

Each call works in its own short transaction on the control database: callers must not hold a write transaction on
another control connection at that moment."""
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
import datetime as dt
import ipaddress
import math
import sys
import threading

from backend.database import db as D
from backend.exceptions.errors import APIError
from backend.modules.security import events, model, repository
from backend.modules.security.events import parse
from backend.utils.dates import iso, now, utc_now


def key_for(actor, email):
    return f"{actor}:{(email or '').strip().lower()}"


def split_key(key):
    actor,_,subject = key.partition(':')
    return actor,subject


def related_keys(key):
    """The other password locks of the same typed email: 'signin:' (the shared sign-in page, POST /api/sign-in),
    'staff:' (POST /api/login) and 'customer:' (POST /api/customer/login, the second step, passkeys). Each counts its
    own failures, but a lock on any of them refuses the others too, so switching endpoints never buys more guesses."""
    actor,subject = split_key(key)
    if actor not in model.SIGN_IN_KEYS:
        return ()
    return tuple(key_for(other,subject) for other in model.SIGN_IN_KEYS if other!=actor)


def lock_seconds(level):
    return model.LOCK_SECONDS.get(level,model.LOCK_MAX_SECONDS)


def effective_level(row, moment=None):
    """The stored level less one for every full 24 hours since the last lock started."""
    if not row or not row['level']:
        return 0
    started = parse(row['locked_at'])
    if not started:
        return row['level']
    elapsed = ((moment or utc_now())-started).total_seconds()
    return max(0,row['level']-int(elapsed//model.LEVEL_DECAY_SECONDS))


def remaining_seconds(row, moment=None):
    """Seconds left of the lock, 0 when not locked."""
    until = parse(row['locked_until']) if row else None
    if not until:
        return 0
    left = (until-(moment or utc_now())).total_seconds()
    return math.ceil(left) if left>0 else 0


def locked_error(seconds):
    minutes = max(1,math.ceil(seconds/60))
    return APIError(429,model.LOCK_MESSAGE.format(minutes=minutes),extra={'retry_after':seconds},
                    headers={'Retry-After':str(seconds)})


def refuse_trapped(key, message, password, hashes=1):
    """A sign-in whose hidden form field was filled (security.traps): answered like a wrong password - 429 while the
    email is locked, else 401 after the same password work - but never counted towards the lock, so a bot cannot lock
    real users out through the trap."""
    from backend.utils.security import password_ok
    with D.control() as cd:
        left = max(remaining_seconds(repository.failure(cd,k)) for k in (key,*related_keys(key)))
    if left:
        raise locked_error(left)
    for _ in range(hashes):
        password_ok(password,DUMMY_PASSWORD_HASH)
    raise APIError(401,message)


# The shape of a real password hash, so a trapped sign-in takes as long as a wrong password.
DUMMY_PASSWORD_HASH = 'pbkdf2_sha256$600000$'+'00'*16+'$'+'00'*32


def check(key, client=None, actor=None, tenant_id=None):
    """Raise the 429 while the key, or one of its related keys (related_keys), is locked; retry_after is the longest
    wait. The refused attempt is recorded once as a failed sign-in (it is not counted towards the lock)."""
    with D.control() as cd:
        left = max(remaining_seconds(repository.failure(cd,k)) for k in (key,*related_keys(key)))
    if left:
        kind_actor,subject = split_key(key)
        client = client or {}
        events.record('login_failed',actor=actor or kind_actor,subject=subject,tenant_id=tenant_id,ip=client.get('ip',''),
                      user_agent=client.get('user_agent',''),detail={'reason':'locked'})
        raise locked_error(left)


def fail(key, client=None, actor=None, kind='login_failed', owner=None, detail=None):
    """Count one wrong secret and record `kind`. owner: {'email','name'} of the account the typed email belongs to (or
    None) - or a list of them, each with its 'actor' ('staff' / 'platform' / 'customer'), when the key guards more than
    one account (the shared sign-in page) - told by email about a new lock when the platform mailbox is ready (at most
    once per 24 hours per key). Returns the lock length in seconds when this failure locked the key, else 0."""
    client = client or {}
    ip = client.get('ip','')
    kind_actor,subject = split_key(key)
    actor = actor or kind_actor
    owners = [o for o in (owner if isinstance(owner,list) else [owner]) if o]
    events.record(kind,actor=actor,subject=subject,ip=ip,user_agent=client.get('user_agent',''),detail=detail)
    moment = utc_now()
    locked,level,mail = 0,0,None
    with D.control() as cd:
        D.begin(cd)
        row = repository.failure(cd,key)
        if remaining_seconds(row,moment):
            # Another request locked it a moment ago: nothing more to count.
            return 0
        started = parse(row['window_start']) if row else None
        in_window = row and started and (moment-started).total_seconds()<model.LOCK_WINDOW_SECONDS
        failures = row['failures']+1 if in_window else 1
        if failures>=model.LOCK_FAILURES:
            level = effective_level(row,moment)+1
            locked = lock_seconds(level)
            notified = row['notified_at'] if row else None
            last = parse(notified)
            if owners and (not last or (moment-last).total_seconds()>=model.LOCK_MAIL_SECONDS) and _mailbox_ready(cd):
                notified,mail = now(),owners
            repository.save_lock(cd,key,level,iso(moment),iso(moment+dt.timedelta(seconds=locked)),ip,notified)
        else:
            repository.save_failures(cd,key,failures,row['window_start'] if in_window else iso(moment),ip)
        cd.commit()
    if locked:
        events.record('login_locked',actor=actor,subject=subject,ip=ip,user_agent=client.get('user_agent',''),
                      detail={'level':level,'minutes':locked//60})
    if mail:
        threading.Thread(target=_mail_owner,args=(actor,mail,ip,moment),name='bookdose-lock-mail',daemon=True).start()
    return locked


def succeed(key, client=None, actor=None, tenant_id=None):
    """A sign-in passed: the count is cleared (the level stays). The first sign-in after a lock is recorded."""
    with D.control() as cd:
        row = repository.failure(cd,key)
        if not row or (not row['failures'] and not row['locked_until']):
            return
        after_lock = bool(row['locked_until'])
        repository.clear_failures(cd,key)
        cd.commit()
    if after_lock:
        client = client or {}
        kind_actor,subject = split_key(key)
        events.record('login_after_lock',actor=actor or kind_actor,subject=subject,tenant_id=tenant_id,ip=client.get('ip',''),
                      user_agent=client.get('user_agent',''),detail={'level':row['level']})


def clear(key, related=False):
    """A completed password reset or a Superadmin: no count and no lock (with related=True also on the related keys of
    the same email). True when one of them was locked."""
    was_locked = False
    with D.control() as cd:
        for each in (key,*(related_keys(key) if related else ())):
            row = repository.failure(cd,each)
            if not row:
                continue
            was_locked = bool(remaining_seconds(row)) or was_locked
            repository.clear_failures(cd,each)
        cd.commit()
    return was_locked


def mask_ip(ip):
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return 'ไม่ทราบ'
    if address.version==4:
        return '.'.join(str(address).split('.')[:3])+'.xxx'
    return ':'.join(address.exploded.split(':')[:3])+':…'


def _mailbox_ready(cd):
    from backend.modules.platform import service as platform
    try:
        return platform.registration_ready(cd)
    except Exception:
        return False


CUSTOMER_HOW = 'กด “ลืมรหัสผ่าน” ในหน้าเข้าสู่ระบบเพื่อตั้งรหัสผ่านใหม่ การตั้งรหัสผ่านใหม่จะปลดล็อกบัญชีทันที'
STAFF_HOW = 'หากไม่ใช่คุณ เมื่อเข้าสู่ระบบได้แล้วให้เปลี่ยนรหัสผ่านทันที หรือติดต่อผู้ดูแลระบบเพื่อปลดล็อก'


def _mail_owner(actor, owners, ip, moment):
    """The owners of a locked account are told once (never the password or where the attempts came from in full): one
    email per address, with what to do for each kind of account it has (a customer and a staff account may share it)."""
    from backend.extensions import channel_transport as T
    from backend.modules.platform import service as platform
    try:
        with D.control() as cd:
            cfg = platform.registration_config(cd)
        secret = platform.registration_secret()
        base = cfg.get('public_base_url','')
        addresses = {}
        for owner in owners:
            kind = 'customer' if owner.get('actor',actor)=='customer' else 'staff'
            addresses.setdefault(owner['email'],[])
            if kind not in addresses[owner['email']]:
                addresses[owner['email']].append(kind)
        for address,kinds in addresses.items():
            if len(kinds)==1:
                how = CUSTOMER_HOW if kinds[0]=='customer' else STAFF_HOW
            else:
                how = '\n'.join(f"{'บัญชีลูกค้า' if k=='customer' else 'บัญชีทีมงาน'}: {CUSTOMER_HOW if k=='customer' else STAFF_HOW}" for k in kinds)
            mail = EmailMessage()
            mail['Subject'] = 'มีการพยายามเข้าสู่ระบบบัญชีของคุณ'
            mail['From'],mail['To'] = cfg['address'],address
            mail['Date'],mail['Message-ID'],mail['Auto-Submitted'] = formatdate(localtime=False,usegmt=True),make_msgid(),'auto-generated'
            mail.set_content(f"มีการพยายามเข้าสู่ระบบบัญชีของคุณด้วยรหัสผ่านที่ไม่ถูกต้องหลายครั้ง ระบบจึงล็อกการเข้าสู่ระบบไว้ชั่วคราว\n\n"
                             f"เวลา: {moment.strftime('%Y-%m-%d %H:%M')} (UTC)\nจากเครือข่าย: {mask_ip(ip)}\n\n"
                             f"หากเป็นคุณ รอให้ครบเวลาแล้วลองใหม่\n{how}\n\n{base}/\n")
            T.send_email(cfg,secret,address,mail)
    except Exception as error:
        print(f'[{now()}] Lock notice: {type(error).__name__}',file=sys.stderr,flush=True)
