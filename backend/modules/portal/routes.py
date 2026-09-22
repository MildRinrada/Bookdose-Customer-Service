"""/api/public/<organization code>/... : a customer's dealings with one organization. The 'portal' route needs no
sign-in (the organization's public information and articles); 'customer' routes need the customer's session cookie
(the account itself is under /api/customer/), and a changing request also its X-Customer-CSRF."""
import re

from backend.modules.portal import controller
from backend.utils.routing import ID

# Every URL here; anything else under /api/public/ is answered "not found".
PORTAL_PATH = re.compile(r'/api/public/([a-z0-9-]+)(?:/(conversations|cases|session|messages|attachments|handoff|csat|line|guest|widget|code)(?:/[a-z0-9-]+){0,6})?')
PORTAL = '/api/public/[a-z0-9-]+'

ROUTES = [
    ('GET',  PORTAL,                        controller.organization_info,   'portal'),
    # Which code this organization goes by now: the web app asks before drawing a page, so a link made with a code
    # that has since been corrected lands on the current one instead of staying on the old address for good.
    ('GET',  PORTAL+'/code',                controller.canonical_code,      'portal'),
    ('POST', PORTAL+'/conversations',       controller.open_conversation,   'customer'),
    ('GET',  PORTAL+f'/cases/{ID}',         controller.case_detail,         'customer'),
    ('GET',  PORTAL+'/session',             controller.conversation,        'customer'),
    ('POST', PORTAL+'/handoff',             controller.hand_off,            'customer'),
    ('POST', PORTAL+'/messages',            controller.post_message,        'customer'),
    ('POST', PORTAL+'/csat',                controller.rate,                'customer'),
    ('GET',  PORTAL+f'/attachments/{ID}',   controller.download_attachment, 'customer'),
]
