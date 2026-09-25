"""HTTP handlers of the Superadmin security dashboard (every route requires a platform admin: access 'platform')."""
from backend.modules.security import service


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
