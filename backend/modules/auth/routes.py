from backend.modules.auth import controller
from backend.utils.routing import ID

ROUTES = [
    ('POST', '/api/register',         controller.register,            'public'),
    ('POST', '/api/register/resend',  controller.resend_registration, 'public'),
    ('POST', '/api/register/verify',  controller.verify_registration, 'public'),
    ('POST', '/api/forgot-password',  controller.forgot_password,     'public'),
    ('POST', '/api/reset-password',   controller.reset_password,      'public'),
    ('POST', '/api/setup',            controller.set_up,              'public'),
    ('POST', '/api/login',            controller.log_in,              'public'),
    ('POST', '/api/sign-in',          controller.sign_in,             'public'),
    ('GET',  '/api/bootstrap',        controller.bootstrap,           'session'),
    ('GET',  '/api/session',          controller.session_state,       'account'),
    ('POST', '/api/session/activity', controller.activity,            'account'),
    ('POST', '/api/logout',           controller.log_out,             'account'),
    ('GET',  '/api/accounts',         controller.accounts,            'account'),
    ('POST', '/api/accounts/switch',  controller.switch_account,      'account'),
    ('POST', f'/api/accounts/{ID}/sign-out', controller.sign_out_account, 'account'),
    ('POST', '/api/accounts/sign-out-all',  controller.sign_out_browser, 'account'),
    ('POST', '/api/session/tenant',   controller.switch_tenant,       'account'),
    ('POST', '/api/account/password', controller.change_password,     'account'),
    ('POST', '/api/account/profile',  controller.update_profile,      'account'),
]
