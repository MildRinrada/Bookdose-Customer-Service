"""Security of a customer account: two-factor sign-in (an authenticator app plus printed recovery codes), passkeys,
the devices that are signed in, and the account's own history. Staff sign-in is untouched.

The rules this file keeps:
  * a TOTP code is good for one 30-second step and that step is never accepted again; a recovery code works once.
  * a password that is right on an account with two-factor sign-in gives a challenge, never a session - the same
    for a password-reset link, so the emailed link alone can never get past the second step.
  * every passkey challenge is random, kept only as a hash, lasts five minutes and is deleted as it is read, so no
    answer can be replayed; the origin and rpId are the ones recorded when the challenge was handed out.
  * a passkey with user verification counts as both factors; a signature counter that does not move forward means
    the credential was copied, and is refused and recorded.
  * every change that adds or takes away a way into the account - turning two-factor sign-in on or off, starting
    or removing a passkey, new recovery codes - costs the password (or a code), so a borrowed screen can neither
    lock the owner out nor leave itself a key behind; a password reset takes the passkeys with it.
  * secrets are never written to the activity log, never returned twice, and codes are compared byte by byte in
    constant time."""
import hmac
import json
import secrets

from backend.database import db as D
from backend.exceptions.errors import APIError
from backend.modules.customer_security import repository, schema, totp, webauthn
from backend.modules.customer_security.model import (ACTIVITY_KEEP_DAYS, ACTIVITY_PAGE, CHALLENGE_MINUTES,
                                                     LOGIN_CHALLENGE_MINUTES, LOGIN_CHALLENGE_TRIES, RECOVERY_ALPHABET,
                                                     RECOVERY_COUNT, RECOVERY_GROUP, TOTP_ISSUER)
from backend.modules.customers import repository as customers
from backend.utils.dates import after
from backend.utils.qrcode import data_url
from backend.utils.security import password_ok, token_hash, uid
from backend.utils.validation import existing_password, require

CHALLENGE_COOKIE = 'bookdose_2fa'
CHALLENGE_SECONDS = LOGIN_CHALLENGE_MINUTES*60
WRONG_STEP = 'รหัสยืนยันไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่'
STALE = 'คำขอนี้หมดอายุหรือถูกใช้ไปแล้ว กรุณาลองใหม่'
NO_SESSION = 'คำขอเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่'


# The caller's device, and the account's history
def client_info(req):
    """What is written next to an entry in the activity log and a session: the browser and its address."""
    return {'ip':req.ip,'user_agent':(req.headers.get('User-Agent') or '')[:300]}


def record(cd, account_id, action, detail='', client=None):
    """One line in the account's history. Only what happened, from where and with what - never a code or a token."""
    client = client or {}
    repository.insert_activity(cd,uid(),account_id,action,(detail or '')[:200],client.get('ip',''),client.get('user_agent',''))


def note(req, action, detail=''):
    """Record from a controller and save it at once."""
    record(req.cd,req.customer['account_id'],action,detail,client_info(req))
    req.cd.commit()


# Two-factor sign-in
def two_factor_on(cd, account_id):
    row = repository.totp(cd,account_id)
    return bool(row and row['confirmed_at'])


def methods(cd, account_id):
    """What can finish a sign-in that stopped at the second step."""
    found = ['totp'] if two_factor_on(cd,account_id) else []
    if found and any(code['used_at'] is None for code in repository.recovery_codes(cd,account_id)):
        found.append('recovery')
    return found


def overview(cd, session):
    """ตั้งค่าบัญชี → ความปลอดภัย: the state of two-factor sign-in, the recovery codes left, and the passkeys."""
    account_id = session['account_id']
    row = repository.totp(cd,account_id)
    codes = repository.recovery_codes(cd,account_id)
    return {'two_factor':{'enabled':bool(row and row['confirmed_at']),'pending':bool(row and not row['confirmed_at']),
                          'confirmed_at':row['confirmed_at'] if row else None},
            'recovery':{'left':sum(1 for c in codes if c['used_at'] is None),'total':len(codes)},
            'passkeys':[schema.passkey_view(p) for p in repository.passkeys(cd,account_id)]}


