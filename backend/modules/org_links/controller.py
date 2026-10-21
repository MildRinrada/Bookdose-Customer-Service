"""HTTP handlers: the organization's customer page link with its QR (req.ctx), and /api/customer/org-roles, the
organizations on the customer's account page (req.cd, req.customer)."""
from backend.modules.org_links import service


def support_link(req):
    return req.send(200,service.support_link(req.cd,req.ctx,req))


def org_roles(req):
    return req.send(200,service.org_roles(req.cd,req.customer))
