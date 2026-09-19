"""Two-factor sign-in and passkeys of staff accounts (model.py has the tables and the rules they follow), and the one
passkey sign-in of the shared sign-in page, which recognizes a staff passkey and a customer passkey alike."""
import hmac
import json
import secrets

from backend.database import audit, db as D
from backend.exceptions.errors import APIError
from backend.modules.customer_security import repository as customer_repository, schema, service as customer, totp, webauthn
from backend.modules.staff_security import repository
from backend.modules.staff_security.model import (ACTIVITY_KEEP_DAYS, ACTIVITY_PAGE, CHALLENGE_MINUTES,
                                                  LOGIN_CHALLENGE_MINUTES, LOGIN_CHALLENGE_TRIES, RECOVERY_ALPHABET,
                                                  RECOVERY_COUNT, RECOVERY_GROUP, TOTP_ISSUER)
from backend.utils.dates import after
from backend.utils.security import password_ok, token_hash, uid
from backend.utils.validation import existing_password, require

WRONG_STEP = customer.WRONG_STEP
STALE = customer.STALE
NO_SESSION = customer.NO_SESSION
client_info = customer.client_info


def _user(cd, user_id):
    return D.one(cd,'SELECT * FROM users WHERE id=?',(user_id,))


def note(cd, user_id, action, detail='', client=None):
    """One line in the account's own history (ตั้งค่าบัญชี → ความปลอดภัย): what happened, from which address and
    browser - never a code or a token. The caller commits."""
    client = client or {}
    repository.insert_activity(cd,uid(),user_id,action,(detail or '')[:200],client.get('ip',''),client.get('user_agent',''))


def _record(cd, user_id, action, detail='', client=None):
    audit.record(cd,user_id,'account.'+action,user_id,detail)
    note(cd,user_id,action,detail,client)


# State
def two_factor_on(cd, user_id):
    row = repository.totp(cd,user_id)
    return bool(row and row['confirmed_at'])


def methods(cd, user_id):
    found = ['totp'] if two_factor_on(cd,user_id) else []
    if found and any(code['used_at'] is None for code in repository.recovery_codes(cd,user_id)):
        found.append('recovery')
    return found


def protected(cd, user_id):
    """The account has a second factor or a passkey (the platform console reminds a platform admin without one)."""
    return two_factor_on(cd,user_id) or bool(repository.passkeys(cd,user_id))


def overview(cd, session):
    user_id = session['user_id']
    row = repository.totp(cd,user_id)
    codes = repository.recovery_codes(cd,user_id)
    return {'two_factor':{'enabled':bool(row and row['confirmed_at']),'pending':bool(row and not row['confirmed_at']),
                          'confirmed_at':row['confirmed_at'] if row else None},
            'recovery':{'left':sum(1 for c in codes if c['used_at'] is None),'total':len(codes)},
            'passkeys':[schema.passkey_view(p) for p in repository.passkeys(cd,user_id)]}


# Turning it on and off
def prove_owner(cd, user_id, body):
    user = _user(cd,user_id)
    require(user,NO_SESSION,401)
    if body.get('code') or body.get('recovery_code'):
        require(_second_step_ok(cd,user_id,body),WRONG_STEP,403)
    else:
        require(password_ok(existing_password(body),user['password']),'รหัสผ่านไม่ถูกต้อง',403)
    return user


def setup_totp(cd, session, body):
    require(not two_factor_on(cd,session['user_id']),'เปิดการยืนยันสองขั้นตอนไว้แล้ว หากต้องการตั้งใหม่ให้ปิดก่อน',409)
    prove_owner(cd,session['user_id'],body)
    secret = totp.new_secret()
    repository.start_totp(cd,session['user_id'],secret)
    cd.commit()
    uri = totp.uri(secret,session['email'],TOTP_ISSUER)
    return {'secret':secret,'otpauth_uri':uri,'qr':customer._qr(uri)}


def confirm_totp(cd, session, body, client=None):
    entered = schema.code(body)
    D.begin(cd)
    row = repository.totp(cd,session['user_id'])
    require(row and not row['confirmed_at'],'ยังไม่ได้เริ่มตั้งค่าการยืนยันสองขั้นตอน กรุณาเริ่มใหม่',409)
    step = totp.check(row['secret'],entered,row['last_step'])
    require(step and repository.confirm_totp(cd,session['user_id'],step)==1,WRONG_STEP,403)
    codes = _new_recovery_codes(cd,session['user_id'])
    _record(cd,session['user_id'],'totp_on',client=client)
    cd.commit()
    return {'ok':True,'recovery_codes':codes}