def setup_totp(cd, session, body):
    """A new secret waiting to be confirmed, with its QR code. Nothing changes until a code from the app proves the
    app and the server agree. Starting costs the account's password: turning the second step on is what decides how
    the owner gets back in, so a borrowed screen must not be able to do it with a secret only it holds."""
    require(not two_factor_on(cd,session['account_id']),'เปิดการยืนยันสองขั้นตอนไว้แล้ว หากต้องการตั้งใหม่ให้ปิดก่อน',409)
    prove_owner(cd,session['account_id'],body)
    secret = totp.new_secret()
    repository.start_totp(cd,session['account_id'],secret)
    cd.commit()
    uri = totp.uri(secret,session['email'],TOTP_ISSUER)
    return {'secret':secret,'otpauth_uri':uri,'qr':_qr(uri)}


def _qr(uri):
    """The otpauth link as a QR image. An address long enough not to fit gets no picture; the secret beside it is
    typed into the app by hand instead."""
    try:
        return data_url(uri,'QR สำหรับแอปยืนยันตัวตน')
    except ValueError:
        return ''


def confirm_totp(cd, session, body, client=None):
    """Turn two-factor sign-in on with a code from the app, and hand over ten recovery codes - shown this once."""
    entered = schema.code(body)
    D.begin(cd)
    row = repository.totp(cd,session['account_id'])
    require(row and not row['confirmed_at'],'ยังไม่ได้เริ่มตั้งค่าการยืนยันสองขั้นตอน กรุณาเริ่มใหม่',409)
    step = totp.check(row['secret'],entered,row['last_step'])
    require(step and repository.confirm_totp(cd,session['account_id'],step)==1,WRONG_STEP,403)
    codes = _new_recovery_codes(cd,session['account_id'])
    record(cd,session['account_id'],'totp_on',client=client)
    cd.commit()
    return {'ok':True,'recovery_codes':codes}


def disable_totp(cd, session, body, client=None):
    """Off again: the current password and a code (or a recovery code). The recovery codes go with it."""
    password = existing_password(body)
    D.begin(cd)
    account = customers.find(cd,session['account_id'])
    require(password_ok(password,account['password']),'รหัสผ่านไม่ถูกต้อง',403)
    require(two_factor_on(cd,session['account_id']),'ยังไม่ได้เปิดการยืนยันสองขั้นตอน',409)
    require(_second_step_ok(cd,account,body),WRONG_STEP,403)
    repository.delete_totp(cd,account['id'])
    repository.delete_recovery_codes(cd,account['id'])
    record(cd,account['id'],'totp_off',client=client)
    cd.commit()
    return {'ok':True}


def new_recovery_codes(cd, session, body, client=None):
    """A fresh set; the old ones stop working at once."""
    password = existing_password(body)
    D.begin(cd)
    account = customers.find(cd,session['account_id'])
    require(password_ok(password,account['password']),'รหัสผ่านไม่ถูกต้อง',403)
    require(two_factor_on(cd,account['id']),'ยังไม่ได้เปิดการยืนยันสองขั้นตอน',409)
    codes = _new_recovery_codes(cd,account['id'])
    record(cd,account['id'],'recovery_new',client=client)
    cd.commit()
    return {'ok':True,'recovery_codes':codes}


def _new_recovery_codes(cd, account_id):
    codes = []
    for _ in range(RECOVERY_COUNT):
        letters = ''.join(secrets.choice(RECOVERY_ALPHABET) for _ in range(2*RECOVERY_GROUP))
        codes.append(f'{letters[:RECOVERY_GROUP]}-{letters[RECOVERY_GROUP:]}')
    repository.replace_recovery_codes(cd,account_id,[(uid(),token_hash(c.replace('-',''))) for c in codes])
    return codes


