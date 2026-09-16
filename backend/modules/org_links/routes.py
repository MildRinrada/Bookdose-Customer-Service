"""/api/org-links: the organization's permanent link with its QR and the invite links its admin makes ('workspace').
/api/customer/join-links/<token>: what the /join page shows before signing in ('customer-public') and joining by it
('customer-account'); /api/customer/org-roles: the organizations on the account page."""
from backend.modules.org_links import controller
from backend.utils.routing import ID

TOKEN = r'([A-Za-z0-9_-]{16,64})'
JOIN = '/api/customer/join-links/'+TOKEN

ROUTES = [
    ('GET',    '/api/org-links',         controller.links,     'workspace'),
    ('POST',   '/api/org-links',         controller.create,    'workspace'),
    ('DELETE', '/api/org-links/'+ID,     controller.revoke,    'workspace'),
    ('GET',    JOIN,                     controller.preview,   'customer-public'),
    ('POST',   JOIN,                     controller.join,      'customer-account'),
    ('GET',    '/api/customer/org-roles',controller.org_roles, 'customer-account'),
]
