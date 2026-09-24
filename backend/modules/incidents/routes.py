"""/api/issues: ประกาศปัญหาที่รู้แล้ว ('workspace'); the customers' copy is /api/public/<org>/issues (portal)."""
from backend.modules.incidents import controller
from backend.utils.routing import ID

ROUTES = [
    ('GET',    '/api/issues',       controller.issues, 'workspace'),
    ('POST',   '/api/issues',       controller.post,   'workspace'),
    ('PATCH',  '/api/issues/'+ID,   controller.change, 'workspace'),
    ('DELETE', '/api/issues/'+ID,   controller.remove, 'workspace'),
]
