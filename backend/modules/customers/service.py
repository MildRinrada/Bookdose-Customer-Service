"""Customer accounts: one account for every organization on the platform. Sign-up with consent to the privacy notice,
sign-in, password reset and change, the profile, the organizations the customer is connected with, their
conversations and cases in all of them, their notifications, and an email notice when a team replies.
Customers use the main page of the app; ?org=<code> on it connects the organization of that link.
Emails go out through the platform's verification mailbox (คอนโซลระบบกลาง → จัดการองค์กร → อีเมลยืนยัน). Once it is
set up a sign-up must confirm its email first; before that, sign-up still works and the account is marked as not
verified. No SMTP call runs inside a database transaction, and an uncertain delivery is reported rather than repeated."""
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
import json
import secrets

from backend.database import audit, db as D
from backend.exceptions.errors import APIError, ChannelError
from backend.extensions import channel_transport as T
from backend.modules.contacts import repository as contacts
from backend.modules.conversations import repository as conversations
from backend.modules.customers import repository, schema
from backend.modules.customers.model import CONSENT_VERSION, DEFAULT_CATEGORIES
from backend.modules.knowledge import repository as knowledge
from backend.modules.organization import repository as organization
from backend.modules.platform import repository as tenants, service as platform
from backend.utils.dates import after, now
from backend.utils.security import password_ok, token_hash, uid
from backend.utils.validation import require

SESSION_COOKIE = 'bookdose_account'
SESSION_SECONDS = 30*86400
VERIFY_HOURS = 24
RESET_HOURS = 1
RESEND_SECONDS = 60
NOTICE_DELAY_SECONDS = 120   # a reply the customer reads on the page within this time is not emailed
RECENT_DONE_DAYS = 7
# Same shape as a real hash, so an unknown email takes as long to check as a known one.
DUMMY_PASSWORD_HASH = 'pbkdf2_sha256$600000$'+'00'*16+'$'+'00'*32
WRONG_LOGIN = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง หรือยังไม่ได้ยืนยันอีเมล'
UNCERTAIN_MAIL ='ยังยืนยันผลการส่งอีเมลไม่ได้ กรุณาตรวจกล่องจดหมายและสแปม หากไม่พบให้รอ 1 นาทีแล้วลองใหม่'


def email_ready(cd):
    """The platform's verification mailbox is set up: sign-ups confirm their email, notices and resets can be sent."""
    return platform.registration_ready(cd)


def categories(db):
    """[{'name','team_id'}] a customer chooses from when starting a chat with this organization."""
    row = db.execute("SELECT value FROM settings WHERE key='customer_categories'").fetchone()
    try:
        return json.loads(row[0]) if row else DEFAULT_CATEGORIES
    except ValueError:
        return DEFAULT_CATEGORIES


# Email
def _send(cfg, secret, recipient, subject, text):
    mail = EmailMessage()
    mail['Subject'],mail['From'],mail['To'] = subject,cfg['address'],recipient
    mail['Date'],mail['Message-ID'],mail['Auto-Submitted'] = formatdate(localtime=False,usegmt=True),make_msgid(),'auto-generated'
    mail.set_content(text)
    T.send_email(cfg,secret,recipient,mail)


def _page(cfg, fragment=''):
    """A link into the customer's side of the app (the main page)."""
    return f"{cfg['public_base_url']}/"+(f'#{fragment}' if fragment else '')


def _deliver(cd, name, task):
    """Send the account email prepared inside the transaction. name: the organization the customer signed up with."""
    if not task:
        return
    cfg,secret = platform.registration_config(cd),platform.registration_secret()
    if task['kind']=='verify':
        subject = f'ยืนยันอีเมลบัญชีลูกค้า {name}'
        text = (f"สวัสดีคุณ{task['name']}\n\nเปิดลิงก์นี้เพื่อยืนยันอีเมลและเริ่มใช้บัญชีลูกค้า {name}:\n{_page(cfg,'verify='+task['token'])}\n\n"
                'หน้ายืนยันจะขอรหัสผ่านที่คุณตั้งไว้ตอนสมัคร ลิงก์มีอายุ 24 ชั่วโมง\n'
                'หากคุณไม่ได้สมัคร ไม่ต้องทำอะไร จะไม่มีบัญชีเกิดขึ้น\n')
    elif task['kind']=='exists':
        subject = f'มีการสมัครด้วยอีเมลของคุณที่ {name}'
        text = (f"อีเมลนี้มีบัญชีลูกค้าอยู่แล้ว เข้าสู่ระบบได้ที่:\n{_page(cfg,'login')}\n\n"
                'หากลืมรหัสผ่าน กด “ลืมรหัสผ่าน” ในหน้าเข้าสู่ระบบ\nหากคุณไม่ได้ทำรายการนี้ ไม่ต้องทำอะไร\n')
    else:
        subject = 'ตั้งรหัสผ่านใหม่ บัญชีลูกค้า'
        text = (f"เปิดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่:\n{_page(cfg,'reset='+task['token'])}\n\n"
                f"ลิงก์มีอายุ 1 ชั่วโมงและใช้ได้ครั้งเดียว หากคุณไม่ได้ขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้\n\n{_page(cfg)}\n")
    try:
        _send(cfg,secret,task['email'],subject,text)
    except ChannelError:
        raise APIError(503,UNCERTAIN_MAIL) from None


