from backend.modules.knowledge import controller
from backend.utils.routing import ID

# Creating with an id, or updating without one, is answered 404 by the service (as before).
ARTICLE = f'/api/articles(?:/{ID})?'

ROUTES = [
    ('GET',   '/api/articles', controller.list_articles,  'workspace'),
    ('POST',  ARTICLE,         controller.create_article, 'workspace'),
    ('PATCH', ARTICLE,         controller.update_article, 'workspace'),
    ('DELETE',ARTICLE,         controller.delete_article, 'workspace'),
]
