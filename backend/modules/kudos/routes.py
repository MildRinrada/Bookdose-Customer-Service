"""/api/kudos: กำแพงคำชม, the customers' praise of the team ('workspace': everyone in the organization reads it)."""
from backend.modules.kudos import controller
from backend.utils.routing import ID

ROUTES = [
    ('GET',    '/api/kudos',                controller.wall,  'workspace'),
    ('POST',   f'/api/kudos/{ID}/cheer',    controller.cheer, 'workspace'),
    ('DELETE', f'/api/kudos/{ID}',          controller.hide,  'workspace'),
]
