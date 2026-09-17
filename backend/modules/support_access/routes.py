from backend.modules.support_access import controller
from backend.utils.routing import ID

SUPPORT = '/api/support-access'

ROUTES = [
    ('POST',   f'/api/platform/tenants/{ID}/support-access',   controller.request_access, 'platform'),
    ('DELETE', f'/api/platform/support-access/{ID}',           controller.withdraw,       'platform'),
    ('GET',    SUPPORT,                                        controller.requests,       'workspace'),
    ('POST',   SUPPORT+f'/{ID}/approve',                       controller.approve,        'workspace'),
    ('POST',   SUPPORT+f'/{ID}/deny',                          controller.deny,           'workspace'),
    ('POST',   SUPPORT+f'/{ID}/end',                           controller.end,            'workspace'),
]
