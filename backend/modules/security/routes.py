"""/api/platform/security/... : the Superadmin security dashboard and its traps (platform admins only). POST /api/trap,
the web app's own trap report, is not in this table: backend/http/dispatch.py answers it only for the web app."""
from backend.modules.security import controller
from backend.utils.routing import ID

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
    ('GET',    SECURITY+'/honeytokens',           controller.honeytokens,       'platform'),
    ('POST',   SECURITY+'/honeytokens',           controller.create_honeytoken, 'platform'),
    ('PATCH',  SECURITY+f'/honeytokens/{ID}',     controller.update_honeytoken, 'platform'),
    ('DELETE', SECURITY+f'/honeytokens/{ID}',     controller.delete_honeytoken, 'platform'),
    ('POST',   SECURITY+f'/honeytokens/{ID}/test', controller.test_honeytoken,  'platform'),
]
