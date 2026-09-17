"""Sign-in sessions, first-time platform setup, password login, the user's own account,
and self-registration of new organizations with email verification."""
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from http import cookies
import secrets
import threading

from config import settings
from backend.database import audit, db as D
from backend.exceptions.errors import APIError, ChannelError
from backend.extensions import channel_transport as T
from backend.modules.auth import repository, schema
from backend.modules.organization import repository as memberships
from backend.modules.platform import repository as tenants, service as platform
from backend.utils.dates import after, now
from backend.utils.security import password_ok, token_hash, uid
from backend.utils.validation import require

# Setup, login and registration run one at a time so two first-time setups cannot both succeed.
SETUP_LOCK = threading.Lock()
# Same shape as a real hash so unknown emails take as long to check as known ones.
DUMMY_PASSWORD_HASH = 'pbkdf2_sha256$600000$'+'00'*16+'$'+'00'*32
SESSION_COOKIE = 'bookdose_session'
SESSION_HOURS = 12
VERIFY_LINK_SECONDS = 3600
PENDING_SECONDS = 86400
RESEND_COOLDOWN_SECONDS = 60


# Sessions
def session_actor(session):
    """Which limits a staff session keeps: 'platform' for a platform admin's, else 'staff'."""
    return 'platform' if session['platform_admin'] else 'staff'


def load_session(db, cookie_header, client=None):
    """(session or None, 'idle' / 'absolute' when the cookie named a session that has just run out). An expired session
    is deleted and recorded; reading never counts as activity."""
    from backend.modules.security import events, sessions
    jar = cookies.SimpleCookie()
    try:
        jar.load(cookie_header)
    except cookies.CookieError:
        pass
    token = jar.get(SESSION_COOKIE)
    session = repository.find_session(db,token_hash(token.value) if token else '')
    if not session:
        return None,None
    actor = session_actor(session)
    reason = sessions.expired_reason(session['created_at'],session['last_active_at'],sessions.limits(db,actor),session['expires_at'])
    if not reason:
        return session,None
    repository.delete_session(db,session['token'])
    db.commit()
    client = client or {}
    events.record('session_expired',actor=actor,subject=session['email'],tenant_id=session['tenant_id'],
                  ip=client.get('ip',''),user_agent=client.get('user_agent',''),detail={'reason':reason})
    return None,reason


def read_session(db, cookie_header, optional=False, client=None):
    session,reason = load_session(db,cookie_header,client)
    if not optional:
        if reason:
            from backend.modules.security import sessions
            raise sessions.expired_error(reason)
        require(session,'กรุณาเข้าสู่ระบบ',401)
    return session


def session_times(db, session):
    """{idle_expires_at, absolute_expires_at} of a signed-in staff session."""
    from backend.modules.security import sessions
    return sessions.expiry(session['created_at'],session['last_active_at'],sessions.limits(db,session_actor(session)),session['expires_at'])


def touch_session(db, session):
    """Real use (any change, or the page's activity signal): the idle time starts again. Saved at once, so the request
    holds no write transaction on the control database afterwards."""
    session['last_active_at'] = repository.touch_session(db,session['token'])
    db.commit()


def cookie_max_age(db):
    """How long the browser keeps the cookie: the longest staff lifetime (the server ends the session itself)."""
    from backend.modules.security import sessions
    values = sessions.settings(db)
    return max(sessions.seconds_of(values,'staff')[1],sessions.seconds_of(values,'platform')[1])


def create_session(db, user_id):
    """Store a session on the user's first active organization and return the raw cookie token. It lasts as long as
    the security settings allow for the user (platform admins have shorter limits)."""
    from backend.modules.security import sessions
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
    tenant_id = memberships.first_active_tenant(db,user_id)
    user = D.one(db,'SELECT platform_admin FROM users WHERE id=?',(user_id,))
    _,absolute = sessions.limits(db,'platform' if user and user['platform_admin'] else 'staff')
    expires = after(seconds=absolute)
    repository.delete_expired_sessions(db)
    repository.insert_session(db,token_hash(token),user_id,tenant_id,csrf,expires)
    return token


def workspace_context(db, session):
    ctx = memberships.workspace_membership(db,session['user_id'],session['tenant_id'])
    if not ctx:
        from backend.modules.security import events
        # A suspended organization is not a cross-organization attempt; a member removed from an active one is.
        if session['tenant_id'] and D.one(db,"SELECT 1 FROM tenants WHERE id=? AND status='active'",(session['tenant_id'],)):
            events.record('cross_tenant_denied',actor=events.staff_actor(session),subject=session['email'],
                          tenant_id=session['tenant_id'],detail={'action':'workspace'})
        require(False,'ไม่มีสิทธิ์เข้าองค์กรนี้ หรือองค์กรถูกระงับ',403)
    ctx.update(id=session['user_id'],name=session['name'],session_token=session['token'])
    return ctx


