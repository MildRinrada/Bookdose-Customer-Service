from backend.modules.trash import controller
from backend.utils.routing import ID

ROUTES = [
    ('GET',   '/api/trash',                    controller.list_items,   'workspace'),
    ('POST',  f'/api/trash/{ID}/restore',      controller.restore_item, 'workspace'),
    ('DELETE',f'/api/trash/{ID}',              controller.purge_item,   'workspace'),
]
