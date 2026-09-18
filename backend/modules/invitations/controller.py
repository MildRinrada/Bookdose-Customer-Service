"""HTTP handlers of staff invitations: the organization's admins ('workspace') and the invited colleague ('public')."""
from backend.database import db as D
from backend.middleware.auth import require_role
from backend.middleware.rate_limit import limited
from backend.modules.invitations import service


@require_role('admin')
def invitations(req):
    return req.send(200,service.invitations_of(req.cd,req.ctx))


@require_role('admin')
def invite(req):
    limited(('invite',req.ctx['tenant_id']),30,3600)
    return req.send(201,service.invite(req.cd,req.db,req.ctx,req.body))


@require_role('admin')
def resend(req, invite_id):
    limited(('invite',req.ctx['tenant_id']),30,3600)
    return req.send(200,service.resend(req.cd,req.db,req.ctx,invite_id))


@require_role('admin')
def cancel(req, invite_id):
    return req.send(200,service.cancel(req.cd,req.db,req.ctx,invite_id))


# The invited colleague, signed out
def view(req):
    limited(('invitation',req.ip),30,900)
    with D.control() as cd:
        return req.send(200,service.view(cd,req.query))


def accept(req):
    from backend.modules.auth import controller as auth
    limited(('invitation',req.ip),20,900)
    answer,token = service.accept(req.headers.get('Cookie',''),req.body,auth.client(req))
    return req.send(200,answer,headers=auth.session_cookie(req,token) if token else None)