def _use_recovery_code(cd, account_id, entered):
    """True when the code is one of the account's unused ones, and marks it used. Every stored code is compared,
    in constant time, so neither the answer nor the time says which one was close."""
    wanted,found = token_hash(entered),None
    for row in repository.recovery_codes(cd,account_id):
        if row['used_at'] is None and hmac.compare_digest(row['code_hash'],wanted):
            found = row
    return bool(found) and repository.use_recovery_code(cd,found['id'])==1


def _second_step_ok(cd, account, body):
    """A code from the app, or one of the recovery codes; either proves the second factor."""
    kind,entered = schema.second_step(body)
    if kind=='recovery':
        return _use_recovery_code(cd,account['id'],entered)
    row = repository.totp(cd,account['id'])
    if not row or not row['confirmed_at']:
        return False
    step = totp.check(row['secret'],entered,row['last_step'])
    return bool(step) and repository.use_totp_step(cd,account['id'],step)==1


def prove_owner(cd, account_id, body):
    """The owner proves it is still them: the account's password, or a code when two-factor sign-in is on. Every
    change that adds or takes away a way into the account goes through here, so a session someone walked away from
    can neither leave a key behind (a passkey, a second factor only they hold) nor take one away."""
    account = customers.find(cd,account_id)
    require(account,NO_SESSION,401)
    if body.get('code') or body.get('recovery_code'):
        require(_second_step_ok(cd,account,body),WRONG_STEP,403)
    else:
        require(password_ok(existing_password(body),account['password']),'รหัสผ่านไม่ถูกต้อง',403)
    return account


def forget_passkeys(cd, account_id, client=None):
    """A password reset is a clean slate: the passkeys go with the old password. Whoever asks for the reset is the
    one who owns the mailbox, and a passkey added from a borrowed screen would otherwise outlive every remedy the
    owner has. The caller commits."""
    if repository.delete_passkeys(cd,account_id):
        record(cd,account_id,'passkeys_cleared',client=client)


# The second step of a sign-in
def start_challenge(cd, account):
    """{'challenge','methods'} when this account asks for a second step, else None (the caller signs in as usual)."""
    found = methods(cd,account['id'])
    if not found:
        return None
    token = secrets.token_urlsafe(32)
    repository.insert_login_challenge(cd,token_hash(token),account['id'],after(minutes=LOGIN_CHALLENGE_MINUTES))
    return {'challenge':token,'methods':found}


def finish_challenge(cd, token, body, client=None):
    """The second step: {'session'} when the code is right. Five wrong tries and the challenge is thrown away."""
    from backend.modules.customers import service as accounts
    kind,_entered = schema.second_step(body)
    require(isinstance(token,str) and token,NO_SESSION,401)
    D.begin(cd)
    row = repository.login_challenge(cd,token_hash(token))
    require(row,NO_SESSION,401)
    account = customers.find(cd,row['account_id'])
    repository.count_login_attempt(cd,token_hash(token))
    if not account or not _second_step_ok(cd,account,body):
        if row['attempts']+1>=LOGIN_CHALLENGE_TRIES:
            repository.delete_login_challenge(cd,token_hash(token))
        if account:
            record(cd,account['id'],'login_failed',client=client)
        cd.commit()
        require(False,WRONG_STEP,403)
    # One challenge, one sign-in: the row goes before the session is made.
    require(repository.delete_login_challenge(cd,token_hash(token))==1,NO_SESSION,401)
    session = accounts.start_session(cd,account['id'],client)
    record(cd,account['id'],'login_2fa' if kind=='code' else 'login_recovery',client=client)
    cd.commit()
    return {'session':session}


# Passkeys (WebAuthn)
def _origin(req):
    """(the page's origin as the browser sees it, the rpId). The host is the one the Next.js app forwarded, which
    middleware/security.py has already decided to trust; the rpId is that name without the port."""
    from backend.middleware.security import from_web_app
    host = (req.headers.get('X-Forwarded-Host') if from_web_app(req) else req.headers.get('Host','')) or ''
    require(host,'ไม่ทราบที่อยู่ของหน้าเว็บ กรุณาเปิดผ่านแอป',400)
    sent = req.headers.get('Origin','')
    origin = sent if sent in ('http://'+host,'https://'+host) else ('https' if req.server.secure_cookies else 'http')+'://'+host
    rp_id = host[:host.find(']')+1] if host.startswith('[') else host.rsplit(':',1)[0]
    return origin,rp_id


