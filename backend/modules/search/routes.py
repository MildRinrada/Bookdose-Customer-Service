"""/api/search: ค้นหาด่วน in the top bar ('workspace': every member, each seeing what they may open)."""
from backend.modules.search import controller

ROUTES = [
    ('GET', '/api/search', controller.search, 'workspace'),
]
