from backend.modules.platform import controller
from backend.utils.routing import ID

ROUTES = [
    ('GET',   '/api/platform/registration',   controller.registration_settings,      'platform'),
    ('POST',  '/api/platform/registration',   controller.save_registration_settings, 'platform'),
    ('GET',   '/api/platform/tenants',        controller.list_tenants,               'platform'),
    ('POST',  '/api/platform/tenants',        controller.create_tenant,              'platform'),
    ('PATCH', f'/api/platform/tenants/{ID}',  controller.set_tenant_status,          'platform'),
    ('POST',  f'/api/platform/tenants/{ID}/support-access', controller.grant_support_access, 'platform'),
]
