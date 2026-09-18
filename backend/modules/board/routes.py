"""/api/board: the overview's handover notes and the member's own to-dos ('workspace')."""
from backend.modules.board import controller
from backend.utils.routing import ID

ROUTES = [
    ('GET',    '/api/board',        controller.board,  'workspace'),
    ('POST',   '/api/board',        controller.add,    'workspace'),
    ('PATCH',  '/api/board/'+ID,    controller.done,   'workspace'),
    ('DELETE', '/api/board/'+ID,    controller.remove, 'workspace'),
]
