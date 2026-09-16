"""HTTP handlers of the customer account's security (/api/customer/security/... , the second step of a sign-in and
the passkey sign-in). req.cd is the control database and req.customer the signed-in customer; the routes that answer
before anyone is signed in are limited per address, like the other customer sign-in routes."""
from http import cookies

from backend.middleware.rate_limit import limited
from backend.modules.customer_security import schema, service
from backend.modules.customers.controller import session_cookie, signed_in
from backend.modules.customers.service import SESSION_SECONDS


def challenge_token(req):
    """The waiting-second-step cookie of this browser, or '' when there is none."""
    jar = cookies.SimpleCookie()
    try:
        jar.load(req.headers.get('Cookie',''))
    except cookies.CookieError:
        return ''
    found = jar.get(service.CHALLENGE_COOKIE)
    return found.value if found else ''


def verify_login(req):
    """POST /api/customer/login/verify: the code from the authenticator app, or a recovery code. The answer replaces
    the cookie with the session's; the challenge cookie that is left behind names a row that no longer exists and
    runs out in five minutes anyway."""
    limited(('customer-2fa',req.ip),20,900)
    result = service.finish_challenge(req.cd,challenge_token(req),req.body,service.client_info(req))
    signed_in(req,result['session'])
    return req.send(200,{'ok':True,'signed_in':True},headers=session_cookie(req,result['session'],SESSION_SECONDS))


# Two-factor sign-in
def state(req):
    return req.send(200,service.overview(req.cd,req.customer))


def totp_setup(req):
    limited(('customer-2fa-setup',req.customer['account_id']),10,900)
    return req.send(201,service.setup_totp(req.cd,req.customer,req.body))


def totp_confirm(req):
    limited(('customer-2fa-setup',req.customer['account_id']),20,900)
    return req.send(200,service.confirm_totp(req.cd,req.customer,req.body,service.client_info(req)))


def totp_disable(req):
    limited(('customer-2fa-setup',req.customer['account_id']),10,900)
    return req.send(200,service.disable_totp(req.cd,req.customer,req.body,service.client_info(req)))


def recovery_codes(req):
    limited(('customer-2fa-setup',req.customer['account_id']),10,900)
    return req.send(200,service.new_recovery_codes(req.cd,req.customer,req.body,service.client_info(req)))


# Passkeys
def passkeys(req):
    return req.send(200,{'passkeys':service.overview(req.cd,req.customer)['passkeys']})


def passkey_options(req):
    limited(('customer-passkey',req.customer['account_id']),20,900)
    return req.send(201,service.passkey_options(req))


def passkey_add(req):
    limited(('customer-passkey',req.customer['account_id']),20,900)
    return req.send(201,service.add_passkey(req))


def passkey_rename(req, passkey_id):
    return req.send(200,service.rename_passkey(req,passkey_id))


def passkey_remove(req, passkey_id):
    limited(('customer-passkey',req.customer['account_id']),20,900)
    return req.send(200,service.remove_passkey(req,passkey_id))


def passkey_login_options(req):
    limited(('customer-passkey-login',req.ip),30,900)
    return req.send(201,service.login_options(req))


def passkey_login(req):
    limited(('customer-passkey-login',req.ip),15,900)
    session = service.passkey_login(req)
    signed_in(req,session)
    return req.send(200,{'ok':True,'signed_in':True},headers=session_cookie(req,session,SESSION_SECONDS))


# Signed-in devices and the account's history
def sessions(req):
    return req.send(200,service.sessions(req.cd,req.customer))


def revoke_session(req, session_id):
    return req.send(200,service.revoke_session(req,session_id))


def sign_out_all(req):
    """Signing out everywhere without keeping this browser also clears its cookie."""
    result = service.sign_out_all(req)
    if result['kept_current']:
        return req.send(200,result)
    return req.send(200,result,headers=session_cookie(req,'',0))


def activity(req):
    return req.send(200,service.activity(req.cd,req.customer,schema.page(req.query)))