# Organizations
def _org_by_code(cd, value):
    org = tenants.find_active_by_slug(cd,schema.org_code(value))
    require(org,'ไม่พบองค์กรนี้ หรือองค์กรหยุดให้บริการชั่วคราว',404)
    return org


def _signup_org(cd, body):
    """The organization a sign-up comes from: the one named by the link it was opened with, else the platform's own."""
    return _org_by_code(cd,body['org']) if body.get('org') else tenants.home_organization(cd)


def _ensure_member(db, account):
    """The account's own contact in this organization, made on first contact: an earlier support-page contact with the
    same proven email (its conversations become the customer's), otherwise a new one. Returns its id."""
    contact_id = repository.member_contact(db,account['id'])
    if contact_id and contacts.find(db,contact_id):
        return contact_id
    earlier = repository.earlier_portal_contacts(db,account['email']) if account['email_verified'] else []
    contact_id = earlier[0] if earlier else uid()
    if not earlier:
        contacts.insert(db,contact_id,account['name'],account['email'],account['phone'],'','','portal')
    repository.set_member(db,account['id'],contact_id)
    for cid in [contact_id,*earlier]:
        repository.link_contact(db,account['id'],cid)
    audit.record(db,account['name'],'customer.joined',contact_id,account['email'])
    return contact_id


def ensure_member(db, account):
    """The account's own contact in this organization (see _ensure_member); used when guest chats move into it."""
    return _ensure_member(db,account)


def _join(cd, account_id, org):
    """Connect the account with an organization (safe to repeat)."""
    repository.join_org(cd,account_id,org['id'])
    cd.commit()
    account = repository.find(cd,account_id)
    with D.tenant(org['id']) as db:
        _ensure_member(db,account)


def _connected(cd, session):
    """(organizations the customer can contact, the platform's own): the platform's own first, then the others the
    account is connected with. Suspended organizations are left out."""
    home = tenants.home_organization(cd)
    found = [home] if home else []
    for tenant_id in repository.org_ids(cd,session['account_id']):
        org = tenants.find_active(cd,tenant_id)
        if org and not any(o['id']==org['id'] for o in found):
            found.append(org)
    return found,home


def _org_view(org, home):
    from backend.modules.ai import service as ai
    with D.tenant(org['id']) as db:
        # has_logo, not the picture: a customer with ten organizations would carry a megabyte of them in every answer.
        return {'slug':org['slug'],'name':org['name'],'home':bool(home) and org['id']==home['id'],'has_logo':bool(org['logo']),
                'welcome':organization.setting(db,'welcome'),'response_hours':organization.setting(db,'response_hours'),
                'ai_enabled':ai.config(db)['chatbot_enabled'] and ai.has_key(org['id']),
                'categories':[c['name'] for c in categories(db)]}


def organizations(cd, session):
    found,home = _connected(cd,session)
    return [_org_view(org,home) for org in found]


def join_by_code(cd, session, body):
    """The customer adds an organization by its code (the one in the organization's link)."""
    org = _org_by_code(cd,body.get('slug',''))
    _join(cd,session['account_id'],org)
    return _org_view(org,tenants.home_organization(cd))


