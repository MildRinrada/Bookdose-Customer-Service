"""Honeypots and honeytokens (docs/security/monitoring-and-traps.md): traps no real user ever touches, so touching one says a scanner,
a bot or an insider is at work. A trap never changes the answer: the request goes on exactly as it would have.

  Decoy paths      DECOY_API_PATHS / DECOY_PAGE_PATHS and the Superadmin's custom API paths. dispatch() notes a hit
                   (inspect_request) and routes the request as usual, so the answer is whatever an unknown path gets.
                   The Next.js app reports its decoy pages and /files/<token> links through POST /api/trap
                   (trusted_report / handle_report). A hit is the event 'honeypot_path'; enough hits from one address
                   in the window block it for a while (settings honeypot.block_on_path_hits).
  Hidden fields    the forms' hidden text box ('website', or 'company_website'): filled means the request is refused
                   with the answer a normal failure gets, and the event 'honeypot_form' (form_trapped / record_form).
  Honeytokens      decoy account emails, API keys, passwords and shared-file links a Superadmin planted. Checked in
                   memory: the enabled tokens' emails and lookup prefixes are loaded once (again after a change, or
                   every TRAP_CACHE_SECONDS), and a value is hashed only when its prefix is known. API keys are
                   searched for in Authorization, X-API-Key, the cookies and the query string (inspect_request) and
                   in JSON bodies up to 1 MB (inspect_body); decoy emails on sign-in, password reset, registration
                   and invitations; passwords on the sign-in endpoints. A trigger is a critical event, an alert, an
                   email to the platform admins (once per token per hour) and a block of the address.

Hits are written by one background thread (report / flush), so a trapped request takes no longer than any other.
Loopback addresses and the address of a signed-in platform admin are never blocked."""
import hashlib
import hmac
from http import cookies
import ipaddress
import json
import queue
import re
import sys
import threading
import time
from urllib.parse import unquote

from backend.database import db as D
from backend.modules.security import events, model
from backend.utils.dates import after, now

API_KEY = re.compile(model.API_KEY_MARKER+r'[A-Za-z0-9]{40}')
API_KEY_BYTES = re.compile(model.API_KEY_MARKER.encode()+rb'[A-Za-z0-9]{40}')
MARKER_BYTES = model.API_KEY_MARKER.encode()
# Where a decoy account email counts (POST), and where a password does.
EMAIL_PATHS = {'/api/login':'sign_in','/api/sign-in':'sign_in','/api/customer/login':'sign_in',
               '/api/customer/forgot':'password_reset','/api/register':'registration','/api/register/resend':'registration',
               '/api/customer/register':'registration','/api/customer/resend':'registration',
               '/api/members':'invite','/api/platform/admins':'invite','/api/platform/tenants':'invite'}
SIGN_IN_PATHS = ('/api/login','/api/sign-in','/api/customer/login')


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


# What the traps are right now (in memory)
class State:
    """The honeypot settings and enabled honeytokens of one data folder."""

    def __init__(self, settings=None, tokens=()):
        settings = settings or model.DEFAULT_SETTINGS['honeypot']
        self.settings = settings
        self.paths_enabled = settings['paths_enabled']
        self.forms_enabled = settings['forms_enabled']
        exact = set(model.DECOY_API_PATHS)|set(model.DECOY_PAGE_PATHS)|set(model.DECOY_PAGE_PREFIXES)
        prefixes = [p+'/' for p in model.DECOY_PAGE_PREFIXES]
        for item in settings['custom_api_paths']:
            exact.add(item['path'])
            if item['match']=='prefix':
                prefixes.append(item['path']+'/')
        self.exact,self.prefixes = frozenset(exact),tuple(prefixes)
        self.emails,self.secrets = {},{}
        kinds = set()
        for token in tokens:
            kinds.add(token['kind'])
            if token['kind']=='decoy_account':
                self.emails[token['decoy_email']] = token
            else:
                self.secrets.setdefault(token['lookup_prefix'],[]).append(token)
        self.api_keys,self.passwords,self.links = 'api_key' in kinds,'password' in kinds,'link' in kinds

    def secret(self, value, kind):
        """The enabled token of this kind whose secret is exactly value, or None (hashes only on a prefix match)."""
        candidates = self.secrets.get(value[:model.LOOKUP_PREFIX_LENGTH])
        if not candidates:
            return None
        hashed = digest(value)
        return next((t for t in candidates if t['kind']==kind and hmac.compare_digest(t['secret_hash'],hashed)),None)


