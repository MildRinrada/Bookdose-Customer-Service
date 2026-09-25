from backend.modules.automation import controller
from backend.utils.routing import ID

ROUTES = [
    ('GET',   '/api/automation',                  controller.automation_page, 'workspace'),
    ('GET',   '/api/automation/overview',         controller.overview,        'workspace'),
    ('POST',  '/api/automation/setup',            controller.hide_setup,      'workspace'),
    ('GET',   '/api/automation/alerts',           controller.alerts,          'workspace'),
    ('PATCH', '/api/automation/settings',         controller.save_settings,   'workspace'),
    ('POST',  '/api/automation/rules',            controller.create_rule,     'workspace'),
    ('PATCH', f'/api/automation/rules/{ID}',      controller.update_rule,     'workspace'),
    ('DELETE',f'/api/automation/rules/{ID}',      controller.delete_rule,     'workspace'),
    ('POST',  '/api/automation/macros',           controller.create_macro,    'workspace'),
    ('PATCH', f'/api/automation/macros/{ID}',     controller.update_macro,    'workspace'),
    ('DELETE',f'/api/automation/macros/{ID}',     controller.delete_macro,    'workspace'),
    ('POST',  f'/api/macros/{ID}/run',            controller.run_macro,       'workspace'),
    ('POST',  f'/api/tickets/{ID}/followups',     controller.add_followup,    'workspace'),
    ('POST',  f'/api/followups/{ID}/done',        controller.finish_followup, 'workspace'),
    ('POST',  '/api/mentions/read',               controller.read_mentions,   'workspace'),
]
