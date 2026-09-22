from backend.modules.knowledge import controller
from backend.utils.routing import ID

# Creating with an id, or updating without one, is answered 404 by the service (as before).
ARTICLE = f'/api/articles(?:/{ID})?'

ROUTES = [
    ('GET',   '/api/articles', controller.list_articles,  'workspace'),
    ('POST',  ARTICLE,         controller.create_article, 'workspace'),
    ('PATCH', ARTICLE,         controller.update_article, 'workspace'),
    ('DELETE',ARTICLE,         controller.delete_article, 'workspace'),
    # Every member: a use (copied, put in a reply, link sent), a helpful mark, their pins, the earlier versions.
    ('POST',  f'/api/articles/{ID}/use',       controller.record_use, 'workspace'),
    ('POST',  f'/api/articles/{ID}/vote',      controller.vote,       'workspace'),
    ('POST',  '/api/articles/pins',            controller.set_pins,   'workspace'),
    ('GET',   f'/api/articles/{ID}/revisions', controller.revisions,  'workspace'),
    # คลังบทความแม่แบบ: the platform team writes the basics once, an organization takes a copy and owns it.
    ('GET',   '/api/article-templates',        controller.article_templates, 'workspace'),
    ('POST',  f'/api/article-templates/{ID}/use', controller.use_template,   'workspace'),
]
