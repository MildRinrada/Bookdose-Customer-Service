"""HTTP handlers of a staff member's working preferences ('account': the member's own, in any organization)."""
from backend.middleware.rate_limit import limited
from backend.modules.staff_prefs import service


def preferences(req):
    return req.send(200,service.view(req.cd,req.session['user_id']))


def save(req):
    limited(('staff-prefs',req.session['user_id']),120,900)
    return req.send(200,service.save(req.cd,req.session,req.body))


def set_status(req):
    """POST /api/account/status {status}: the quick switch in the top bar."""
    limited(('staff-prefs',req.session['user_id']),120,900)
    return req.send(200,service.save(req.cd,req.session,{'status':req.body.get('status')}))


def test_email(req):
    limited(('staff-prefs-mail',req.session['user_id']),3,900)
    return req.send(200,service.test_email(req.cd,req.session))
