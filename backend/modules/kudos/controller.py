"""HTTP handlers of กำแพงคำชม (req.db, req.ctx). A platform admin looking in on a support access only reads (the
dispatcher refuses their writes)."""
from backend.middleware.rate_limit import limited
from backend.modules.kudos import service


def wall(req):
    return req.send(200,service.wall(req.db,req.ctx))


def cheer(req, kudos_id):
    limited(('kudos-cheer',req.ctx['id']),120,3600)
    return req.send(200,service.cheer(req.db,req.ctx,kudos_id,req.body))


def hide(req, kudos_id):
    return req.send(200,service.hide(req.db,req.ctx,kudos_id))