def bootstrap_data(db, session):
    return schema.bootstrap(session,
        setup_required=repository.count_users(db)==0,
        setup_token_required=bool(settings.setup_token()) or settings.on_render(),
        registration_available=platform.registration_ready(db),
        home=tenants.home_organization(db),
        avatar=repository.avatar_of(db,session['user_id']) if session else '',
        memberships=memberships.user_memberships(db,session['user_id']) if session else [])


def end_session(db, session):
    repository.delete_session(db,session['token'])
    db.commit()


def switch_tenant(db, session, body):
    tid = schema.tenant_choice(body)
    if not memberships.can_enter_tenant(db,session['user_id'],tid):
        from backend.modules.security import events
        events.record('cross_tenant_denied',actor=events.staff_actor(session),subject=session['email'],tenant_id=tid if len(tid)==32 else None,
                      detail={'action':'switch_tenant'})
        require(False,'ไม่มีสิทธิ์เข้าองค์กรนี้',403)
    repository.set_session_tenant(db,session['token'],tid)
    db.commit()


# The signed-in user's account
def change_password(db, session, body):
    """Check the current password, sign out every session of the user and return a fresh session token."""
    encoded,current = schema.password_change_form(body)
    require(password_ok(current,repository.password_of(db,session['user_id'])),'รหัสผ่านเดิมไม่ถูกต้อง',403)
    repository.set_password(db,session['user_id'],encoded)
    repository.delete_user_sessions(db,session['user_id'])
    token = create_session(db,session['user_id'])
    db.commit()
    return token


def update_profile(db, session, body):
    name,avatar = schema.profile_form(body)
    repository.set_user_name(db,session['user_id'],name)
    repository.save_avatar(db,session['user_id'],avatar)
    audit.record(db,session['user_id'],'account.profile_updated',session['user_id'])
    db.commit()


# First run and sign-in
def set_up_platform(cookie_header, body):
    """First run only: create the platform owner and the first organization; returns a session token."""
    with SETUP_LOCK, D.control() as db:
        require(repository.count_users(db)==0,'ระบบตั้งค่าเรียบร้อยแล้ว',409)
        setup_token = settings.setup_token()
        require(not settings.on_render() or len(setup_token)>=32,'กรุณาตั้ง BOOKDOSE_SETUP_TOKEN อย่างน้อย 32 ตัวอักษรในโฮสต์ก่อนตั้งค่าระบบ',503)
        if setup_token:
            supplied = body.get('setup_token','')
            require(isinstance(supplied,str) and secrets.compare_digest(supplied.encode(),setup_token.encode()),'รหัสตั้งค่าระบบไม่ถูกต้อง',403)
        form = schema.setup_form(body)
        user_id = uid()
        repository.insert_user(db,user_id,form['name'],form['email'],form['password'],platform_admin=True)
        platform.create_tenant(db,form['organization'],form['slug'],user_id,body.get('demo') is True)
        return _replace_session(db,cookie_header,user_id)


def log_in(cookie_header, body, client=None):
    """A password sign-in. Wrong passwords count towards the lock of the typed email (security.lockout), whether or
    not it has an account; while it is locked every attempt is answered 429 before the password is looked at."""
    from backend.modules.security import lockout
    from backend.modules.security import traps
    email,password = schema.login_form(body)
    key = lockout.key_for('staff',email)
    if traps.form_trapped(body):
        traps.record_form(client,'staff_sign_in',email)
        lockout.refuse_trapped(key,'อีเมลหรือรหัสผ่านไม่ถูกต้อง',password)
    lockout.check(key,client)
    with SETUP_LOCK, D.control() as db:
        user = repository.find_user_by_email(db,email)
        encoded = user['password'] if user else DUMMY_PASSWORD_HASH
        correct = password_ok(password,encoded) and user
        token = _replace_session(db,cookie_header,user['id']) if correct else None
    actor = 'platform' if user and user['platform_admin'] else 'staff'
    if not correct:
        lockout.fail(key,client,actor=actor,owner={'email':user['email'],'name':user['name']} if user else None)
        require(False,'อีเมลหรือรหัสผ่านไม่ถูกต้อง',401)
    lockout.succeed(key,client,actor=actor)
    return token


