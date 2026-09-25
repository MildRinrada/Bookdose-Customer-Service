"""/api/platform/pdpa: find a person in every organization, give them their data, or erase it (platform console)."""
from backend.modules.pdpa import controller

ROUTES = [
    ('GET',  '/api/platform/pdpa',        controller.overview, 'platform'),
    ('POST', '/api/platform/pdpa/search', controller.search,   'platform'),
    ('POST', '/api/platform/pdpa/export', controller.export,   'platform'),
    ('POST', '/api/platform/pdpa/erase',  controller.erase,    'platform'),
]
