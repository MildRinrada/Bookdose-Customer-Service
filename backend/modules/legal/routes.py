from backend.modules.legal import controller

KEY = '(terms|platform-privacy|customer-privacy)'
VERSION = r'([0-9]{4}-[0-9]{2}(?:\.[0-9]+)?)'

ROUTES = [
    # The published text of a document, for anyone (the /legal/<key> pages and the windows forms open it in).
    ('GET',  f'/api/legal/{KEY}',                       controller.show,       'public'),
    # An organization's standing with the terms, and its admin agreeing to the version in force; a member's own
    # standing with the privacy notice.
    ('GET',  '/api/legal/organization',                 controller.organization, 'workspace'),
    ('POST', '/api/legal/organization/accept',          controller.accept_for_organization, 'workspace'),
    ('GET',  '/api/legal/account',                      controller.account,    'account'),
    ('POST', '/api/legal/account/accept',               controller.acknowledge_account, 'account'),
    # A customer agreeing to a new version of the customer privacy notice.
    ('POST', '/api/customer/privacy/accept',            controller.acknowledge_customer, 'customer-account'),
    # Who the provider is, filled into every document; who agreed to what, for the console.
    ('GET',  '/api/platform/legal/company',             controller.company,    'platform'),
    ('POST', '/api/platform/legal/company',             controller.save_company, 'platform'),
    ('GET',  f'/api/platform/legal/{KEY}/acceptances',  controller.acceptances, 'platform'),
    # The console: drafts, versions, publishing (platform admins).
    ('GET',  '/api/platform/legal',                     controller.overview,   'platform'),
    ('GET',  f'/api/platform/legal/{KEY}/versions/{VERSION}', controller.version, 'platform'),
    ('POST', f'/api/platform/legal/{KEY}/draft',        controller.save_draft, 'platform'),
    ('POST', f'/api/platform/legal/{KEY}/publish',      controller.publish,    'platform'),
]