def _issue_challenge(req, purpose, account_id=''):
    """A fresh random challenge, kept as a hash with the origin and rpId it was made for."""
    origin,rp_id = _origin(req)
    value = webauthn.b64url(secrets.token_bytes(32))
    repository.insert_challenge(req.cd,token_hash(value),account_id,purpose,rp_id,origin,after(minutes=CHALLENGE_MINUTES))
    req.cd.commit()
    return value,origin,rp_id


def _take_challenge(req, credential, purpose):
    """The row of the challenge the browser answered, removed as it is read. The value is only a lookup key: what
    the row says (origin, rpId, whose it was) is what the checks then use."""
    value = webauthn.claimed_challenge(credential)
    row = repository.find_challenge(req.cd,token_hash(value),purpose)
    require(row and repository.take_challenge(req.cd,token_hash(value))==1,STALE,403)
    req.cd.commit()
    _,rp_id = _origin(req)
    require(rp_id==row['rp_id'],'คำขอมาจากที่อยู่อื่น กรุณาเปิดจากหน้าเว็บของระบบโดยตรง',403)
    return value,row


def passkey_options(req):
    """What navigator.credentials.create() is called with: a discoverable passkey that must verify the user.
    Starting the ceremony needs the account's password (or a code when two-factor sign-in is on) - a passkey is a
    way in that survives a sign-out and counts as both factors, so adding one costs as much as removing one. No
    challenge is handed out until that is proven, and add_passkey() accepts nothing without a challenge."""
    session = req.customer
    prove_owner(req.cd,session['account_id'],req.body)
    value,_origin_text,rp_id = _issue_challenge(req,'register',session['account_id'])
    existing = repository.passkeys(req.cd,session['account_id'])
    return {'challenge':value,'rp':{'id':rp_id,'name':TOTP_ISSUER},
            'user':{'id':webauthn.b64url(bytes.fromhex(session['account_id'])),'name':session['email'],
                    'displayName':session['name']},
            'pubKeyCredParams':[{'type':'public-key','alg':alg} for alg in webauthn.ALGORITHMS],
            'authenticatorSelection':{'residentKey':'required','requireResidentKey':True,'userVerification':'required'},
            'attestation':'none','timeout':CHALLENGE_MINUTES*60*1000,
            'excludeCredentials':[{'type':'public-key','id':p['credential_id']} for p in existing]}


def add_passkey(req):
    """Register the credential the browser made; the attestation statement is ignored (none was asked for)."""
    session,body = req.customer,req.body
    name = schema.passkey_name(body)
    credential = schema.credential(body)
    value,row = _take_challenge(req,credential,'register')
    require(row['account_id']==session['account_id'],STALE,403)
    found = webauthn.verify_registration(credential,value,row['origin'],row['rp_id'])
    existing = repository.passkey_by_credential(req.cd,found['credential_id'])
    require(not existing,'Passkey นี้ถูกเพิ่มไว้แล้ว',409)
    found['transports_json'] = json.dumps(found['transports'])
    label = name or schema.device_name(client_info(req)['user_agent'])
    repository.insert_passkey(req.cd,uid(),session['account_id'],found,label)
    record(req.cd,session['account_id'],'passkey_added',label,client_info(req))
    req.cd.commit()
    return {'ok':True,'passkeys':[schema.passkey_view(p) for p in repository.passkeys(req.cd,session['account_id'])]}


def rename_passkey(req, passkey_id):
    row = repository.passkey(req.cd,req.customer['account_id'],passkey_id)
    require(row,'ไม่พบ Passkey นี้',404)
    name = schema.passkey_name(req.body,required=True)
    repository.rename_passkey(req.cd,row['id'],name)
    record(req.cd,req.customer['account_id'],'passkey_renamed',name,client_info(req))
    req.cd.commit()
    return {'ok':True,'passkeys':[schema.passkey_view(p) for p in repository.passkeys(req.cd,req.customer['account_id'])]}