# Sign-up and email confirmation
def register(cd, body, client=None):
    """With the platform mailbox set up: record the attempt and email its link, and return None. The answer is the
    same whether or not the email has an account (the owner of an existing account is told by email instead), so the
    form cannot be used to find out who is a customer.
    Without it: the account is created and signed in at once, marked as not verified; returns the session token."""
    from backend.modules.security import traps
    form = schema.signup_form(body)
    org = _signup_org(cd,body)
    if traps.form_trapped(body):
        # The hidden form field was filled: nothing is created or sent; the answer is the usual "link sent".
        traps.record_form(client,'customer_register',form['email'])
        return None
    if not email_ready(cd):
        return _register_unverified(cd,form,org,client)
    D.begin(cd)
    repository.purge_signups(cd)
    if repository.find_by_email(cd,form['email']):
        task = {'kind':'exists','email':form['email']}
    else:
        latest = repository.latest_signup(cd,form['email'])
        require(not latest or latest['created_at']<=after(seconds=-RESEND_SECONDS),'เพิ่งส่งลิงก์ยืนยันไปเมื่อสักครู่ กรุณาตรวจอีเมล หรือรอ 1 นาทีแล้วลองใหม่',429)
        token = secrets.token_urlsafe(32)
        repository.insert_signup(cd,token_hash(token),form,CONSENT_VERSION,after(hours=VERIFY_HOURS),org['id'] if org else None)
        task = {'kind':'verify','email':form['email'],'name':form['name'],'token':token}
    cd.commit()
    _deliver(cd,org['name'] if org else 'Bookdose',task)
    return None


def _register_unverified(cd, form, org, client=None):
    """No way to send email yet: the account works at once. Its email is not proven, so conversations sent earlier
    with that email are not attached, and a second sign-up with the same email is refused."""
    D.begin(cd)
    require(not repository.find_by_email(cd,form['email']),'อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ',409)
    account_id = uid()
    repository.insert_account(cd,account_id,{**form,'consent_version':CONSENT_VERSION,'consent_at':now()},email_verified=False)
    session = _new_session(cd,account_id,client)
    cd.commit()
    if org:
        _join(cd,account_id,org)
    return session


def resend(cd, body):
    """A new link for the latest waiting sign-up of this email (same details); nothing when there is none."""
    require(email_ready(cd),'ยังส่งอีเมลไม่ได้ กรุณาติดต่อองค์กรผ่านช่องทางอื่น',503)
    email = schema.email_only(body)
    D.begin(cd)
    latest = repository.latest_signup(cd,email)
    task,name = None,'Bookdose'
    if latest and not repository.find_by_email(cd,email):
        require(latest['created_at']<=after(seconds=-RESEND_SECONDS),'เพิ่งส่งลิงก์ยืนยันไปเมื่อสักครู่ กรุณารอ 1 นาทีแล้วลองใหม่',429)
        token = secrets.token_urlsafe(32)
        repository.insert_signup(cd,token_hash(token),latest,latest['consent_version'],after(hours=VERIFY_HOURS),latest['tenant_id'])
        task = {'kind':'verify','email':email,'name':latest['name'],'token':token}
        org = tenants.find_active(cd,latest['tenant_id']) if latest['tenant_id'] else None
        name = org['name'] if org else name
    cd.commit()
    _deliver(cd,name,task)


def verify(cd, body, client=None):
    """Open the link and give the password of that sign-up: the account is created, connected with the organization
    it signed up with, and signed in. Returns the session token for the cookie."""
    token,password = schema.verify_form(body)
    D.begin(cd)
    signup = repository.find_signup(cd,token_hash(token))
    require(signup,'ลิงก์ยืนยันไม่ถูกต้อง หมดอายุ หรือใช้ไปแล้ว กรุณาสมัครใหม่หรือขอลิงก์ใหม่')
    require(password_ok(password,signup['password']),'รหัสผ่านไม่ตรงกับที่ตั้งไว้ตอนสมัคร',403)
    require(not repository.find_by_email(cd,signup['email']),'อีเมลนี้ยืนยันแล้ว กรุณาเข้าสู่ระบบ',409)
    account_id = uid()
    repository.insert_account(cd,account_id,signup)
    repository.delete_signups(cd,signup['email'])
    session = _new_session(cd,account_id,client)
    cd.commit()
    org = tenants.find_active(cd,signup['tenant_id']) if signup['tenant_id'] else tenants.home_organization(cd)
    if org:
        _join(cd,account_id,org)
    return session


# Sign-in, sign-out and passwords
def _new_session(cd, account_id, client=None):
    """A new session cookie for this device; the device and address are kept so the customer can see and sign out
    each one (customer_security)."""
    from backend.modules.security import sessions
    token = secrets.token_urlsafe(32)
    repository.delete_expired_sessions(cd)
    repository.insert_session(cd,token_hash(token),account_id,secrets.token_urlsafe(24),after(seconds=sessions.limits(cd,'customer')[1]),
                             uid(),(client or {}).get('user_agent',''),(client or {}).get('ip',''))
    return token


def start_session(cd, account_id, client=None):
    """Sign this device in (the second step of a sign-in and the passkey sign-in finish here); the caller commits."""
    repository.touch_login(cd,account_id)
    return _new_session(cd,account_id,client)


