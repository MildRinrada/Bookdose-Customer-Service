"""/api/customer/org-roles: the organizations on the customer's account page."""
from backend.modules.org_links import controller

ROUTES = [
    ('GET',    '/api/customer/org-roles',controller.org_roles, 'customer-account'),
]
