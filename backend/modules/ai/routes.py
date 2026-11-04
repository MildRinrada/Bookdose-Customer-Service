from backend.modules.ai import controller
from backend.utils.routing import ID

ROUTES = [
    ('GET',   '/api/ai/settings',     controller.settings,        'workspace'),
    # ถาม AI on a settings page, when the organization has no AI to ask: the page's guide (ai/settings_help.py).
    ('GET',   '/api/ai/settings-help/([a-z]+)', controller.settings_help, 'workspace'),
    ('PATCH', '/api/ai/settings',     controller.save_settings,   'workspace'),
    ('POST',  '/api/ai/test',         controller.test_connection, 'workspace'),
    ('GET',   f'/api/ai/jobs/{ID}',   controller.job,             'workspace'),
    ('POST',  '/api/ai/insights/article', controller.draft_article, 'workspace'),
    ('POST',  '/api/ai/insights/brief',   controller.brief,         'workspace'),
    ('POST',  '/api/ai/assistant',        controller.ask,           'workspace'),
    ('POST',  f'/api/ai/assistant/{ID}/run', controller.run_actions, 'workspace'),
    ('POST',  f'/api/ai/assistant/{ID}/feedback', controller.rate_answer, 'workspace'),
    ('DELETE',f'/api/ai/assistant/{ID}',  controller.stop_ask,      'workspace'),
    ('POST',  '/api/ai/polish',           controller.polish,        'workspace'),
    ('POST',  f'/api/tickets/{ID}/triage', controller.triage,       'workspace'),
]