def sign_in(cd, cookie_header, body, client=None):
    """POST /api/sign-in, the shared sign-in page: one request checks the staff account and the customer account of the
    typed email. Returns ('staff', session token) or ('customer', {'session'} / {'challenge','methods'}); a staff
    account whose password matches wins over a customer account with the same password.

    The lock is 'signin:<email>' (a lock on the email's staff or customer key refuses it too, lockout.related_keys),
    checked before any password. Both password hashes always run - a dummy one for a missing account - so the time
    taken does not tell which kinds of account exist. Only when neither password matches is ONE failure counted and
    ONE login_failed event recorded (actor of the account that exists, else 'anonymous'), and the owners of the
    accounts of that email are the ones told about a new lock. A customer's second step then counts as on
    POST /api/customer/login (customer_security.finish_challenge)."""
    from backend.modules.customers import repository as accounts, service as customers
    from backend.modules.security import lockout, traps
    email,password = schema.login_form(body)
    key = lockout.key_for('signin',email)
    if traps.form_trapped(body):
        # The hidden field of the sign-in page was filled: a bot. Refused like a wrong password, never counted.
        traps.record_form(client,'sign_in',email)
        lockout.refuse_trapped(key,customers.WRONG_LOGIN,password,hashes=2)
    lockout.check(key,client)
    user = repository.find_user_by_email(cd,email)
    account = accounts.find_by_email(cd,email)
    staff_ok = password_ok(password,user['password'] if user else DUMMY_PASSWORD_HASH) and bool(user)
    customer_ok = password_ok(password,account['password'] if account else customers.DUMMY_PASSWORD_HASH) and bool(account)
    staff_actor = 'platform' if user and user['platform_admin'] else 'staff'
    if staff_ok:
        with SETUP_LOCK:
            token = _replace_session(cd,cookie_header,user['id'])
        lockout.succeed(key,client,actor=staff_actor)
        return 'staff',token
    if customer_ok:
        result = customers.password_proven(cd,account,client)
        if result.get('session'):
            lockout.succeed(key,client,actor='customer')
        return 'customer',result
    if account:
        customers.wrong_password(cd,account,client)
    owners = ([{'email':user['email'],'name':user['name'],'actor':staff_actor}] if user else [])+\
             ([{'email':account['email'],'name':account['name'],'actor':'customer'}] if account else [])
    lockout.fail(key,client,actor=staff_actor if user else 'customer' if account else 'anonymous',owner=owners)
    require(False,customers.WRONG_LOGIN,401)


def _replace_session(db, cookie_header, user_id):
    old = read_session(db,cookie_header,True)
    if old:
        repository.delete_session(db,old['token'])
    token = create_session(db,user_id)
    audit.record(db,user_id,'auth.login',user_id)
    db.commit()
    return token


# Self-registration
def request_registration(cookie_header, body, resend, client=None):
    """Record a sign-up (or a resend) and email the verification link. A sign-up whose hidden form field was filled
    (security.traps) gets the same checks and the same answer, and nothing is recorded or sent."""
    from backend.modules.security import traps
    trapped = None
    with SETUP_LOCK, D.control() as db:
        D.begin(db)
        _require_registration_open(db,cookie_header)
        if not resend and traps.form_trapped(body):
            trapped = schema.registration_form(body)['email']
            require(platform.registration_ready(db), 'ยังไม่เปิดรับสมัคร กรุณาให้ผู้ดูแลแพลตฟอร์มตั้งค่าอีเมลยืนยันก่อน',503)
            task = None
        elif resend:
            task = _prepare_verification(db,email=schema.registration_email(body))
        else:
            task = _prepare_verification(db,applicant=schema.registration_form(body))
        db.commit()
    if trapped:
        # Recorded once the write transaction is over (the event has its own connection).
        traps.record_form(client,'staff_register',trapped)
    # SMTP may take seconds; release both the write transaction and setup lock first.
    _send_verification(task)


def verify_registration(cookie_header, body):
    """Activate a verified sign-up and return a session token for the new organization admin."""
    with SETUP_LOCK, D.control() as db:
        D.begin(db)
        _require_registration_open(db,cookie_header)
        user_id = _activate_registration(db,body.get('token'))
        token = create_session(db,user_id)
        db.commit()
        return token


def _require_registration_open(db, cookie_header):
    require(repository.platform_admin_exists(db),
            'ระบบยังไม่พร้อมรับสมัคร กรุณาให้เจ้าของระบบตั้งค่าครั้งแรกก่อน',409)
    require(not read_session(db,cookie_header,True),'กรุณาออกจากระบบก่อนสมัครหรือยืนยันบัญชีองค์กรใหม่',409)


