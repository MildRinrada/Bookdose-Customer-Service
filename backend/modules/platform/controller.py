"""HTTP handlers for platform administrators (every route here requires a platform admin)."""
from backend.modules.platform import service


def registration_settings(req):
    return req.send(200,service.registration_public_config(req.cd))


def save_registration_settings(req):
    return req.send(200,service.save_registration_settings(req.cd,req.session,req.body))


def list_tenants(req):
    return req.send(200,service.list_tenants(req.cd))


def create_tenant(req):
    return req.send(201,{'id':service.add_tenant(req.cd,req.body)})


def set_tenant_status(req, tenant_id):
    service.set_tenant_status(req.cd,req.session,tenant_id,req.body)
    return req.send(200,{'ok':True})


def grant_support_access(req, tenant_id):
    service.grant_support_access(req.cd,req.session,tenant_id,req.body)
    return req.send(201,{'ok':True})


def platform_team(req):
    return req.send(200,{'admins':service.platform_team(req.cd),'me':req.session['user_id']})


def add_platform_admin(req):
    return req.send(201,{'id':service.add_platform_admin(req.cd,req.session,req.body)})


def remove_platform_admin(req, user_id):
    service.remove_platform_admin(req.cd,req.session,user_id)
    return req.send(200,{'ok':True})


def system(req):
    return req.send(200,service.system_overview(req.cd))


# Global FAQ
def global_faq(req):
    return req.send(200,{'articles':service.global_faq(req.cd)})


def create_global_article(req):
    return req.send(201,{'id':service.save_global_article(req.cd,req.session,None,req.body)})


def update_global_article(req, article_id):
    service.save_global_article(req.cd,req.session,article_id,req.body)
    return req.send(200,{'ok':True})


def delete_global_article(req, article_id):
    service.delete_global_article(req.cd,req.session,article_id)
    return req.send(200,{'ok':True})


def guides(req):
    """The global articles written for the admins and staff of organizations (any signed-in staff account)."""
    return req.send(200,{'articles':service.staff_guides(req.cd)})