def _signed_in(cd, account, client, action):
    """A proven password: {'session'} - or {'challenge','methods'} when the account asks for a second step, which
    /api/customer/login/verify finishes. Nothing is signed in until that step passes."""
    from backend.modules.customer_security import service as security
    challenge = security.start_challenge(cd,account)
    if challenge:
        cd.commit()
        return challenge
    repository.touch_login(cd,account['id'])
    session = _new_session(cd,account['id'],client)
    security.record(cd,account['id'],action,client=client)
    cd.commit()
    return {'session':session}


def password_proven(cd, account, client=None):
    """The account's password was right (POST /api/customer/login or the shared POST /api/sign-in): {'session'}, or
    {'challenge','methods'} when the account asks for a second step. The caller clears the lock on a session."""
    return _signed_in(cd,account,client,'login')


def wrong_password(cd, account, client=None):
    """A wrong password for an account that exists goes to its activity log (saved at once)."""
    from backend.modules.customer_security import service as security
    security.record(cd,account['id'],'login_failed',client=client)
    cd.commit()


def log_in(cd, body, client=None):
    """The answer is the session token, or a two-factor challenge. A wrong password is written to the activity log
    of an account that exists; an unknown email records nothing there, so the log cannot be filled by guessing. Wrong
    passwords count towards the lock of the typed email (security.lockout) either way; while it is locked every
    attempt is answered 429 before the password is looked at."""
    from backend.modules.security import lockout, traps
    email,password = schema.login_form(body)
    key = lockout.key_for('customer',email)
    if traps.form_trapped(body):
        traps.record_form(client,'customer_sign_in',email)
        lockout.refuse_trapped(key,WRONG_LOGIN,password)
    lockout.check(key,client)
    account = repository.find_by_email(cd,email)
    correct = password_ok(password,account['password'] if account else DUMMY_PASSWORD_HASH)
    if account and not correct:
        wrong_password(cd,account,client)
    if not (correct and account):
        lockout.fail(key,client,owner={'email':account['email'],'name':account['name']} if account else None)
        require(False,WRONG_LOGIN,401)
    result = password_proven(cd,account,client)
    if result.get('session'):
        lockout.succeed(key,client)
    return result


def load_session(cd, cookie_header, client=None):
    """(session or None, 'idle' / 'absolute' when the cookie named a session that has just run out, which is then
    deleted and recorded). When the device was last seen more than a few minutes ago the time is written again, so
    the customer's list of signed-in devices stays useful; that is not activity (last_active_at stays)."""
    from http import cookies
    from backend.modules.customer_security.model import SEEN_SECONDS
    from backend.modules.security import events, sessions
    jar = cookies.SimpleCookie()
    try:
        jar.load(cookie_header)
    except cookies.CookieError:
        return None,None
    token = jar.get(SESSION_COOKIE)
    session = repository.find_session(cd,token_hash(token.value)) if token and token.value else None
    if not session:
        return None,None
    reason = sessions.expired_reason(session['session_created_at'],session['last_active_at'],sessions.limits(cd,'customer'),session['expires_at'])
    if reason:
        repository.delete_session(cd,session['token_hash'])
        cd.commit()
        client = client or {}
        events.record('session_expired',actor='customer',subject=session['email'],ip=client.get('ip',''),
                      user_agent=client.get('user_agent',''),detail={'reason':reason})
        return None,reason
    if (session['last_seen_at'] or '')<after(seconds=-SEEN_SECONDS):
        repository.touch_session(cd,session['token_hash'])
        cd.commit()
    return session,None


def cookie_account(cd, cookie_header):
    """The account id the session cookie names, or None; nothing is judged or written. The session's limits are left
    to load_session: a request limit only needs to know whose requests these are, and a token cannot be guessed."""
    from http import cookies
    jar = cookies.SimpleCookie()
    try:
        jar.load(cookie_header)
    except cookies.CookieError:
        return None
    token = jar.get(SESSION_COOKIE)
    session = repository.find_session(cd,token_hash(token.value)) if token and token.value else None
    return session['account_id'] if session else None


def read_session(cd, cookie_header):
    """The signed-in customer from the session cookie, or None (also for a session that has just run out)."""
    return load_session(cd,cookie_header)[0]


def touch_session(cd, session):
    """Real use: the idle time starts again. Saved at once."""
    session['last_active_at'] = repository.touch_activity(cd,session['token_hash'])
    cd.commit()


def session_times(cd, session):
    from backend.modules.security import sessions
    return sessions.expiry(session['session_created_at'],session['last_active_at'],sessions.limits(cd,'customer'),session['expires_at'])


def cookie_max_age(cd):
    from backend.modules.security import sessions
    return sessions.limits(cd,'customer')[1]


