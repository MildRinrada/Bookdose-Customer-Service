from backend.modules.organization import controller
from backend.utils.routing import ID

# Adding with an id, or changing without one, is answered 404 by the service (as before).
MEMBER = f'/api/members(?:/{ID})?'

ROUTES = [
    ('GET',   '/api/workspace', controller.workspace,       'workspace'),
    # 'account', not 'workspace': an <img> sends no X-Tenant-ID header (see controller.member_photo).
    ('GET',   f'/api/members/{ID}/photo', controller.member_photo, 'account'),
    ('PATCH', '/api/settings',  controller.update_settings, 'workspace'),
    ('PATCH', '/api/settings/profile', controller.save_profile, 'workspace'),
    ('PATCH', '/api/settings/slug', controller.change_slug, 'workspace'),
    ('POST',  '/api/settings/banner', controller.save_support_banner, 'workspace'),
    ('POST',  '/api/settings/categories', controller.save_customer_categories, 'workspace'),
    ('POST',  '/api/settings/snippets', controller.save_team_snippets, 'workspace'),
    ('POST',  '/api/settings/hours', controller.save_business_hours, 'workspace'),
    ('POST',  '/api/settings/quiet-close', controller.save_quiet_close, 'workspace'),
    ('GET',   '/api/settings/retention', controller.data_retention, 'workspace'),
    ('POST',  '/api/settings/retention', controller.save_data_retention, 'workspace'),
    ('GET',   '/api/settings/security', controller.team_security, 'workspace'),
    ('POST',  '/api/settings/security', controller.save_team_security, 'workspace'),
    ('POST',  '/api/settings/dashboard', controller.save_dashboard_layout, 'workspace'),
    ('POST',  '/api/teams',     controller.create_team,     'workspace'),
    ('PATCH', f'/api/teams/{ID}', controller.save_team,     'workspace'),
    ('POST',  MEMBER,           controller.create_member,   'workspace'),
    ('PATCH', MEMBER,           controller.update_member,   'workspace'),
    ('GET',   '/api/audit',     controller.audit_log,       'workspace'),
    ('GET',   '/api/backup',    controller.backup,          'workspace'),
]
