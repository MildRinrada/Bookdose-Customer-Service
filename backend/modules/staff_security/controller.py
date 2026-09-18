"""HTTP handlers of staff two-factor sign-in and passkeys: the second step of a staff sign-in and the shared passkey
sign-in ('public': nobody is signed in yet, limited per address), and the account's own settings ('account')."""
from http import cookies

from backend.database import db as D
from backend.middleware.rate_limit import limited
from backend.modules.auth.controller import challenge_cookie, client, session_cookie
from backend.modules.customer_security import schema
from backend.modules.staff_security import service
from backend.modules.staff_security.model import CHALLENGE_COOKIE


def _challenge_token(req):
    jar = cookies.SimpleCookie()
    try:
        jar.load(req.headers.get('Cookie',''))
    except cookies.CookieError:
        return ''
    found = jar.get(CHALLENGE_COOKIE)
    return found.value if found else ''


def verify_login(req):
    """POST /api/login/verify: the code from the authenticator app, or a recovery code, of a staff sign-in."""
    limited(('staff-2fa',req.ip),20,900)
    with D.control() as cd:
        token = service.finish_challenge(cd,req.headers.get('Cookie',''),_challenge_token(req),req.body,client(req))
    # The challenge cookie left behind names a row that no longer exists and runs out in five minutes anyway.
    return req.send(200,{'ok':True,'kind':'staff'},headers=session_cookie(req,token))


def sign_in_options(req):
    limited(('passkey-sign-in',req.ip),30,900)
    with D.control() as cd:
        req.cd = cd
        return req.send(201,service.sign_in_options(req))


def passkey_sign_in(req):
    """POST /api/sign-in/passkey: a staff passkey gets the staff session; a customer passkey the customer's."""
    from backend.modules.customers.controller import session_cookie as customer_cookie, signed_in
    from backend.modules.customers.service import cookie_max_age
    limited(('passkey-sign-in',req.ip),15,900)
    with D.control() as cd:
        req.cd = cd
        kind,result = service.passkey_sign_in(req)
        if kind=='staff':
            return req.send(200,{'ok':True,'kind':'staff'},headers=session_cookie(req,result))
        signed_in(req,result)
        return req.send(200,{'ok':True,'kind':'customer','signed_in':True},headers=customer_cookie(req,result,cookie_max_age(cd)))


# The account's own settings
def state(req):
    return req.send(200,service.overview(req.cd,req.session))


def totp_setup(req):
    limited(('staff-2fa-setup',req.session['user_id']),10,900)
    return req.send(201,service.setup_totp(req.cd,req.session,req.body))


def totp_confirm(req):
    limited(('staff-2fa-setup',req.session['user_id']),20,900)
    return req.send(200,service.confirm_totp(req.cd,req.session,req.body,client(req)))


def totp_disable(req):
    limited(('staff-2fa-setup',req.session['user_id']),10,900)
    return req.send(200,service.disable_totp(req.cd,req.session,req.body,client(req)))


def recovery_codes(req):
    limited(('staff-2fa-setup',req.session['user_id']),10,900)
    return req.send(200,service.new_recovery_codes(req.cd,req.session,req.body,client(req)))


def passkey_options(req):
    limited(('staff-passkey',req.session['user_id']),20,900)
    return req.send(201,service.passkey_options(req))


def passkey_add(req):
    limited(('staff-passkey',req.session['user_id']),20,900)
    return req.send(201,service.add_passkey(req))


def passkey_rename(req, passkey_id):
    return req.send(200,service.rename_passkey(req,passkey_id))


def passkey_remove(req, passkey_id):
    limited(('staff-passkey',req.session['user_id']),20,900)
    return req.send(200,service.remove_passkey(req,passkey_id))


# Signed-in devices and the account's history
def sessions(req):
    return req.send(200,service.sessions(req.cd,req.session))


def revoke_session(req, session_id):
    return req.send(200,service.revoke_session(req,session_id))


def sign_out_all(req):
    """Signing out everywhere without keeping this browser also clears its cookie."""
    from backend.modules.auth.service import SESSION_COOKIE
    result = service.sign_out_all(req)
    if result['kept_current']:
        return req.send(200,result)
    return req.send(200,result,headers={'Set-Cookie':f'{SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})


def activity(req):
    return req.send(200,service.activity(req.cd,req.session,schema.page(req.query)))
