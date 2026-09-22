"""HTTP handlers for platform administrators, and the two that are not: the guides and the problem report any
signed-in member of an organization may send."""
from backend.modules.platform import service


def registration_settings(req):
    return req.send(200,service.registration_public_config(req.cd))


def save_registration_settings(req):
    return req.send(200,service.save_registration_settings(req.cd,req.session,req.body))


def sms_settings(req):
    return req.send(200,service.sms_settings(req.cd))


def save_sms_settings(req):
    return req.send(200,service.save_sms_settings(req.cd,req.session,req.body))


def turnstile_settings(req):
    return req.send(200,service.turnstile_settings(req.cd))


def save_turnstile_settings(req):
    return req.send(200,service.save_turnstile_settings(req.cd,req.session,req.body))


def test_sms(req):
    from backend.middleware.rate_limit import limited
    limited(('sms-test',req.session['user_id']),5,3600)
    return req.send(200,service.send_test_sms(req.cd,req.body))


def list_tenants(req):
    """The organizations, the platform's history, and where each of this admin's support requests stands."""
    from backend.modules.support_access import service as support
    return req.send(200,{**service.list_tenants(req.cd),'support':support.my_requests(req.cd,req.session['user_id'])})


def create_tenant(req):
    return req.send(201,{'id':service.add_tenant(req.cd,req.body)})


def add_admin(req, tenant_id):
    """POST /api/platform/tenants/<id>/admins {email[, admin_name, password]}: invite (or make) an organization's admin."""
    from backend.middleware.rate_limit import limited
    limited(('platform-admin-invite',req.session['user_id']),30,900)
    return req.send(201,service.add_admin(req.cd,req.session,tenant_id,req.body))


def set_tenant_status(req, tenant_id):
    service.set_tenant_status(req.cd,req.session,tenant_id,req.body)
    return req.send(200,{'ok':True})


def platform_team(req):
    return req.send(200,{'admins':service.platform_team(req.cd),'me':req.session['user_id']})


def add_platform_admin(req):
    return req.send(201,{'id':service.add_platform_admin(req.cd,req.session,req.body)})


def remove_platform_admin(req, user_id):
    service.remove_platform_admin(req.cd,req.session,user_id)
    return req.send(200,{'ok':True})


def system(req):
    """The overview, and two things only this admin can fix: where the secret key comes from, and whether their own
    account has a second factor or a passkey."""
    from backend.modules.staff_security import service as staff_security
    from backend.utils import secret_box
    return req.send(200,{**service.system_overview(req.cd),
                         'security':{'secret_key':secret_box.key_source(),
                                     'account_protected':staff_security.protected(req.cd,req.session['user_id'])}})


def _snapshot():
    """The server's monitor snapshot with the data disk, which the checklist reads."""
    import shutil
    from backend.database import db as D
    from backend.extensions import monitor
    disk = shutil.disk_usage(D.DATA)
    return {**monitor.snapshot(),'disk':{'free':disk.free,'total':disk.total}}


def health(req):
    """GET /api/platform/health: what needs doing, the channels of every organization, how busy each one is, security
    at a glance, the backups and the announcement (health.py)."""
    from backend.modules.platform import backups, health as H
    snapshot = _snapshot()
    return req.send(200,{'todo':H.checklist(req.cd,req.session,snapshot),'channels':H.channel_health(req.cd),
                         'usage':H.org_usage(req.cd),'security':H.security_summary(req.cd),
                         'backups':backups.overview(req.cd),'announcement':H.announcement(req.cd)})


def notifications(req):
    """GET /api/platform/notifications: the console's bell (health.notifications)."""
    from backend.modules.platform import health as H
    return req.send(200,{'items':H.notifications(req.cd,req.session,_snapshot())})


def key_saved(req):
    from backend.modules.platform import health as H
    H.key_saved(req.cd,req.session)
    return req.send(200,{'ok':True})


def retry_channels(req, tenant_id):
    from backend.middleware.rate_limit import limited
    from backend.modules.platform import health as H
    limited(('platform-channel-retry',req.session['user_id']),20,900)
    return req.send(200,H.retry_failed(req.cd,req.session,tenant_id))


def backups(req):
    from backend.modules.platform import backups as B
    return req.send(200,B.overview(req.cd))


def run_backup(req):
    from backend.middleware.rate_limit import limited
    from backend.modules.platform import backups as B
    limited(('platform-backup',req.session['user_id']),10,3600)
    return req.send(201,B.run_now(req.cd,req.session))


def save_backup_settings(req):
    from backend.modules.platform import backups as B
    return req.send(200,B.save_settings(req.cd,req.session,req.body))


def download_backup(req, name):
    """A whole-platform archive: its credentials are sealed, and the key never travels with it."""
    from backend.database import audit
    from backend.modules.platform import backups as B
    path = B.path_of(name)
    audit.record(req.cd,req.session['user_id'],'platform.backup_downloaded',name)
    req.cd.commit()
    return req.send(200,path.read_bytes(),'application/zip',{'Content-Disposition':f'attachment; filename="{name}"'})


def announcement(req):
    from backend.modules.platform import health as H
    return req.send(200,{'announcement':H.announcement(req.cd)})


def save_announcement(req):
    from backend.modules.platform import health as H
    return req.send(200,{'announcement':H.save_announcement(req.cd,req.session,req.body)})


def clear_announcement(req):
    from backend.modules.platform import health as H
    H.clear_announcement(req.cd,req.session)
    return req.send(200,{'announcement':None})


# Global FAQ
def global_faq(req):
    return req.send(200,{'articles':service.global_faq(req.cd)})


def create_global_article(req):
    return req.send(201,{'id':service.save_global_article(req.cd,req.session,None,req.body)})


def update_global_article(req, article_id):
    service.save_global_article(req.cd,req.session,article_id,req.body)
    return req.send(200,{'ok':True})


def publish_global_article(req, article_id):
    service.publish_global_article(req.cd,req.session,article_id)
    return req.send(200,{'ok':True})


def unpublish_global_article(req, article_id):
    service.unpublish_global_article(req.cd,req.session,article_id)
    return req.send(200,{'ok':True})


def discard_global_changes(req, article_id):
    service.discard_global_changes(req.cd,req.session,article_id)
    return req.send(200,{'ok':True})


def delete_global_article(req, article_id):
    service.delete_global_article(req.cd,req.session,article_id)
    return req.send(200,{'ok':True})


def guides(req):
    """The global articles written for the admins and staff of organizations (any signed-in staff account)."""
    return req.send(200,{'articles':service.staff_guides(req.cd)})


def set_tenant_quota(req, tenant_id):
    return req.send(200,service.set_tenant_quota(req.cd,req.session,tenant_id,req.body))


def report_problem(req):
    """A member reports a problem from the ? in the top bar (any signed-in staff account)."""
    from backend.middleware.rate_limit import limited
    limited(('problem-report',req.session['user_id']),5,600)
    return req.send(201,{'id':service.report_problem(req.cd,req.session,req.body,req.headers.get('User-Agent',''))})


def problem_reports(req):
    return req.send(200,service.problem_reports(req.cd))


def set_report_status(req, report_id):
    service.set_report_status(req.cd,req.session,report_id,req.body)
    return req.send(200,{'ok':True})