def log_out(cd, session):
    repository.delete_session(cd,session['token_hash'])
    cd.commit()


def forgot(cd, body, client=None):
    """Email a reset link when the email has an account; the answer is the same either way."""
    require(email_ready(cd),'ยังส่งอีเมลไม่ได้ กรุณาติดต่อองค์กรผ่านช่องทางอื่น',503)
    email = schema.email_only(body)
    from backend.modules.security import events, traps
    if traps.form_trapped(body):
        # The hidden form field was filled: no link is sent; the answer is the usual one.
        traps.record_form(client,'customer_forgot',email)
        return
    events.record('password_reset_requested',actor='customer',subject=email,ip=(client or {}).get('ip',''),
                  user_agent=(client or {}).get('user_agent',''))
    D.begin(cd)
    account = repository.find_by_email(cd,email)
    task = None
    if account:
        latest = repository.latest_reset(cd,account['id'])
        if not latest or latest['created_at']<=after(seconds=-RESEND_SECONDS):
            token = secrets.token_urlsafe(32)
            repository.insert_reset(cd,token_hash(token),account['id'],after(hours=RESET_HOURS))
            task = {'kind':'reset','email':email,'token':token}
    cd.commit()
    _deliver(cd,'',task)


def reset_password(cd, body, client=None):
    """Set a new password from a reset link; every session of the account is signed out and every passkey is
    removed, so the reset really is a clean slate - a key left behind on a borrowed screen would otherwise outlive
    it. Opening the emailed link also proves the email of an account created before email was set up. An account
    with two-factor sign-in ends in the challenge, not a session: the link alone never gets past the second step."""
    from backend.modules.customer_security import service as security
    token,password = schema.reset_form(body)
    D.begin(cd)
    reset = repository.find_reset(cd,token_hash(token))
    require(reset,'ลิงก์ตั้งรหัสผ่านไม่ถูกต้อง หมดอายุ หรือใช้ไปแล้ว กรุณาขอลิงก์ใหม่')
    repository.set_password(cd,reset['account_id'],password)
    repository.mark_email_verified(cd,reset['account_id'])
    repository.delete_sessions(cd,reset['account_id'])
    repository.delete_resets(cd,reset['account_id'])
    security.forget_passkeys(cd,reset['account_id'],client)
    security.record(cd,reset['account_id'],'password_reset',client=client)
    account = repository.find(cd,reset['account_id'])
    result = _signed_in(cd,account,client,'login')
    # The owner proved the mailbox: the locks of that email end here (the sign-in page's one too).
    from backend.modules.security import events, lockout
    unlocked = lockout.clear(lockout.key_for('customer',account['email']),related=True)
    events.record('password_reset_completed',actor='customer',subject=account['email'],ip=(client or {}).get('ip',''),
                  user_agent=(client or {}).get('user_agent',''),detail={'unlocked':unlocked})
    return result


def change_password(cd, session, body):
    """Needs the current password; every other device signed in to the account is signed out."""
    current,password = schema.password_change_form(body)
    D.begin(cd)
    account = repository.find(cd,session['account_id'])
    require(password_ok(current,account['password']),'รหัสผ่านเดิมไม่ถูกต้อง',403)
    repository.set_password(cd,account['id'],password)
    repository.delete_other_sessions(cd,account['id'],session['token_hash'])
    cd.commit()


def account_view(cd, session):
    view = schema.account_view(session)
    if session:
        view.update(session_times(cd,session))
    return view


def update_profile(cd, session, body):
    """The customer changes the name the teams call them and their phone number. In each organization the contact
    record takes the new phone only where that team has not written something else there."""
    name,phone = schema.profile_form(body)
    D.begin(cd)
    account = repository.find(cd,session['account_id'])
    repository.set_profile(cd,account['id'],name,phone)
    cd.commit()
    for tenant_id in repository.org_ids(cd,account['id']):
        if not tenants.find_active(cd,tenant_id):
            continue
        with D.tenant(tenant_id) as db:
            contact = contacts.find(db,repository.member_contact(db,account['id']) or '')
            if contact and contact['phone'] in ('',account['phone']):
                contacts.update(db,contact['id'],contact['name'],contact['email'],phone,contact['company'],contact['notes'])
            if contact:
                audit.record(db,name,'customer.profile',contact['id'],account['email'])


def set_notifications(cd, session, body):
    repository.set_notify_email(cd,session['account_id'],schema.notifications_form(body))
    cd.commit()


