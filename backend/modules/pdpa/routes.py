"""/api/platform/pdpa: find a person in every organization, give them their data, or erase it (platform console)."""
from backend.modules.pdpa import controller
from backend.utils.routing import ID

ROUTES = [
    ('GET',  '/api/platform/pdpa',        controller.overview, 'platform'),
    ('POST', '/api/platform/pdpa/search', controller.search,   'platform'),
    ('POST', '/api/platform/pdpa/export', controller.export,   'platform'),
    ('POST', '/api/platform/pdpa/erase',  controller.erase,    'platform'),
    # หนังสือแจ้งผล: one logged request, for the letter to the person it was about.
    ('GET',  f'/api/platform/pdpa/requests/{ID}/letter', controller.letter, 'platform'),
]
