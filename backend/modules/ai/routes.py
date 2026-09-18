from backend.modules.ai import controller
from backend.utils.routing import ID

ROUTES = [
    ('GET',   '/api/ai/settings',     controller.settings,        'workspace'),
    ('PATCH', '/api/ai/settings',     controller.save_settings,   'workspace'),
    ('POST',  '/api/ai/test',         controller.test_connection, 'workspace'),
    ('GET',   f'/api/ai/jobs/{ID}',   controller.job,             'workspace'),
    ('POST',  '/api/ai/insights/article', controller.draft_article, 'workspace'),
    ('POST',  '/api/ai/insights/brief',   controller.brief,         'workspace'),
]