_lock = threading.Lock()
_cache = {'data':None,'loaded':0.0,'state':None}
EMPTY = State()


def invalidate():
    with _lock:
        _cache['loaded'] = 0.0


def state():
    """The current State; read again after invalidate() or every TRAP_CACHE_SECONDS. Never raises: when the database
    cannot be read the last known state (or the defaults) is used."""
    cached = _cache['state']
    if cached is not None and _cache['data'] is D.DATA and time.monotonic()-_cache['loaded']<model.TRAP_CACHE_SECONDS:
        return cached
    from backend.modules.security import repository, sessions
    data = D.DATA
    try:
        with D.control() as cd:
            fresh = State(sessions.settings(cd)['honeypot'],repository.enabled_honeytokens(cd))
    except Exception as error:
        print(f'[{now()}] Traps: {type(error).__name__}',file=sys.stderr,flush=True)
        return cached if cached is not None and _cache['data'] is data else EMPTY
    with _lock:
        _cache.update(data=data,loaded=time.monotonic(),state=fresh)
    return fresh


def normal_path(path):
    """A path as the decoy lists are written: lower case, without a trailing slash."""
    path = path.lower()
    return path.rstrip('/') or '/' if len(path)>1 else path


def decoy_path(current, path):
    if not current.paths_enabled:
        return False
    path = normal_path(path)
    return path in current.exact or path.startswith(current.prefixes)


# Looking at requests (dispatch)
def _add(req, hit):
    found = req.traps if req.traps is not None else []
    if hit not in found:
        found.append(hit)
    req.traps = found


def _api_keys(req, current, text, where):
    for key in set(API_KEY.findall(text)):
        token = current.secret(key,'api_key')
        if token:
            _add(req,{'type':'token','token_id':token['id'],'where':where})


def inspect_request(req, path):
    """Before routing: a decoy path, and planted API keys in the headers, cookies and query string. Only notes what it
    finds (req.traps); report() writes it after the answer."""
    try:
        current = state()
        if decoy_path(current,path):
            _add(req,{'type':'path','path':path[:200],'method':req.command})
        if current.api_keys:
            query = req.path.partition('?')[2]
            for where,value in (('authorization',req.headers.get('Authorization')),('x_api_key',req.headers.get('X-API-Key')),
                                ('cookie',req.headers.get('Cookie')),('query',unquote(query) if '%' in query else query)):
                if value and model.API_KEY_MARKER in value:
                    _api_keys(req,current,value,where)
    except Exception as error:
        print(f'[{now()}] Traps: {type(error).__name__}',file=sys.stderr,flush=True)


def inspect_body(req, path):
    """After the JSON body is read: a decoy account email, a planted password on a sign-in endpoint, a planted API
    key anywhere in the body (bodies up to 1 MB, searched as sent)."""
    try:
        current = state()
        if not (current.emails or current.secrets):
            return
        body = req.body
        if req.command=='POST':
            where = EMAIL_PATHS.get(path)
            email = body.get('email')
            if where and current.emails and isinstance(email,str):
                token = current.emails.get(email.strip().lower())
                if token:
                    _add(req,{'type':'token','token_id':token['id'],'where':where})
            password = body.get('password')
            if current.passwords and path in SIGN_IN_PATHS and isinstance(password,str) and len(password)>=model.LOOKUP_PREFIX_LENGTH:
                token = current.secret(password,'password')
                if token:
                    _add(req,{'type':'token','token_id':token['id'],'where':'sign_in'})
        raw = getattr(req,'raw_json',None)
        if current.api_keys and raw and len(raw)<=model.MAX_SCAN_BODY_BYTES and MARKER_BYTES in raw:
            for key in set(API_KEY_BYTES.findall(raw)):
                token = current.secret(key.decode(),'api_key')
                if token:
                    _add(req,{'type':'token','token_id':token['id'],'where':'json_body'})
    except Exception as error:
        print(f'[{now()}] Traps: {type(error).__name__}',file=sys.stderr,flush=True)