def _prepare_verification(db, applicant=None, email=None):
    """Called inside a write transaction; returns a private mail task (never API data), or None when nothing is sent.
    The answer is the same whether or not the email is known, so sign-up cannot be used to discover accounts."""
    require(platform.registration_ready(db), 'ยังไม่เปิดรับสมัคร กรุณาให้ผู้ดูแลแพลตฟอร์มตั้งค่าอีเมลยืนยันก่อน',503)
    repository.purge_pending(db,after(seconds=-PENDING_SECONDS))
    email = applicant['email'] if applicant else email
    if repository.find_user_by_email(db,email):
        return None
    pending = repository.find_pending(db,email)
    if pending and pending['last_sent_at']>after(seconds=-RESEND_COOLDOWN_SECONDS):
        return None
    if applicant:
        # A repeat signup must not replace an unexpired applicant's password or organization.
        if pending and pending['expires_at']>now() and not tenants.slug_taken(db,pending['slug']):
            applicant = pending
        else:
            require(not tenants.slug_taken(db,applicant['slug']),'รหัสองค์กรนี้ถูกใช้แล้ว กรุณาเลือกรหัสอื่น',409)
    elif pending:
        applicant = pending
        if tenants.slug_taken(db,pending['slug']):
            return None
    else:
        return None
    token = secrets.token_urlsafe(32)
    repository.save_pending(db,email,applicant,token_hash(token),after(seconds=VERIFY_LINK_SECONDS))
    return {'email':email,'token':token,'organization':applicant['organization'],
            'config':platform.registration_config(db),'secret':platform.registration_secret()}


def _send_verification(task):
    if task is None:
        return
    cfg = task['config']
    link = cfg['public_base_url']+'/#verify-email?token='+task['token']
    mail = EmailMessage()
    mail['Subject'] = 'ยืนยันอีเมลเพื่อเปิดใช้งาน Bookdose Customer Service'
    mail['From'] = cfg['address']
    mail['To'] = task['email']
    mail['Date'] = formatdate(localtime=False,usegmt=True)
    mail['Message-ID'] = make_msgid()
    mail['Auto-Submitted'] = 'auto-generated'
    mail.set_content(f"มีการสมัครองค์กร {task['organization']} ด้วยอีเมลนี้\n\n"
                     f"เปิดลิงก์แล้วกดยืนยันอีเมลเพื่อสร้างองค์กร:\n{link}\n\n"
                     "ลิงก์มีอายุ 1 ชั่วโมงและใช้ได้ครั้งเดียว ลิงก์ใหม่จะยกเลิกลิงก์เดิม\n"
                     "หากคุณไม่ได้สมัคร กรุณาไม่กดยืนยันและลบอีเมลนี้\n")
    try:
        T.send_email(cfg,task['secret'],task['email'],mail)
    except ChannelError:
        # Do not retry an uncertain SMTP delivery. The applicant can explicitly request another link.
        raise APIError(503,'ยังยืนยันผลการส่งอีเมลไม่ได้ กรุณาตรวจกล่องจดหมายและสแปม หากไม่พบให้รอ 1 นาทีแล้วขอลิงก์ใหม่ หรือติดต่อผู้ดูแล') from None


def _activate_registration(db, token):
    schema.verification_token(token)
    repository.purge_pending(db,after(seconds=-PENDING_SECONDS))
    pending = repository.find_pending_by_token(db,token_hash(token))
    require(pending and pending['expires_at']>now(), 'ลิงก์ยืนยันไม่ถูกต้อง หมดอายุ หรือใช้ไปแล้ว กรุณาขอลิงก์ใหม่')
    require(not tenants.slug_taken(db,pending['slug']),'รหัสองค์กรนี้ถูกใช้แล้ว กรุณาสมัครใหม่ด้วยรหัสองค์กรอื่น',409)
    require(not repository.find_user_by_email(db,pending['email']), 'อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ',409)
    user_id = uid()
    repository.insert_user(db,user_id,pending['name'],pending['email'],pending['password'])
    tenant_id = platform.create_tenant(db,pending['organization'],pending['slug'],user_id,False)
    repository.mark_email_verified(db,user_id)
    repository.delete_pending(db,pending['email'])
    audit.record(db,user_id,'tenant.register',tenant_id)
    audit.record(db,user_id,'auth.email_verified',user_id)
    return user_id
