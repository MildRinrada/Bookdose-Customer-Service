"""HTTP handlers for setup, sign-in, self-registration, bootstrap and the signed-in user's account."""
from backend.middleware.rate_limit import limited
from backend.modules.auth import service


def session_cookie(req, token):
    from backend.database import db as D
    with D.control() as cd:
        max_age = service.cookie_max_age(cd)
    return {'Set-Cookie':f'{service.SESSION_COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={max_age}'+('; Secure' if req.server.secure_cookies else '')}


def client(req):
    """The caller's trusted address and browser (security events and the lockout)."""
    return {'ip':req.ip,'user_agent':(req.headers.get('User-Agent') or '')[:300]}


def cookie(req):
    return req.headers.get('Cookie','')


def register(req):
    limited(('register',req.ip),5,900)
    service.request_registration(cookie(req),req.body,resend=False,client=client(req))
    return req.send(202,{'ok':True,'verification_required':True})


def resend_registration(req):
    limited(('register',req.ip),5,900)
    service.request_registration(cookie(req),req.body,resend=True)
    return req.send(202,{'ok':True,'verification_required':True})


def verify_registration(req):
    limited(('verify',req.ip),20,900)
    return req.send(201,{'ok':True},headers=session_cookie(req,service.verify_registration(cookie(req),req.body,client(req))))


def forgot_password(req):
    """POST /api/forgot-password {email}: 202 whether or not the address has a staff account."""
    limited(('forgot',req.ip),5,900)
    service.forgot_password(req.body,client(req))
    return req.send(202,{'ok':True})


def reset_password(req):
    """POST /api/reset-password {token, password}: the new password is set; the page then signs in with it."""
    limited(('reset',req.ip),10,900)
    return req.send(200,{'ok':True,**service.reset_password(req.body,client(req))})


def set_up(req):
    limited(('login',req.ip),15,900)
    return req.send(200,{'ok':True},headers=session_cookie(req,service.set_up_platform(cookie(req),req.body,client(req))))


def challenge_cookie(req, token, max_age=None):
    """The waiting second step of a staff sign-in (HttpOnly; the page never sees it)."""
    from backend.modules.staff_security.model import CHALLENGE_COOKIE, LOGIN_CHALLENGE_MINUTES
    age = LOGIN_CHALLENGE_MINUTES*60 if max_age is None else max_age
    return f'{CHALLENGE_COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/api/; Max-Age={age}'+('; Secure' if req.server.secure_cookies else '')


def staff_result(req, result, extra=None):
    """Answer a staff password sign-in: the session cookie, or the second step's cookie and its methods."""
    if isinstance(result,dict):
        return req.send(200,{'ok':True,**(extra or {}),'two_factor':True,'methods':result['methods']},
                        headers={'Set-Cookie':challenge_cookie(req,result['challenge'])})
    return req.send(200,{'ok':True,**(extra or {})},headers=session_cookie(req,result))


def log_in(req):
    limited(('login',req.ip),15,900)
    return staff_result(req,service.log_in(cookie(req),req.body,client(req)))


def sign_in(req):
    """POST /api/sign-in {email, password}: the shared sign-in page, staff and customers alike (service.sign_in).
    Staff: 200 {ok, kind:'staff'} and the staff session cookie, as POST /api/login. Customer: what POST /api/customer/login
    answers - {ok, kind:'customer', signed_in} and the customer session cookie, or {ok, kind:'customer', two_factor,
    methods} and the second-step cookie."""
    from backend.database import db as D
    from backend.modules.customers import controller as customers
    limited(('login',req.ip),15,900)
    with D.control() as cd:
        req.cd = cd
        kind,result = service.sign_in(cd,cookie(req),req.body,client(req))
        if kind=='staff':
            return staff_result(req,result,{'kind':'staff'})
        return customers.finish(req,result,extra={'kind':'customer'})


def bootstrap(req):
    data = service.bootstrap_data(req.cd,req.session)
    if req.session:
        from backend.modules.platform import health
        data.update(service.session_times(req.cd,req.session))
        # The platform's message to every organization's staff (planned downtime and the like), while it lasts.
        data['announcement'] = health.active_announcement(req.cd,'staff')
    elif getattr(req,'session_expired',None):
        # The cookie named a session that has just run out: the page can say why it is signed out.
        data['session_expired'] = req.session_expired
    return req.send(200,data)


def session_state(req):
    """GET /api/session: who is signed in and when the session runs out (reading it is not activity)."""
    session = req.session
    return req.send(200,{'user':{'id':session['user_id'],'name':session['name'],'email':session['email'],
                                 'platform_admin':bool(session['platform_admin'])},
                         'tenant_id':session['tenant_id'],**service.session_times(req.cd,session)})


def activity(req):
    """POST /api/session/activity: the page is really being used (the dispatcher already moved last_active_at, as for
    every change)."""
    return req.send(200,service.session_times(req.cd,req.session))


CLEAR = {'Set-Cookie':f'{service.SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'}


def log_out(req):
    """POST /api/logout: this account signs out. {switched: true} when another account signed in on this browser
    took over (its cookie is set); else the cookie is cleared."""
    token = service.end_session(req.cd,req.session,client(req))
    if token:
        return req.send(200,{'ok':True,'switched':True},headers=session_cookie(req,token))
    return req.send(200,{'ok':True,'switched':False},headers=CLEAR)


# The account switcher: the accounts signed in on this browser.
def accounts(req):
    return req.send(200,service.browser_accounts(req.cd,req.session))


def switch_account(req):
    limited(('account-switch',req.session['user_id']),60,900)
    return req.send(200,{'ok':True},headers=session_cookie(req,service.switch_account(req.cd,req.session,req.body,client(req))))


def sign_out_account(req, account_id):
    return req.send(200,service.sign_out_account(req.cd,req.session,account_id,client(req)))


def sign_out_browser(req):
    service.sign_out_browser(req.cd,req.session,client(req))
    return req.send(200,{'ok':True},headers=CLEAR)


def switch_tenant(req):
    service.switch_tenant(req.cd,req.session,req.body)
    return req.send(200,{'ok':True})


def change_password(req):
    return req.send(200,{'ok':True},headers=session_cookie(req,service.change_password(req.cd,req.session,req.body,client(req))))


def update_profile(req):
    service.update_profile(req.cd,req.session,req.body,client(req))
    return req.send(200,{'ok':True})