# The web app's reports (POST /api/trap)
def trusted_report(req):
    """Only the Next.js app itself: the header it puts on its own reports (and strips from every browser request it
    forwards), from where the client-address header is believed (middleware/security.py)."""
    from backend.middleware.security import from_web_app
    return req.command=='POST' and req.headers.get(model.TRAP_HEADER)=='1' and from_web_app(req)


def handle_report(req):
    """{path, method, user_agent} of a visit to a decoy page or a /files/<token> link -> 204."""
    from backend.modules.security import schema
    path,method,agent = schema.trap_report(req.body)
    path = unquote(path)
    current = state()
    hits = []
    if path.startswith(model.FILE_LINK_PREFIX):
        secret = path[len(model.FILE_LINK_PREFIX):].rstrip('/')
        token = current.secret(secret,'link') if current.links and secret else None
        if token:
            hits.append({'type':'token','token_id':token['id'],'where':'link'})
        elif current.paths_enabled:
            hits.append({'type':'path','path':model.FILE_LINK_PREFIX+secret[:6]+('…' if len(secret)>6 else ''),'method':method})
    elif current.paths_enabled:
        hits.append({'type':'path','path':path[:200],'method':method})
    if hits:
        _enqueue({'data':D.DATA,'ip':req.ip,'user_agent':agent,'cookie':'','admin':False,'hits':hits})
    return req.send(204,b'','text/plain; charset=utf-8')


# Hidden form fields
def form_trapped(body):
    """True when a hidden field of the form was filled (and hidden fields are switched on)."""
    return any(body.get(name) not in (None,'') for name in model.HIDDEN_FIELDS) and state().forms_enabled


def record_form(client, form, subject='', tenant_id=None, actor='anonymous'):
    client = client or {}
    events.record('honeypot_form',actor=actor,subject=subject,tenant_id=tenant_id,ip=client.get('ip',''),
                  user_agent=client.get('user_agent',''),detail={'form':form})


# Platform admins' addresses (never blocked)
_admins = {}


def note_admin(ip, session_token):
    """A request of a signed-in platform admin came from this address (middleware/auth.py)."""
    if ip and _admins.get(ip)!=session_token:
        if len(_admins)>1000:
            _admins.clear()
        _admins[ip] = session_token


def _admin_address(ip):
    from backend.modules.auth import repository as users
    from backend.modules.security import sessions
    token = _admins.get(ip)
    if not token:
        return False
    with D.control() as cd:
        session = users.find_session(cd,token)
        if not session or not session['platform_admin']:
            return False
        return not sessions.expired_reason(session['created_at'],session['last_active_at'],sessions.limits(cd,'platform'),session['expires_at'])


def exempt(ip, job, insider=None):
    """Never block loopback, an unknown address, or the address of a signed-in platform admin."""
    try:
        if not ip or ipaddress.ip_address(ip).is_loopback:
            return True
    except ValueError:
        return True
    return bool(job.get('admin') or (insider and insider['platform_admin']) or _admin_address(ip))


# Writing hits (one background thread)
_queue = queue.Queue(maxsize=10000)
_worker = {'thread':None}


def report(req):
    """After the answer: hand what inspect_request / inspect_body noted to the writer."""
    session = req.session or {}
    _enqueue({'data':D.DATA,'ip':getattr(req,'ip','') or '','user_agent':(req.headers.get('User-Agent') or '')[:300],
              'cookie':req.headers.get('Cookie',''),'admin':bool(session.get('platform_admin')) if isinstance(session,dict) else False,
              'hits':req.traps})


def _enqueue(job):
    with _lock:
        thread = _worker['thread']
        if thread is None or not thread.is_alive():
            thread = _worker['thread'] = threading.Thread(target=_run,name='bookdose-traps',daemon=True)
            thread.start()
    try:
        _queue.put_nowait(job)
    except queue.Full:
        pass


