from backend.modules.platform import controller
from backend.utils.routing import ID

ROUTES = [
    ('GET',   '/api/platform/registration',   controller.registration_settings,      'platform'),
    ('POST',  '/api/platform/registration',   controller.save_registration_settings, 'platform'),
    ('GET',   '/api/platform/sms',            controller.sms_settings,               'platform'),
    ('POST',  '/api/platform/sms',            controller.save_sms_settings,          'platform'),
    ('POST',  '/api/platform/sms/test',       controller.test_sms,                   'platform'),
    ('GET',   '/api/platform/tenants',        controller.list_tenants,               'platform'),
    ('POST',  '/api/platform/tenants',        controller.create_tenant,              'platform'),
    ('PATCH', f'/api/platform/tenants/{ID}',  controller.set_tenant_status,          'platform'),
    ('POST',  f'/api/platform/tenants/{ID}/admins', controller.add_admin,          'platform'),
    ('GET',   '/api/platform/system',         controller.system,                     'platform'),
    ('GET',   '/api/platform/admins',         controller.platform_team,              'platform'),
    ('POST',  '/api/platform/admins',         controller.add_platform_admin,         'platform'),
    ('DELETE',f'/api/platform/admins/{ID}',   controller.remove_platform_admin,      'platform'),
    ('GET',   '/api/platform/faq',            controller.global_faq,                 'platform'),
    ('POST',  '/api/platform/faq',            controller.create_global_article,      'platform'),
    ('PATCH', f'/api/platform/faq/{ID}',      controller.update_global_article,      'platform'),
    ('DELETE',f'/api/platform/faq/{ID}',      controller.delete_global_article,      'platform'),
    ('POST',  f'/api/platform/faq/{ID}/publish',   controller.publish_global_article,   'platform'),
    ('POST',  f'/api/platform/faq/{ID}/unpublish', controller.unpublish_global_article, 'platform'),
    ('DELETE',f'/api/platform/faq/{ID}/changes',   controller.discard_global_changes,   'platform'),
    ('GET',   '/api/guides',                  controller.guides,                     'account'),
]
