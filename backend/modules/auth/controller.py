"""HTTP handlers for setup, sign-in, self-registration, bootstrap and the signed-in user's account."""
from backend.middleware.rate_limit import limited
from backend.modules.auth import service


def session_cookie(req, token):
    return {'Set-Cookie':f'{service.SESSION_COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={service.SESSION_HOURS*3600}'+('; Secure' if req.server.secure_cookies else '')}


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
    return req.send(200,{'ok':True},headers=session_cookie(req,service.log_in(cookie(req),req.body)))


def bootstrap(req):
    return req.send(200,service.bootstrap_data(req.cd,req.session))


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
