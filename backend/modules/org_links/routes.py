"""/api/customer/org-roles: the organizations on the customer's account page."""
from backend.modules.org_links import controller

ROUTES = [
    ('GET',    '/api/customer/org-roles',controller.org_roles, 'customer-account'),
    # หน้าลูกค้า with its QR, for the organization's information card (settings → overview).
    ('GET',    '/api/organization/support-link',controller.support_link, 'workspace'),
]
