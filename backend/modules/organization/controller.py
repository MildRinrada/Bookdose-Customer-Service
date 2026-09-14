"""HTTP handlers for organization admins."""
from backend.middleware.auth import require_role
from backend.modules.organization import service


def workspace(req):
    return req.send(200,service.workspace_overview(req.cd,req.db,req.ctx))


@require_role('admin')
def update_settings(req):
    service.update_settings(req.db,req.ctx,req.body)
    return req.send(200,{'ok':True})


@require_role('admin')
def create_team(req):
    return req.send(201,{'id':service.create_team(req.db,req.ctx,req.body)})


@require_role('admin')
def create_member(req, member_id=None):
    return req.send(200,{'id':service.save_member(req.cd,req.db,req.ctx,member_id,req.body,creating=True)})


@require_role('admin')
def update_member(req, member_id=None):
    return req.send(200,{'id':service.save_member(req.cd,req.db,req.ctx,member_id,req.body,creating=False)})


@require_role('admin','manager',message='เฉพาะผู้ดูแลหรือหัวหน้าทีม')
def audit_log(req):
    return req.send(200,{'events':service.audit_events(req.cd,req.db,req.ctx)})


@require_role('admin')
def backup(req):
    return req.send(200,service.tenant_backup(req.db,req.ctx),'application/zip',
                    {'Content-Disposition':f'attachment; filename="bookdose-{req.ctx["slug"]}-backup.zip"'})
