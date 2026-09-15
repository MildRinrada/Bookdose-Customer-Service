"""/api/customer/... : the customer's account, the same for every organization. 'customer-public' routes need no
sign-in (sign-up, sign-in, links from emails); 'customer-account' routes need the session cookie, and a changing
request also its X-Customer-CSRF. The LINE linking of one organization is under /api/public/<code>/line."""
from backend.modules.customers import controller

LINE = '/api/public/[a-z0-9-]+/line'

ROUTES = [
    ('GET',  '/api/customer/account',       controller.account,              'customer-public'),
    ('POST', '/api/customer/register',      controller.register,             'customer-public'),
    ('POST', '/api/customer/resend',        controller.resend,               'customer-public'),
    ('POST', '/api/customer/verify',        controller.verify,               'customer-public'),
    ('POST', '/api/customer/login',         controller.log_in,               'customer-public'),
    ('POST', '/api/customer/forgot',        controller.forgot,               'customer-public'),
    ('POST', '/api/customer/reset',         controller.reset,                'customer-public'),
    ('POST', '/api/customer/logout',        controller.log_out,              'customer-account'),
    ('POST', '/api/customer/profile',       controller.update_profile,       'customer-account'),
    ('POST', '/api/customer/password',      controller.change_password,      'customer-account'),
    ('POST', '/api/customer/notifications', controller.update_notifications, 'customer-account'),
    ('GET',  '/api/customer/notification-settings', controller.notification_settings, 'customer-account'),
    ('POST', '/api/customer/notification-settings', controller.save_notification_settings, 'customer-account'),
    # The LINE of one organization, for notifications (portal area: the customer's session cookie).
    ('GET',    LINE,                        controller.line_status,          'customer'),
    ('POST',   LINE,                        controller.line_code,            'customer'),
    ('DELETE', LINE,                        controller.line_unlink,          'customer'),
    ('GET',  '/api/customer/organizations', controller.my_organizations,     'customer-account'),
    ('POST', '/api/customer/organizations', controller.join_organization,    'customer-account'),
    ('GET',  '/api/customer/overview',      controller.overview,             'customer-account'),
    ('GET',  '/api/customer/dashboard',     controller.dashboard,            'customer-account'),
    ('GET',  '/api/customer/faq',           controller.faq,                  'customer-account'),
]
