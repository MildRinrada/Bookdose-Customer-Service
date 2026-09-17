"""/api/platform/security/... : the Superadmin security dashboard (platform admins only)."""
from backend.modules.security import controller

SECURITY = '/api/platform/security'

ROUTES = [
    ('GET',    SECURITY+'/overview',              controller.overview,          'platform'),
    ('GET',    SECURITY+'/events',                controller.events,            'platform'),
    ('GET',    SECURITY+'/locks',                 controller.locks,             'platform'),
    ('POST',   SECURITY+'/locks/unlock',          controller.unlock,            'platform'),
    ('GET',    SECURITY+'/alerts',                controller.alerts,            'platform'),
    ('POST',   SECURITY+r'/alerts/([0-9]{1,18})/ack', controller.acknowledge_alert, 'platform'),
    ('GET',    SECURITY+'/ip-blocks',             controller.ip_blocks,         'platform'),
    ('POST',   SECURITY+'/ip-blocks',             controller.add_ip_block,      'platform'),
    ('DELETE', SECURITY+'/ip-blocks',             controller.remove_ip_block,   'platform'),
    ('POST',   SECURITY+'/revoke-sessions',       controller.revoke_sessions,   'platform'),
    ('GET',    SECURITY+'/settings',              controller.settings,          'platform'),
    ('POST',   SECURITY+'/settings',              controller.save_settings,     'platform'),
]