def remove_passkey(req, passkey_id):
    """Removing one needs the account's password, or a code when two-factor sign-in is on: a borrowed screen must
    not be able to take the owner's way back in."""
    session = req.customer
    row = repository.passkey(req.cd,session['account_id'],passkey_id)
    require(row,'ไม่พบ Passkey นี้',404)
    prove_owner(req.cd,session['account_id'],req.body)
    repository.delete_passkey(req.cd,row['id'])
    record(req.cd,session['account_id'],'passkey_removed',row['name'],client_info(req))
    req.cd.commit()
    return {'ok':True,'passkeys':[schema.passkey_view(p) for p in repository.passkeys(req.cd,session['account_id'])]}


def login_options(req):
    """What navigator.credentials.get() is called with. No account is named: the passkey itself says who it is."""
    value,_origin_text,rp_id = _issue_challenge(req,'login')
    return {'challenge':value,'rpId':rp_id,'userVerification':'required','allowCredentials':[],
            'timeout':CHALLENGE_MINUTES*60*1000}


def passkey_login(req):
    """Sign in with a passkey. It verified the user on the device, so it counts as both factors: no second step."""
    credential = schema.credential(req.body)
    client = client_info(req)
    value,row = _take_challenge(req,credential,'login')
    given = credential.get('id') or credential.get('rawId')
    require(isinstance(given,str) and 0<len(given)<=2048,webauthn.BAD)
    stored = repository.passkey_by_credential(req.cd,given.rstrip('='))
    require(stored,'ไม่พบ Passkey นี้ กรุณาเข้าสู่ระบบด้วยรหัสผ่าน',403)
    try:
        count = webauthn.verify_assertion(credential,value,row['origin'],row['rp_id'],stored)
    except APIError:
        # Every refusal is written down: a copied credential, a wrong origin or a bad signature is worth seeing.
        record(req.cd,stored['account_id'],'passkey_refused',stored['name'],client)
        req.cd.commit()
        raise
    from backend.modules.customers import service as accounts
    D.begin(req.cd)
    repository.use_passkey(req.cd,stored['id'],count)
    session = accounts.start_session(req.cd,stored['account_id'],client)
    record(req.cd,stored['account_id'],'login_passkey',stored['name'],client)
    req.cd.commit()
    return session


# Signed-in devices
def sessions(cd, session):
    found = customers.sessions_of(cd,session['account_id'])
    cd.commit()
    return {'sessions':[schema.session_view(row,session['token_hash']) for row in found]}


def revoke_session(req, session_id):
    removed = customers.delete_session_by_id(req.cd,req.customer['account_id'],session_id)
    require(removed,'ไม่พบอุปกรณ์นี้',404)
    record(req.cd,req.customer['account_id'],'session_revoked',client=client_info(req))
    req.cd.commit()
    return sessions(req.cd,req.customer)


def sign_out_all(req):
    """Sign out everywhere; keep_current false signs this browser out too (the caller clears the cookie)."""
    keep = schema.keep_current(req.body)
    if keep:
        customers.delete_other_sessions(req.cd,req.customer['account_id'],req.customer['token_hash'])
    else:
        customers.delete_sessions(req.cd,req.customer['account_id'])
    record(req.cd,req.customer['account_id'],'sessions_revoked',client=client_info(req))
    req.cd.commit()
    return {'ok':True,'kept_current':keep}


# The account's history
def activity(cd, session, page):
    """Newest first, a page at a time: what happened to the account (a year of it)."""
    account_id = session['account_id']
    repository.purge_activity(cd,after(days=-ACTIVITY_KEEP_DAYS))
    cd.commit()
    start,total = page*ACTIVITY_PAGE,repository.count_activity(cd,account_id)
    return {'items':[schema.activity_view(row) for row in repository.activity(cd,account_id,ACTIVITY_PAGE,start)],'page':page,
            'has_more':total>start+ACTIVITY_PAGE,'total':total}
