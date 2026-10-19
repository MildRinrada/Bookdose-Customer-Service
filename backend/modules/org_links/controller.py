"""HTTP handler of /api/customer/org-roles: the organizations on the customer's account page (req.cd, req.customer)."""
from backend.modules.org_links import service


def org_roles(req):
    return req.send(200,service.org_roles(req.cd,req.customer))