def _run():
    while True:
        job = _queue.get()
        try:
            # A job of another data folder (a test that has ended) is dropped.
            if job['data'] is D.DATA:
                process(job)
        except Exception as error:
            print(f'[{now()}] Traps: {type(error).__name__}',file=sys.stderr,flush=True)
        finally:
            _queue.task_done()


def flush(timeout=10):
    """Wait until every reported hit is written (tests)."""
    deadline = time.monotonic()+timeout
    while _queue.unfinished_tasks and time.monotonic()<deadline:
        time.sleep(0.01)
    return not _queue.unfinished_tasks


def process(job):
    insider = _staff_session(job['cookie'])
    for hit in job['hits']:
        if hit['type']=='path':
            _path_hit(job,hit,insider)
        else:
            trigger(job,hit,insider)


def _staff_session(cookie_header):
    """The staff session the request carried (an insider), or None."""
    from backend.modules.auth import repository as users
    from backend.modules.auth.service import SESSION_COOKIE
    if not cookie_header or SESSION_COOKIE not in cookie_header:
        return None
    jar = cookies.SimpleCookie()
    try:
        jar.load(cookie_header)
    except cookies.CookieError:
        return None
    found = jar.get(SESSION_COOKIE)
    if not found or not found.value:
        return None
    with D.control() as cd:
        return users.find_session(cd,digest(found.value))


def _who(insider):
    if not insider:
        return 'anonymous',None,{}
    return ('platform' if insider['platform_admin'] else 'staff'),insider['tenant_id'],{'user_id':insider['user_id'],'user_email':insider['email']}


def _settings():
    from backend.modules.security import sessions
    with D.control() as cd:
        return sessions.settings(cd)['honeypot']


def _path_hit(job, hit, insider):
    from backend.modules.security import repository
    actor,tenant_id,who = _who(insider)
    ip = job['ip']
    events.record('honeypot_path',actor=actor,subject=hit['path'],tenant_id=tenant_id,ip=ip,user_agent=job['user_agent'],
                  detail={'path':hit['path'],'method':hit['method'],**who})
    rule = _settings()['block_on_path_hits']
    if not rule['enabled'] or exempt(ip,job,insider):
        return
    with D.control() as cd:
        hits = repository.hits_since(cd,'honeypot_path',ip,after(minutes=-rule['window_minutes']))
    if hits>=rule['hits']:
        block(ip,rule['duration'],f"แตะเส้นทางกับดัก {hits} ครั้งใน {rule['window_minutes']} นาที",{'trigger':'honeypot_path','hits':hits})


def block(ip, duration, reason, detail):
    """Block an address for a trap (never shortening a block it already has)."""
    from backend.modules.security import blocks, repository
    seconds = model.BLOCK_DURATIONS[duration]
    expires = after(seconds=seconds) if seconds else None
    with D.control() as cd:
        D.begin(cd)
        current = repository.block(cd,ip)
        if current and (current['expires_at'] is None or (expires and current['expires_at']>=expires)):
            return False
        repository.save_block(cd,ip,reason[:300],model.TRAP_BLOCKER,expires)
        cd.commit()
    blocks.invalidate()
    events.record('trap_ip_block',ip=ip,detail={**detail,'blocked_ip':ip,'expires_at':expires,'reason':reason[:300]})
    return True