def disable_totp(cd, session, body, client=None):
    password = existing_password(body)
    D.begin(cd)
    user = _user(cd,session['user_id'])
    require(password_ok(password,user['password']),'รหัสผ่านไม่ถูกต้อง',403)
    require(two_factor_on(cd,user['id']),'ยังไม่ได้เปิดการยืนยันสองขั้นตอน',409)
    require(_second_step_ok(cd,user['id'],body),WRONG_STEP,403)
    repository.delete_totp(cd,user['id'])
    repository.delete_recovery_codes(cd,user['id'])
    _record(cd,user['id'],'totp_off',client=client)
    cd.commit()
    return {'ok':True}


def new_recovery_codes(cd, session, body, client=None):
    password = existing_password(body)
    D.begin(cd)
    user = _user(cd,session['user_id'])
    require(password_ok(password,user['password']),'รหัสผ่านไม่ถูกต้อง',403)
    require(two_factor_on(cd,user['id']),'ยังไม่ได้เปิดการยืนยันสองขั้นตอน',409)
    codes = _new_recovery_codes(cd,user['id'])
    _record(cd,user['id'],'recovery_new',client=client)
    cd.commit()
    return {'ok':True,'recovery_codes':codes}


def _new_recovery_codes(cd, user_id):
    codes = []
    for _ in range(RECOVERY_COUNT):
        letters = ''.join(secrets.choice(RECOVERY_ALPHABET) for _ in range(2*RECOVERY_GROUP))
        codes.append(f'{letters[:RECOVERY_GROUP]}-{letters[RECOVERY_GROUP:]}')
    repository.replace_recovery_codes(cd,user_id,[(uid(),token_hash(c.replace('-',''))) for c in codes])
    return codes


def _second_step_ok(cd, user_id, body):
    kind,entered = schema.second_step(body)
    if kind=='recovery':
        wanted,found = token_hash(entered),None
        for row in repository.recovery_codes(cd,user_id):
            if row['used_at'] is None and hmac.compare_digest(row['code_hash'],wanted):
                found = row
        return bool(found) and repository.use_recovery_code(cd,found['id'])==1
    row = repository.totp(cd,user_id)
    if not row or not row['confirmed_at']:
        return False
    step = totp.check(row['secret'],entered,row['last_step'])
    return bool(step) and repository.use_totp_step(cd,user_id,step)==1


# The second step of a sign-in
def start_challenge(cd, user):
    """{'challenge','methods'} when this staff account asks for a second step, else None."""
    found = methods(cd,user['id'])
    if not found:
        return None
    token = secrets.token_urlsafe(32)
    repository.insert_login_challenge(cd,token_hash(token),user['id'],after(minutes=LOGIN_CHALLENGE_MINUTES))
    cd.commit()
    return {'challenge':token,'methods':found}


def finish_challenge(cd, cookie_header, token, body, client=None):
    """The second step: the new session token when the code is right. Five wrong tries and the challenge is thrown
    away; each wrong code counts towards the locks of the account's email, like a wrong password."""
    from backend.modules.auth import service as auth
    from backend.modules.security import lockout
    kind,_ = schema.second_step(body)
    require(isinstance(token,str) and token,NO_SESSION,401)
    row = repository.login_challenge(cd,token_hash(token))
    require(row,NO_SESSION,401)
    user = _user(cd,row['user_id'])
    keys = [lockout.key_for('staff',user['email']),lockout.key_for('signin',user['email'])] if user else []
    for key in keys:
        lockout.check(key,client)
    actor = 'platform' if user and user['platform_admin'] else 'staff'
    D.begin(cd)
    repository.count_login_attempt(cd,token_hash(token))
    if not user or not _second_step_ok(cd,user['id'],body):
        if row['attempts']+1>=LOGIN_CHALLENGE_TRIES:
            repository.delete_login_challenge(cd,token_hash(token))
        cd.commit()
        if user:
            lockout.fail(keys[0],client,kind='twofa_failed',actor=actor,owner={'email':user['email'],'name':user['name']},
                         detail={'method':kind})
        require(False,WRONG_STEP,403)
    require(repository.delete_login_challenge(cd,token_hash(token))==1,NO_SESSION,401)
    _record(cd,user['id'],'login_2fa' if kind=='code' else 'login_recovery',client=client)
    cd.commit()
    session_token = auth.replace_session(cd,cookie_header,user['id'],client,login=None)
    for key in keys:
        lockout.succeed(key,client,actor=actor)
    return session_token


# Passkeys of the account
def passkey_options(req):
    session = req.session
    prove_owner(req.cd,session['user_id'],req.body)
    origin,rp_id = customer._origin(req)
    value = webauthn.b64url(secrets.token_bytes(32))
    repository.insert_challenge(req.cd,token_hash(value),session['user_id'],'register',rp_id,origin,after(minutes=CHALLENGE_MINUTES))
    req.cd.commit()
    return {'challenge':value,'rp':{'id':rp_id,'name':TOTP_ISSUER},
            'user':{'id':webauthn.b64url(bytes.fromhex(session['user_id'])),'name':session['email'],'displayName':session['name']},
            'pubKeyCredParams':[{'type':'public-key','alg':alg} for alg in webauthn.ALGORITHMS],
            'authenticatorSelection':{'residentKey':'required','requireResidentKey':True,'userVerification':'required'},
            'attestation':'none','timeout':CHALLENGE_MINUTES*60*1000,
            'excludeCredentials':[{'type':'public-key','id':p['credential_id']} for p in repository.passkeys(req.cd,session['user_id'])]}


