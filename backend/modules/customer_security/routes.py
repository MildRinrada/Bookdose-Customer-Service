"""/api/customer/security/... : two-factor sign-in, passkeys, the signed-in devices and the activity log of the
customer's account ('customer-account': the session cookie, and X-Customer-CSRF on every change). The second step of
a sign-in and the passkey sign-in are 'customer-public': nobody is signed in yet, so the waiting challenge is the
only thing they carry."""
from backend.modules.customer_security import controller
from backend.utils.routing import ID

SECURITY = '/api/customer/security'

ROUTES = [
    ('POST',   '/api/customer/login/verify',          controller.verify_login,          'customer-public'),
    ('POST',   '/api/customer/passkey/options',       controller.passkey_login_options, 'customer-public'),
    ('POST',   '/api/customer/passkey/login',         controller.passkey_login,         'customer-public'),
    ('GET',    SECURITY,                              controller.state,                 'customer-account'),
    ('POST',   SECURITY+'/totp/setup',                controller.totp_setup,            'customer-account'),
    ('POST',   SECURITY+'/totp/confirm',              controller.totp_confirm,          'customer-account'),
    ('POST',   SECURITY+'/totp/disable',              controller.totp_disable,          'customer-account'),
    ('POST',   SECURITY+'/recovery-codes',            controller.recovery_codes,        'customer-account'),
    ('GET',    SECURITY+'/passkeys',                  controller.passkeys,              'customer-account'),
    ('POST',   SECURITY+'/passkeys/options',          controller.passkey_options,       'customer-account'),
    ('POST',   SECURITY+'/passkeys',                  controller.passkey_add,           'customer-account'),
    ('POST',   SECURITY+f'/passkeys/{ID}',            controller.passkey_rename,        'customer-account'),
    ('POST',   SECURITY+f'/passkeys/{ID}/remove',     controller.passkey_remove,        'customer-account'),
    ('GET',    SECURITY+'/sessions',                  controller.sessions,              'customer-account'),
    ('DELETE', SECURITY+f'/sessions/{ID}',            controller.revoke_session,        'customer-account'),
    ('POST',   SECURITY+'/sessions/sign-out-all',     controller.sign_out_all,          'customer-account'),
    ('GET',    SECURITY+'/activity',                  controller.activity,              'customer-account'),
]
