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
    service.request_registration(cookie(req),req.body,resend=False)
    return req.send(202,{'ok':True,'verification_required':True})


def resend_registration(req):
    limited(('register',req.ip),5,900)
    service.request_registration(cookie(req),req.body,resend=True)
    return req.send(202,{'ok':True,'verification_required':True})


def verify_registration(req):
    limited(('verify',req.ip),20,900)
    return req.send(201,{'ok':True},headers=session_cookie(req,service.verify_registration(cookie(req),req.body)))


def set_up(req):
    limited(('login',req.ip),15,900)
    return req.send(200,{'ok':True},headers=session_cookie(req,service.set_up_platform(cookie(req),req.body)))


def log_in(req):
    limited(('login',req.ip),15,900)
    return req.send(200,{'ok':True},headers=session_cookie(req,service.log_in(cookie(req),req.body,client(req))))


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
            return req.send(200,{'ok':True,'kind':'staff'},headers=session_cookie(req,result))
        return customers.finish(req,result,extra={'kind':'customer'})


def bootstrap(req):
    data = service.bootstrap_data(req.cd,req.session)
    if req.session:
        data.update(service.session_times(req.cd,req.session))
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


def log_out(req):
    service.end_session(req.cd,req.session)
    return req.send(200,{'ok':True},headers={'Set-Cookie':f'{service.SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})


def switch_tenant(req):
    service.switch_tenant(req.cd,req.session,req.body)
    return req.send(200,{'ok':True})


def change_password(req):
    return req.send(200,{'ok':True},headers=session_cookie(req,service.change_password(req.cd,req.session,req.body)))


def update_profile(req):
    service.update_profile(req.cd,req.session,req.body)
    return req.send(200,{'ok':True})
