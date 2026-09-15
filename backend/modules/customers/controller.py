"""HTTP handlers for customer accounts (/api/customer/...). req.cd is the control database; req.customer is the
signed-in customer on 'customer-account' routes. What a customer does inside one organization (chats, cases) is in
backend/modules/portal (/api/public/<organization code>/...)."""
from backend.middleware.rate_limit import limited
from backend.modules.customers import dashboard as project_dashboard, line, service


def _cookie(req, token, max_age):
    """The customer's session cookie: sent only to the API, never readable by page scripts."""
    return {'Set-Cookie':f"{service.SESSION_COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age={max_age}"
            +('; Secure' if req.server.secure_cookies else '')}


def _signed_in(req, token, status=200):
    return req.send(status,{'ok':True,'signed_in':True},headers=_cookie(req,token,service.SESSION_SECONDS))


def _limit(req, action, count):
    limited((action,req.ip),count,900)


def account(req):
    """Who is signed in; {'signed_in': False} for a visitor (the page asks on every load)."""
    return req.send(200,service.account_view(service.read_session(req.cd,req.headers.get('Cookie',''))))


def register(req):
    """202 when an email link must confirm the sign-up; 201 and signed in when email is not set up yet."""
    _limit(req,'customer-mail',5)
    session = service.register(req.cd,req.body)
    if session:
        return _signed_in(req,session,201)
    return req.send(202,{'ok':True,'verification_required':True})


def resend(req):
    _limit(req,'customer-mail',5)
    service.resend(req.cd,req.body)
    return req.send(202,{'ok':True})


def verify(req):
    _limit(req,'customer-verify',20)
    return _signed_in(req,service.verify(req.cd,req.body),201)


def log_in(req):
    _limit(req,'customer-login',15)
    return _signed_in(req,service.log_in(req.cd,req.body))


def forgot(req):
    _limit(req,'customer-mail',5)
    service.forgot(req.cd,req.body)
    return req.send(202,{'ok':True})


def reset(req):
    _limit(req,'customer-verify',20)
    return _signed_in(req,service.reset_password(req.cd,req.body))


def log_out(req):
    service.log_out(req.cd,req.customer)
    return req.send(200,{'ok':True},headers=_cookie(req,'',0))


def update_profile(req):
    service.update_profile(req.cd,req.customer,req.body)
    return req.send(200,{'ok':True})


def change_password(req):
    _limit(req,'customer-password',10)
    service.change_password(req.cd,req.customer,req.body)
    return req.send(200,{'ok':True})


def update_notifications(req):
    service.set_notifications(req.cd,req.customer,req.body)
    return req.send(200,{'ok':True})


def notification_settings(req):
    return req.send(200,service.notification_settings(req.cd,req.customer))


def save_notification_settings(req):
    service.save_notification_settings(req.cd,req.customer,req.body)
    return req.send(200,service.notification_settings(req.cd,req.customer))


# LINE of one organization (/api/public/<code>/line: req.org, req.db)
def line_status(req):
    return req.send(200,line.status(req.db,req.org,req.customer))


def line_code(req):
    # A code is a guessable secret while it lives: few per account and address.
    _limit(req,'customer-line',10)
    limited(('customer-line',req.customer['account_id']),5,900)
    return req.send(201,line.new_code(req.db,req.org,req.customer))


def line_unlink(req):
    line.unlink(req.db,req.customer)
    return req.send(200,{'ok':True})


def my_organizations(req):
    return req.send(200,{'organizations':service.organizations(req.cd,req.customer)})


def join_organization(req):
    _limit(req,'customer-join',30)
    return req.send(201,{'organization':service.join_by_code(req.cd,req.customer,req.body)})


def overview(req):
    return req.send(200,service.overview(req.cd,req.customer))


def dashboard(req):
    return req.send(200,project_dashboard.build(req.cd,req.customer))


def faq(req):
    return req.send(200,service.faq(req.cd,req.customer))
