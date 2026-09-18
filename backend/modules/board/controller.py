"""HTTP handlers of the overview's board (req.db, req.ctx). A platform admin looking in on a support access only reads
(the dispatcher refuses their writes)."""
from backend.middleware.rate_limit import limited
from backend.modules.board import service


def board(req):
    return req.send(200,service.view(req.db,req.ctx))


def add(req):
    limited(('board',req.ctx['id']),60,3600)
    return req.send(201,service.add(req.db,req.ctx,req.body))


def done(req, note_id):
    return req.send(200,service.set_done(req.db,req.ctx,note_id,req.body))


def remove(req, note_id):
    return req.send(200,service.remove(req.db,req.ctx,note_id))
