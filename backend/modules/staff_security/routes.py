from backend.modules.staff_security import controller
from backend.utils.routing import ID

SECURITY = '/api/account/security'

ROUTES = [
    ('POST', '/api/login/verify',               controller.verify_login,     'public'),
    ('POST', '/api/sign-in/passkey/options',    controller.sign_in_options,  'public'),
    ('POST', '/api/sign-in/passkey',            controller.passkey_sign_in,  'public'),
    ('GET',  SECURITY,                          controller.state,            'account'),
    ('POST', SECURITY+'/totp/setup',            controller.totp_setup,       'account'),
    ('POST', SECURITY+'/totp/confirm',          controller.totp_confirm,     'account'),
    ('POST', SECURITY+'/totp/disable',          controller.totp_disable,     'account'),
    ('POST', SECURITY+'/recovery-codes',        controller.recovery_codes,   'account'),
    ('POST', SECURITY+'/passkeys/options',      controller.passkey_options,  'account'),
    ('POST', SECURITY+'/passkeys',              controller.passkey_add,      'account'),
    ('POST', SECURITY+f'/passkeys/{ID}',        controller.passkey_rename,   'account'),
    ('POST', SECURITY+f'/passkeys/{ID}/remove', controller.passkey_remove,   'account'),
]
