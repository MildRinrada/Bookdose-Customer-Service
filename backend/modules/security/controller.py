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
