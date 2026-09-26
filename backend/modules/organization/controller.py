"""HTTP handlers for organization admins."""
from backend.middleware.auth import require_role
from backend.modules.organization import service


def workspace(req):
    return req.send(200,service.workspace_overview(req.cd,req.db,req.ctx))


def member_photo(req, user_id):
    """A colleague's photo, shown beside what they wrote. The browser fetches it with <img>, which carries cookies
    but no header of ours, so the organization comes from the session rather than from X-Tenant-ID; nothing is
    written and the photo still only reaches a member of that same organization. Kept by the browser for an hour:
    it changes rarely and the pages ask for it on every conversation."""
    from backend.modules.auth.service import workspace_context
    png = service.member_photo(req.cd,workspace_context(req.cd,req.session),user_id)
    return req.send(200,png,'image/png',{'Cache-Control':'private, max-age=3600'})


@require_role('admin')
def change_slug(req):
    return req.send(200,service.change_slug(req.cd,req.db,req.ctx,req.body))


@require_role('admin')
def save_profile(req):
    return req.send(200,service.save_profile(req.cd,req.db,req.ctx,req.body))


@require_role('admin')
def update_settings(req):
    service.update_settings(req.db,req.ctx,req.body)
    return req.send(200,{'ok':True})


@require_role('admin')
def save_business_hours(req):
    from backend.modules.organization import hours
    return req.send(200,{'business_hours':hours.save(req.db,req.ctx,req.body)})


@require_role('admin')
def data_retention(req):
    from backend.modules.organization import retention
    return req.send(200,retention.overview(req.db))


@require_role('admin')
def save_data_retention(req):
    from backend.modules.organization import retention
    return req.send(200,retention.save(req.db,req.ctx,req.body))


@require_role('admin')
def team_security(req):
    from backend.modules.organization import team_security as security
    return req.send(200,security.overview(req.cd,req.db,req.ctx))


@require_role('admin')
def save_team_security(req):
    from backend.modules.organization import team_security as security
    return req.send(200,security.save(req.cd,req.db,req.ctx,req.body))


@require_role('admin')
def save_support_banner(req):
    from backend.modules.organization import banner
    return req.send(200,{'support_banner':banner.save(req.db,req.ctx,req.body)})


@require_role('admin')
def save_quiet_close(req):
    from backend.modules.automation import quiet
    return req.send(200,{'quiet_close':quiet.save(req.db,req.ctx,req.body)})


@require_role('admin')
def save_team_snippets(req):
    service.save_team_snippets(req.db,req.ctx,req.body)
    return req.send(200,{'ok':True})


@require_role('admin')
def save_dashboard_layout(req):
    service.save_dashboard_layout(req.db,req.ctx,req.body)
    return req.send(200,{'ok':True})


@require_role('admin')
def save_customer_categories(req):
    service.save_customer_categories(req.db,req.ctx,req.body)
    return req.send(200,{'ok':True})


@require_role('admin')
def create_team(req):
    return req.send(201,{'id':service.create_team(req.db,req.ctx,req.body)})


@require_role('admin')
def save_team(req, team_id):
    return req.send(200,service.save_team(req.db,req.ctx,team_id,req.body))


@require_role('admin')
def create_member(req, member_id=None):
    return req.send(200,{'id':service.save_member(req.cd,req.db,req.ctx,member_id,req.body,creating=True)})


@require_role('admin')
def update_member(req, member_id=None):
    return req.send(200,{'id':service.save_member(req.cd,req.db,req.ctx,member_id,req.body,creating=False)})


@require_role('admin','manager',message='เฉพาะเจ้าขององค์กร')
def audit_log(req):
    return req.send(200,{'events':service.audit_events(req.cd,req.db,req.ctx)})


@require_role('admin')
def backup(req):
    return req.send(200,service.tenant_backup(req.db,req.ctx),'application/zip',
                    {'Content-Disposition':f'attachment; filename="bookdose-{req.ctx["slug"]}-backup.zip"'})