def trigger(job, hit, insider):
    """A honeytoken was used: counted on the token, a critical event, an alert (one open per token and address), the
    address blocked and the platform admins emailed."""
    from backend.modules.security import repository
    ip = job['ip']
    with D.control() as cd:
        D.begin(cd)
        token = repository.honeytoken(cd,hit['token_id'])
        if not token or not token['enabled']:
            return
        repository.note_trigger(cd,token['id'],ip)
        detail = {'token_id':token['id'],'kind':token['kind'],'label':token['label'],'where':hit['where']}
        actor,tenant_id,who = _who(insider)
        alert = repository.open_honeytoken_alert(cd,token['id'],ip)
        if alert:
            repository.bump_alert(cd,alert['id'])
        else:
            repository.insert_alert(cd,'honeytoken','critical',1,ip,json.dumps({**detail,**who},ensure_ascii=False))
        cd.commit()
    events.record('honeytoken_triggered',severity='critical',actor=actor,tenant_id=tenant_id,ip=ip,user_agent=job['user_agent'],
                  subject=(insider or {}).get('email') or token['decoy_email'] or '',detail={**detail,**who})
    rule = _settings()['block_on_honeytoken']
    if rule['enabled'] and not exempt(ip,job,insider):
        block(ip,rule['duration'],f"กับดัก: {token['label']}",{'trigger':'honeytoken','token_id':token['id']})
    _mail_admins(token,ip,hit['where'])


MAIL_KEY = 'honeytoken_alert_mail'


def _mail_admins(token, ip, where):
    """At most one email per token per hour, when the platform mailbox is ready."""
    from backend.modules.platform import repository as platform, service as platform_service
    from backend.modules.security.events import parse
    from backend.utils.dates import utc_now
    with D.control() as cd:
        if not platform_service.registration_ready(cd):
            return
        D.begin(cd)
        try:
            sent = json.loads(platform.setting(cd,MAIL_KEY) or '{}')
        except ValueError:
            sent = {}
        last = parse(sent.get(token['id']))
        if last and (utc_now()-last).total_seconds()<model.HONEYTOKEN_MAIL_SECONDS:
            return
        sent = {k:v for k,v in sent.items() if (parse(v) and (utc_now()-parse(v)).total_seconds()<model.HONEYTOKEN_MAIL_SECONDS)}
        sent[token['id']] = now()
        platform.save_setting(cd,MAIL_KEY,json.dumps(sent))
        cd.commit()
        recipients = [a['email'] for a in platform.platform_admins(cd)]
        cfg = platform_service.registration_config(cd)
    threading.Thread(target=_send,args=(recipients,cfg,token,ip,where),name='bookdose-trap-mail',daemon=True).start()


WHERE_LABELS = {'sign_in':'การเข้าสู่ระบบ','password_reset':'การขอรีเซ็ตรหัสผ่าน','registration':'การสมัครบัญชี','invite':'การเพิ่มสมาชิก',
                'authorization':'ส่วนหัว Authorization','x_api_key':'ส่วนหัว X-API-Key','cookie':'คุกกี้','query':'พารามิเตอร์ใน URL',
                'json_body':'ข้อมูล JSON ที่ส่งมา','link':'การเปิดลิงก์'}


def _send(recipients, cfg, token, ip, where):
    from email.message import EmailMessage
    from email.utils import formatdate, make_msgid
    from backend.extensions import channel_transport as T
    from backend.modules.platform import service as platform_service
    secret = platform_service.registration_secret()
    for recipient in recipients:
        try:
            mail = EmailMessage()
            mail['Subject'] = 'แจ้งเตือนวิกฤต: มีการใช้กับดักความปลอดภัย'
            mail['From'],mail['To'] = cfg['address'],recipient
            mail['Date'],mail['Message-ID'],mail['Auto-Submitted'] = formatdate(localtime=False,usegmt=True),make_msgid(),'auto-generated'
            mail.set_content(f"มีผู้ใช้กับดัก “{token['label']}” ซึ่งผู้ใช้จริงไม่ควรแตะต้อง อาจมีผู้บุกรุกหรือข้อมูลรั่วไหล\n\n"
                             f"พบที่: {WHERE_LABELS.get(where,where)}\nจาก IP: {ip or 'ไม่ทราบ'}\nเวลา: {now()} (UTC)\n\n"
                             f"ดูรายละเอียดที่ คอนโซลระบบกลาง → ความปลอดภัย:\n{cfg.get('public_base_url','')}/platform/security\n")
            T.send_email(cfg,secret,recipient,mail)
        except Exception as error:
            print(f'[{now()}] Trap mail: {type(error).__name__}',file=sys.stderr,flush=True)