def notification_settings(cd, session):
    """What the customer is told and where: every event with email / LINE on or off, whether email can reach them,
    and the organizations they are connected with whose LINE can send notices (or that they are linked with)."""
    from backend.modules.customers import notify
    from backend.modules.customers.model import NOTIFY_EVENTS
    account = repository.find(cd,session['account_id'])
    found,_ = _connected(cd,session)
    joined = set(repository.org_ids(cd,account['id']))
    lines = []
    for org in found:
        if org['id'] not in joined:
            continue
        with D.tenant(org['id']) as db:
            row,link = notify.line_channel(db,org['id']),repository.line_link(db,account['id'])
        if row or link:
            lines.append({'org_slug':org['slug'],'org_name':org['name'],'available':bool(row),'linked':bool(link),
                          'linked_at':link['linked_at'] if link else None,'oa_name':(row['config'].get('display_name') or '') if row else ''})
    return {'events':[{'key':key,'label':label,'email':notify.wants(account,key,'email'),'line':notify.wants(account,key,'line')}
                      for key,label,_ in NOTIFY_EVENTS],
            'email':{'ready':email_ready(cd),'verified':bool(account['email_verified']),'address':account['email']},'line':lines}


def save_notification_settings(cd, session, body):
    """Merge the choices sent ({events: {event: {email, line}}}) into the account's; a chat reply by email is the
    old notify_email switch, so both settings pages agree."""
    from backend.modules.customers import notify
    from backend.modules.customers.model import NOTIFY_EVENTS
    chosen = schema.notify_prefs_form(body,[key for key,_,_ in NOTIFY_EVENTS])
    account = repository.find(cd,session['account_id'])
    prefs = notify.prefs_of(account)
    for event,channels in chosen.items():
        if event=='reply' and 'email' in channels:
            repository.set_notify_email(cd,account['id'],channels.pop('email'))
        prefs[event] = {**(prefs.get(event) if isinstance(prefs.get(event),dict) else {}),**channels}
    repository.set_notify_prefs(cd,account['id'],json.dumps(prefs))
    cd.commit()


# Everything the customer has, across the organizations they are connected with
def _conversations(db, session):
    from backend.modules.automation.service import SURVEY_DAYS
    return [{**c,'survey_pending':bool(c['survey_pending'])} for c in repository.conversations_of(db,session['account_id'],after(days=-SURVEY_DAYS))]


# The button of each alert (what the customer does next).
ACTION_LABELS = {'reply':'อ่านและตอบกลับ','survey':'ให้คะแนน','waiting':'ส่งข้อมูลเพิ่ม','done':'ดูเคส','followup':'ดูเคส'}


def _alerts(conversations_list, cases):
    """Newest first. 'action' marks what waits for the customer (counted on the bell); the rest is news; every alert
    has the words of its button (action_label). Worked out from how things are now, so they clear themselves once the
    customer has read the reply, answered the survey, or the team moved the case on."""
    found = []
    for c in conversations_list:
        base = {'conversation_id':c['id'],'subject':c['subject'],'org_slug':c['org_slug'],'org_name':c['org_name'],'at':c['updated_at']}
        if c['survey_pending']:
            found.append({**base,'kind':'survey','action':True})
        elif c['last_kind']=='reply' and (not c['seen_at'] or c['seen_at']<c['updated_at']):
            found.append({**base,'kind':'reply','action':True})
    recent = after(days=-RECENT_DONE_DAYS)
    for t in cases:
        base = {'case_id':t['id'],'number':t['number'],'subject':t['subject'],'org_slug':t['org_slug'],'org_name':t['org_name']}
        if t['status']=='pending_customer':
            found.append({**base,'kind':'waiting','action':True,'at':t['updated_at']})
        elif t['status'] in ('resolved','closed') and (t['resolved_at'] or t['updated_at'])>=recent:
            found.append({**base,'kind':'done','action':False,'at':t['resolved_at'] or t['updated_at']})
        if t['next_followup_at'] and t['status'] not in ('resolved','closed'):
            found.append({**base,'kind':'followup','action':False,'at':t['next_followup_at']})
    for a in found:
        a['action_label'] = ACTION_LABELS[a['kind']]
    found.sort(key=lambda a:a['at'],reverse=True)
    return sorted(found,key=lambda a:not a['action'])


def overview(cd, session):
    """The customer's conversations and cases in every organization they are connected with (each marked with its
    organization), and what the side menu counts and the notifications page lists."""
    found,_ = _connected(cd,session)
    joined = set(repository.org_ids(cd,session['account_id']))
    conversation_rows,case_rows = [],[]
    for org in found:
        if org['id'] not in joined:
            continue
        label = {'org_slug':org['slug'],'org_name':org['name']}
        with D.tenant(org['id']) as db:
            conversation_rows += [{**c,**label} for c in _conversations(db,session)]
            case_rows += [{**schema.case_row(t),**label} for t in repository.cases_of(db,session['account_id'])]
    conversation_rows.sort(key=lambda c:c['updated_at'],reverse=True)
    case_rows.sort(key=lambda t:t['updated_at'],reverse=True)
    alerts = _alerts(conversation_rows,case_rows)
    return {'conversations':conversation_rows,'cases':case_rows,'alerts':alerts,'alert_count':sum(a['action'] for a in alerts)}


