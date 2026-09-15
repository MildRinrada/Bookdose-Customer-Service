from backend.modules.organization import controller
from backend.utils.routing import ID

# Adding with an id, or changing without one, is answered 404 by the service (as before).
MEMBER = f'/api/members(?:/{ID})?'

ROUTES = [
    ('GET',   '/api/workspace', controller.workspace,       'workspace'),
    ('PATCH', '/api/settings',  controller.update_settings, 'workspace'),
    ('POST',  '/api/settings/categories', controller.save_customer_categories, 'workspace'),
    ('POST',  '/api/teams',     controller.create_team,     'workspace'),
    ('POST',  MEMBER,           controller.create_member,   'workspace'),
    ('PATCH', MEMBER,           controller.update_member,   'workspace'),
    ('GET',   '/api/audit',     controller.audit_log,       'workspace'),
    ('GET',   '/api/backup',    controller.backup,          'workspace'),
]
