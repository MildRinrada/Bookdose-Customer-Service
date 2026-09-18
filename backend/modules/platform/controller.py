"""HTTP handlers for platform administrators (every route here requires a platform admin)."""
from backend.modules.platform import service


def registration_settings(req):
    return req.send(200,service.registration_public_config(req.cd))


def save_registration_settings(req):
    return req.send(200,service.save_registration_settings(req.cd,req.session,req.body))


def sms_settings(req):
    return req.send(200,service.sms_settings(req.cd))


def save_sms_settings(req):
    return req.send(200,service.save_sms_settings(req.cd,req.session,req.body))


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
