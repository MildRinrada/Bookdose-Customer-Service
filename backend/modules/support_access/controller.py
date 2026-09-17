"""HTTP handlers of support access: the platform admin's side ('platform') and the organization admins' ('workspace')."""
from backend.middleware.auth import require_role
from backend.middleware.rate_limit import limited
from backend.modules.support_access import service


# The platform admin
def request_access(req, tenant_id):
    limited(('support-request',req.session['user_id']),20,3600)
    return req.send(201,{'id':service.request_access(req.cd,req.session,tenant_id,req.body),'status':'pending'})


def withdraw(req, request_id):
    service.withdraw(req.cd,req.session,request_id)
    return req.send(200,{'ok':True})


# The organization's admins
@require_role('admin')
def requests(req):
    return req.send(200,service.requests_of(req.cd,req.ctx))


@require_role('admin')
def approve(req, request_id):
    return req.send(200,service.approve(req.cd,req.db,req.ctx,request_id,req.body))


@require_role('admin')
def deny(req, request_id):
    return req.send(200,service.deny(req.cd,req.db,req.ctx,request_id,req.body))


@require_role('admin')
def end(req, request_id):
    return req.send(200,service.end(req.cd,req.db,req.ctx,request_id))
