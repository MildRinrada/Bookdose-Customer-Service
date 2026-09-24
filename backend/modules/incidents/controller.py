"""HTTP handlers of the known-issue notices: every member reads them, the organization's owners post and close them."""
from backend.middleware.auth import require_role
from backend.middleware.rate_limit import limited
from backend.modules.incidents import service

OWNERS = 'เฉพาะผู้ดูแลองค์กรประกาศปัญหาได้'


def issues(req):
    return req.send(200,service.staff_view(req.db))


@require_role('admin',message=OWNERS)
def post(req):
    limited(('issues',req.ctx['tenant_id']),30,3600)
    return req.send(201,service.post(req.db,req.ctx,req.body))


@require_role('admin',message=OWNERS)
def change(req, issue_id):
    return req.send(200,service.change(req.db,req.ctx,issue_id,req.body))


@require_role('admin',message=OWNERS)
def remove(req, issue_id):
    return req.send(200,service.remove(req.db,req.ctx,issue_id))