def add_passkey(req):
    session = req.session
    name = schema.passkey_name(req.body)
    credential = schema.credential(req.body)
    value = webauthn.claimed_challenge(credential)
    row = repository.find_challenge(req.cd,token_hash(value),'register')
    require(row and repository.take_challenge(req.cd,token_hash(value))==1 and row['user_id']==session['user_id'],STALE,403)
    req.cd.commit()
    _,rp_id = customer._origin(req)
    require(rp_id==row['rp_id'],'คำขอมาจากที่อยู่อื่น กรุณาเปิดจากหน้าเว็บของระบบโดยตรง',403)
    found = webauthn.verify_registration(credential,value,row['origin'],row['rp_id'])
    require(not repository.passkey_by_credential(req.cd,found['credential_id']) and
            not customer_repository.passkey_by_credential(req.cd,found['credential_id']),'Passkey นี้ถูกเพิ่มไว้แล้ว',409)
    found['transports_json'] = json.dumps(found['transports'])
    label = name or schema.device_name((req.headers.get('User-Agent') or '')[:300])
    repository.insert_passkey(req.cd,uid(),session['user_id'],found,label)
    _record(req.cd,session['user_id'],'passkey_added',label,client_info(req))
    req.cd.commit()
    return {'ok':True,'passkeys':[schema.passkey_view(p) for p in repository.passkeys(req.cd,session['user_id'])]}


def rename_passkey(req, passkey_id):
    row = repository.passkey(req.cd,req.session['user_id'],passkey_id)
    require(row,'ไม่พบ Passkey นี้',404)
    name = schema.passkey_name(req.body,required=True)
    repository.rename_passkey(req.cd,row['id'],name)
    note(req.cd,req.session['user_id'],'passkey_renamed',name,client_info(req))
    req.cd.commit()
    return {'ok':True,'passkeys':[schema.passkey_view(p) for p in repository.passkeys(req.cd,req.session['user_id'])]}


def remove_passkey(req, passkey_id):
    session = req.session
    row = repository.passkey(req.cd,session['user_id'],passkey_id)
    require(row,'ไม่พบ Passkey นี้',404)
    prove_owner(req.cd,session['user_id'],req.body)
    repository.delete_passkey(req.cd,row['id'])
    _record(req.cd,session['user_id'],'passkey_removed',row['name'],client_info(req))
    req.cd.commit()
    return {'ok':True,'passkeys':[schema.passkey_view(p) for p in repository.passkeys(req.cd,session['user_id'])]}


# The shared sign-in page: one passkey button for staff and customers
def sign_in_options(req):
    """One challenge for either kind of passkey: kept (hashed) for both kinds, and taken from both when answered."""
    origin,rp_id = customer._origin(req)
    value = webauthn.b64url(secrets.token_bytes(32))
    expires = after(minutes=CHALLENGE_MINUTES)
    repository.insert_challenge(req.cd,token_hash(value),'','login',rp_id,origin,expires)
    customer_repository.insert_challenge(req.cd,token_hash(value),'','login',rp_id,origin,expires)
    req.cd.commit()
    return {'challenge':value,'rpId':rp_id,'userVerification':'required','allowCredentials':[],'timeout':CHALLENGE_MINUTES*60*1000}


