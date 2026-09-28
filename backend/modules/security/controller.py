"""HTTP handlers of the Superadmin security dashboard (every route requires a platform admin: access 'platform'), and
the platform admin's guards outside it: proving the password again (admin_guard) and the "ไม่ใช่ฉัน" link of a
sign-in mail (sign_in_alerts)."""
from backend.middleware.rate_limit import limited
from backend.modules.security import admin_guard, ip_intel, service, sign_in_alerts


def overview(req):
    return req.send(200,service.overview(req.cd,req.query))


def events(req):
    return req.send(200,service.list_events(req.cd,req.query))


def locks(req):
    return req.send(200,service.list_locks(req.cd))


def unlock(req):
    return req.send(200,service.unlock(req))


def alerts(req):
    return req.send(200,service.list_alerts(req.cd,req.query))


def acknowledge_alert(req, alert_id):
    return req.send(200,service.acknowledge(req,alert_id))


def ip_blocks(req):
    return req.send(200,service.list_blocks(req.cd))


def add_ip_block(req):
    return req.send(200,service.add_block(req))


def remove_ip_block(req):
    return req.send(200,service.remove_block(req))


def revoke_sessions(req):
    return req.send(200,service.revoke_sessions(req))


def settings(req):
    return req.send(200,service.get_settings(req.cd))


@admin_guard.confirm_first
def save_settings(req):
    return req.send(200,service.save_settings(req))


def honeytokens(req):
    return req.send(200,service.list_honeytokens(req.cd))


def create_honeytoken(req):
    return req.send(201,service.create_honeytoken(req))


def update_honeytoken(req, token_id):
    return req.send(200,service.update_honeytoken(req,token_id))


def delete_honeytoken(req, token_id):
    return req.send(200,service.delete_honeytoken(req,token_id))


def test_honeytoken(req, token_id):
    return req.send(200,service.test_honeytoken(req,token_id))


def checkup(req):
    """ตรวจสุขภาพความปลอดภัย (checkup.py). A copy on this machine with no public address is checked where the admin
    opened it: only localhost, so the Host a request names never sends the server elsewhere."""
    from backend.middleware.security import from_web_app
    from backend.modules.security import checkup as C
    host = req.headers.get('X-Forwarded-Host','') if from_web_app(req) else ''
    hint = 'http://'+host if host.split(':')[0] in C.LOCAL else ''
    return req.send(200,C.run(req.cd,hint))


# The platform admin's guards
def confirm_password(req):
    """POST /api/account/confirm-password: the password again before a dangerous act of the console."""
    limited(('confirm-password',req.session['id']),10,900)
    return req.send(200,admin_guard.confirm_password(req))


def sign_in_alert(req):
    """POST /api/sign-in-alerts/check: what a "ไม่ใช่ฉัน" link from a sign-in mail is about (no sign-in needed)."""
    from backend.database import db as D
    limited(('sign-in-alert',req.ip),30,900)
    with D.control() as cd:
        return req.send(200,sign_in_alerts.check(cd,req.body))


def disown_sign_in(req):
    """POST /api/sign-in-alerts/not-me: end the session that link names."""
    from backend.database import db as D
    from backend.modules.staff_security.service import client_info
    limited(('sign-in-alert',req.ip),30,900)
    with D.control() as cd:
        return req.send(200,sign_in_alerts.disown(cd,req.body,client_info(req)))


# ข้อมูล IP (ip_intel.py): the free databases of countries and networks, kept on this server
def ip_data(req):
    return req.send(200,ip_intel.status())


def update_ip_data(req):
    return req.send(202,ip_intel.start_update(req.session['user_id']))


def remove_ip_data(req):
    return req.send(200,ip_intel.stop_using(req.session['user_id']))
