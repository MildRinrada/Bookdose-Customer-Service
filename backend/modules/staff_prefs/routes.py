from backend.modules.staff_prefs import controller

PREFERENCES = '/api/account/preferences'

ROUTES = [
    ('GET',  PREFERENCES,               controller.preferences, 'account'),
    ('POST', PREFERENCES,               controller.save,        'account'),
    ('POST', '/api/account/status',     controller.set_status,  'account'),
    ('POST', PREFERENCES+'/test-email', controller.test_email,  'account'),
]
