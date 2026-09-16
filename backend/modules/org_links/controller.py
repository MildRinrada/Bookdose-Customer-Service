"""HTTP handlers of the organization's join links: /api/org-links for the organization's admin (req.cd, req.db and
req.ctx) and /api/customer/... for the customer's account (req.cd, req.customer once signed in)."""
from backend.middleware.auth import require_role
from backend.middleware.rate_limit import limited
from backend.modules.org_links import service


@require_role('admin')
def links(req):
    return req.send(200,service.links_view(req.cd,req.ctx,service.base_url(req.cd,req)))


@require_role('admin')
def create(req):
    return req.send(201,service.create(req.cd,req.db,req.ctx,req.body,service.base_url(req.cd,req)))


@require_role('admin')
def revoke(req, link_id):
    service.revoke(req.cd,req.db,req.ctx,link_id)
    return req.send(200,{'ok':True})


def _guessing(req):
    # A token is a secret while it lives: few tries per address, whether or not the visitor is signed in.
    limited(('join-link',req.ip),30,900)


def preview(req, token):
    _guessing(req)
    return req.send(200,service.preview(req.cd,token))


def join(req, token):
    _guessing(req)
    return req.send(200,service.join(req.cd,req.customer,token))


def org_roles(req):
    return req.send(200,service.org_roles(req.cd,req.customer))