def faq(cd, session):
    """Public articles of every organization the customer can contact, then the platform's articles for customers."""
    found,home = _connected(cd,session)
    articles = []
    for org in found:
        with D.tenant(org['id']) as db:
            articles += [{**a,'org_slug':org['slug'],'org_name':org['name']} for a in knowledge.list_public(db)]
    platform_name = home['name'] if home else 'Bookdose'
    articles += [{**a,'org_slug':home['slug'] if home else '','org_name':platform_name,'global':True}
                 for a in tenants.global_articles(cd,'customer')]
    return {'articles':articles}


# One organization: its conversations and cases (called with that organization's database)
def current_conversation(db, session, conversation_id):
    """A conversation of the signed-in customer; 404 for anyone else's."""
    conv = repository.owned_conversation(db,session['account_id'],schema.conversation_id(conversation_id))
    require(conv,'ไม่พบเรื่องนี้ในบัญชีของคุณ',404)
    return conv


def _team_for(db, category):
    """The team the organization sends this category to, if it still exists; otherwise its first team."""
    team = next((c['team_id'] for c in categories(db) if c['name']==category),'')
    if team and db.execute('SELECT 1 FROM teams WHERE id=?',(team,)).fetchone():
        return team
    return organization.first_team_id(db)


def request_form(db, body):
    """(subject, category) of a new chat with this organization."""
    return schema.new_request(body,[c['name'] for c in categories(db)])


def new_web_conversation(db, org, contact_id, author_name, subject, category, body):
    """A web chat of this contact with its first message, inside the caller's transaction (the signed-in customer's
    page and guest web chat both start chats here): the category chosen decides the team, and the chatbot or the
    routing rules take the first message. Returns the conversation id."""
    from backend.modules.ai import service as ai
    from backend.modules.conversations.service import store_message
    conv_id = uid()
    conversations.insert(db,conv_id,contact_id,subject,'web',_team_for(db,category))
    if category:
        repository.set_category(db,conv_id,category)
    store_message(db,org['id'],conv_id,None,author_name,'customer',body)
    ai.on_customer_message(db,org['id'],conv_id,body.get('body',''),is_new=True)
    audit.record(db,author_name,'conversation.created',conv_id)
    return conv_id


def open_conversation(cd, db, org, session, body):
    """Start a chat with this organization as the signed-in customer (connecting it if this is the first contact).
    Returns the conversation id."""
    subject,category = request_form(db,body)
    account = repository.find(cd,session['account_id'])
    D.begin(db)
    contact_id = _ensure_member(db,account)
    conv_id = new_web_conversation(db,org,contact_id,account['name'],subject,category,body)
    repository.mark_seen(db,account['id'],conv_id)
    db.commit()
    repository.join_org(cd,account['id'],org['id'])
    cd.commit()
    return conv_id


def mark_seen(db, session, conversation_id):
    from backend.realtime import events as realtime
    realtime.customer_read(db,conversation_id,account_id=session['account_id'])
    repository.mark_seen(db,session['account_id'],conversation_id)


def case_detail(db, session, case_id):
    ticket = repository.owned_case(db,session['account_id'],schema.case_id(case_id))
    require(ticket,'ไม่พบเคสนี้ในบัญชีของคุณ',404)
    return schema.case_view(ticket,repository.case_conversations(db,session['account_id'],ticket['id']),
                            repository.case_followups(db,ticket['id']),repository.case_rating(db,ticket['id']))


# Notices of what happened in a web conversation (email, and LINE when linked)
def notice_words(event, org_name, subject):
    """(email subject, email sentence, short LINE sentence) of a notice: what happened and in which conversation,
    never the messages themselves. event: 'reply' (the team wrote), 'ai' (the chatbot answered) or 'handoff' (the
    chatbot passed the conversation to the team)."""
    if event=='ai':
        return (f'มีคำตอบใหม่: {subject}',f'ผู้ช่วย AI ของ {org_name} ตอบคำถามเรื่อง “{subject}” แล้ว',
                f'ผู้ช่วย AI ของ {org_name} ตอบเรื่อง “{subject}” แล้ว')
    if event=='handoff':
        return (f'ส่งต่อให้เจ้าหน้าที่แล้ว: {subject}',
                f'เรื่อง “{subject}” ถูกส่งต่อให้เจ้าหน้าที่ของ {org_name} แล้ว เจ้าหน้าที่จะตอบกลับในแชทนี้',
                f'{org_name} ส่งเรื่อง “{subject}” ให้เจ้าหน้าที่ดูแลแล้ว')
    return (f'มีคำตอบใหม่: {subject}',f'ทีมงาน {org_name} ตอบกลับเรื่อง “{subject}” แล้ว',f'{org_name} ตอบกลับเรื่อง “{subject}” แล้ว')


