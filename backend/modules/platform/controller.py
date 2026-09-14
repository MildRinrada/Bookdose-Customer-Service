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