def passkey_sign_in(req):
    """('staff', session token) for a staff passkey; for a customer passkey the customer's own passkey sign-in runs
    (customer_security.passkey_login) and ('customer', session) comes back."""
    credential = schema.credential(req.body)
    given = credential.get('id') or credential.get('rawId')
    require(isinstance(given,str) and 0<len(given)<=2048,webauthn.BAD)
    stored = repository.passkey_by_credential(req.cd,given.rstrip('='))
    value = webauthn.claimed_challenge(credential)
    if not stored:
        # A customer's passkey (or none): the staff copy of the challenge goes, the customer's is used there.
        repository.take_challenge(req.cd,token_hash(value))
        req.cd.commit()
        return 'customer',customer.passkey_login(req)
    from backend.modules.auth import service as auth
    from backend.modules.security import lockout
    row = repository.find_challenge(req.cd,token_hash(value),'login')
    taken = repository.take_challenge(req.cd,token_hash(value))
    customer_repository.take_challenge(req.cd,token_hash(value))
    req.cd.commit()
    require(row and taken==1,STALE,403)
    _,rp_id = customer._origin(req)
    require(rp_id==row['rp_id'],'คำขอมาจากที่อยู่อื่น กรุณาเปิดจากหน้าเว็บของระบบโดยตรง',403)
    user = _user(req.cd,stored['user_id'])
    client = customer.client_info(req)
    keys = [lockout.key_for('staff',user['email']),lockout.key_for('signin',user['email'])]
    for key in keys:
        lockout.check(key,client)
    actor = 'platform' if user['platform_admin'] else 'staff'
    try:
        count = webauthn.verify_assertion(credential,value,row['origin'],row['rp_id'],stored)
    except APIError:
        _record(req.cd,user['id'],'passkey_refused',stored['name'],client)
        req.cd.commit()
        lockout.fail(keys[0],client,actor=actor,owner={'email':user['email'],'name':user['name']},detail={'method':'passkey'})
        raise
    repository.use_passkey(req.cd,stored['id'],count)
    _record(req.cd,user['id'],'login_passkey',stored['name'],client)
    req.cd.commit()
    token = auth.replace_session(req.cd,req.headers.get('Cookie',''),user['id'],client,login=None)
    for key in keys:
        lockout.succeed(key,client,actor=actor)
    return 'staff',token


def forget_passkeys(cd, user_id, client=None):
    """A password reset is a clean slate: the passkeys go with the old password, because a key added from a borrowed
    screen would otherwise outlive every remedy the owner has. The caller commits."""
    if repository.delete_passkeys(cd,user_id):
        _record(cd,user_id,'passkeys_cleared',client=client)


# The devices signed in to the account, and its history
def sessions(cd, session):
    """Every live session of the account, the one asking marked `current`."""
    from backend.modules.auth.service import session_actor
    from backend.modules.security import sessions as limits
    seconds = limits.limits(cd,session_actor(session))
    from backend.modules.auth import repository as auth_repository, service as auth
    found = [row for row in repository.sessions_of(cd,session['user_id'])
             if not limits.expired_reason(row['created_at'],row['last_active_at'],seconds,row['expires_at'])]

    def shared(row):
        # The other accounts signed in on that same browser (the account switcher), so the owner sees who shares it.
        return [{'name':other['name'],'email':other['email'],'since':other['created_at']}
                for other in auth_repository.browser_sessions(cd,auth.browser_of(row))
                if other['user_id']!=session['user_id'] and auth._live(cd,other)]
    return {'sessions':[{'id':row['id'],'device':schema.device_name(row['user_agent']),'user_agent':row['user_agent'],
                         'ip':row['ip'],'created_at':row['created_at'],'last_seen_at':row['last_active_at'] or row['created_at'],
                         'expires_at':row['expires_at'],'current':row['token']==session['token'],'shared_with':shared(row)}
                        for row in found]}


def revoke_session(req, session_id):
    session = req.session
    require(repository.delete_session_by_id(req.cd,session['user_id'],session_id,session['token']),'ไม่พบอุปกรณ์นี้',404)
    note(req.cd,session['user_id'],'session_revoked',client=client_info(req))
    req.cd.commit()
    return sessions(req.cd,session)


def sign_out_all(req):
    """Sign out everywhere; keep_current false signs this browser out too (the caller clears the cookie)."""
    from backend.modules.auth import repository as auth_repository
    session = req.session
    keep = schema.keep_current(req.body)
    if keep:
        repository.delete_other_sessions(req.cd,session['user_id'],session['token'])
    else:
        auth_repository.delete_user_sessions(req.cd,session['user_id'])
    note(req.cd,session['user_id'],'sessions_revoked',client=client_info(req))
    req.cd.commit()
    return {'ok':True,'kept_current':keep}


def activity(cd, session, page):
    """Newest first, a page at a time: what happened to the account (a year of it)."""
    user_id = session['user_id']
    repository.purge_activity(cd,after(days=-ACTIVITY_KEEP_DAYS))
    cd.commit()
    start,total = page*ACTIVITY_PAGE,repository.count_activity(cd,user_id)
    return {'items':[{**schema.activity_view(row),'org_name':''} for row in repository.activity(cd,user_id,ACTIVITY_PAGE,start)],
            'page':page,'has_more':total>start+ACTIVITY_PAGE,'total':total}


# The server owner's way back in
def reset_account(email):
    """Remove every second factor and passkey of a staff account (someone lost their phone and their recovery codes).
    Only from the server: python -m backend.modules.staff_security reset <email>."""
    with D.control() as cd:
        user = D.one(cd,'SELECT id FROM users WHERE email=?',(email,))
        if not user:
            return False
        repository.delete_everything(cd,user['id'])
        audit.record(cd,'ระบบ','account.security_reset',user['id'])
        cd.execute('DELETE FROM sessions WHERE user_id=?',(user['id'],))
    return True