def notify_reply(db, conversation_id, event='reply'):
    """Something new for the customer in a web conversation: the team (or the survey) wrote ('reply'), the chatbot
    answered ('ai') or the chatbot passed it to the team ('handoff'). An account holder who wants that event by email
    (and whose email is proven), or on this organization's LINE and is linked with it, gets one notice - unless one is
    still waiting for this conversation. Called inside the transaction that stored the message. A guest's chat is told
    on the guest's proven channels (guest.service.notify_reply)."""
    from backend.modules.customers import notify
    from backend.modules.guest import service as guest
    conv = conversations.find(db,conversation_id)
    if conv and conv['channel']=='web':
        guest.notify_reply(db,conversation_id,event)
    if not conv or conv['channel']!='web' or repository.pending_notification(db,conversation_id):
        return
    owners = repository.owners_of_contact(db,conv['contact_id'])
    if not owners:
        return
    tenant_id = None
    with D.control() as cd:
        for account_id in owners:
            account = repository.find(cd,account_id)
            if account and account['email_verified'] and notify.wants(account,event,'email'):
                repository.insert_notification(db,uid(),account_id,conversation_id,event)
                return
            if account and repository.line_link(db,account_id):
                from backend.modules.channels import repository as channel_repository
                tenant_id = tenant_id or channel_repository.tenant_id_of(db)
                if notify.line_wanted(db,tenant_id,account,event):
                    repository.insert_notification(db,uid(),account_id,conversation_id,event)
                    return


def send_notices(tenant_id):
    """Tell the customers whose conversations got a reply they have not read on the page within a couple of minutes:
    by email (the platform mailbox) and, when they want it, on the organization's LINE (queued in the notification
    outbox). The notice names the conversation and links to it; it never contains the messages. Returns how many
    were emailed or queued for LINE."""
    from backend.modules.customers import notify
    due,lines = [],0
    with D.control() as cd:
        mail = email_ready(cd)
        cfg,secret,org = platform.registration_config(cd),platform.registration_secret(),tenants.tenant_summary(cd,tenant_id)
        with D.tenant(tenant_id) as db:
            D.begin(db)
            for notice in repository.due_notifications(db,after(seconds=-NOTICE_DELAY_SECONDS)):
                account = repository.find(cd,notice['account_id'])
                if notice['seen_at'] and notice['seen_at']>=notice['created_at']:
                    repository.finish_notification(db,notice['id'],'seen')
                    continue
                event = notice.get('event') or 'reply'
                by_line = notify.line_wanted(db,tenant_id,account,event)
                if by_line and notify.queue_line(cd,db,tenant_id,account['id'],notice_words(event,org['name'],notice['subject'])[2],
                                                 f"/customer/chats/{org['slug']}/{notice['conversation_id']}",f"reply:{notice['id']}"):
                    lines += 1
                # Email only to an address the customer proved: a notice queued for LINE must not reach an unproven one.
                if not account or not mail or not notify.wants(account,event,'email') or not account['email_verified']:
                    repository.finish_notification(db,notice['id'],'line' if by_line else 'off')
                else:
                    repository.claim_notification(db,notice['id'])
                    due.append({**notice,'event':event,'email':account['email'],'name':account['name']})
    for notice in due:
        error = ''
        subject,sentence,_ = notice_words(notice['event'],org['name'],notice['subject'])
        try:
            _send(cfg,secret,notice['email'],subject,
                  f"สวัสดีคุณ{notice['name']}\n\n{sentence}\n"
                  f"เข้าสู่ระบบเพื่ออ่านและตอบกลับ:\n{_page(cfg,'chats/'+org['slug']+'/'+notice['conversation_id'])}\n")
        except ChannelError as failure:
            error = failure.code if not failure.uncertain else 'unknown'
        with D.tenant(tenant_id) as db:
            if not error or error=='unknown' or notice['attempts']+1>=3:
                repository.finish_notification(db,notice['id'],error)
            else:
                repository.fail_notification(db,notice['id'],error)
    return len(due)+lines
