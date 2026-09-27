"""/api/public/<organization code>/... : a customer's dealings with one organization. The 'portal' route needs no
sign-in (the organization's public information and articles); 'customer' routes need the customer's session cookie
(the account itself is under /api/customer/), and a changing request also its X-Customer-CSRF."""
import re

from backend.modules.portal import controller
from backend.utils.routing import ID

# Every URL here; anything else under /api/public/ is answered "not found".
PORTAL_PATH = re.compile(r'/api/public/([a-z0-9-]+)(?:/(conversations|cases|session|messages|attachments|handoff|csat|line|guest|widget|code|logo|issues|thanks)(?:/[a-z0-9-]+){0,6})?')
PORTAL = '/api/public/[a-z0-9-]+'

ROUTES = [
    ('GET',  PORTAL,                        controller.organization_info,   'portal'),
    # Which code this organization goes by now: the web app asks before drawing a page, so a link made with a code
    # that has since been corrected lands on the current one instead of staying on the old address for good.
    ('GET',  PORTAL+'/code',                controller.canonical_code,      'portal'),
    # The organization's picture, for every page and list that shows it beside its name.
    ('GET',  PORTAL+'/logo',                controller.organization_logo,   'portal'),
    # What of the organization's is down right now (incidents/model.py): every chat page shows it, so nobody has
    # to ask. Asked again every minute by an open page.
    ('GET',  PORTAL+'/issues',              controller.known_issues,        'portal'),
    ('POST', PORTAL+'/conversations',       controller.open_conversation,   'customer'),
    ('GET',  PORTAL+f'/cases/{ID}',         controller.case_detail,         'customer'),
    # What signing in gives (customers/perks.py, incidents/follow.py): send a finished case back, keep a chat or a
    # case as a file, and hear when a known issue is fixed.
    ('POST', PORTAL+f'/cases/{ID}/reopen',  controller.reopen_case,         'customer'),
    ('GET',  PORTAL+f'/cases/{ID}/export',  controller.export_case,         'customer'),
    ('GET',  PORTAL+f'/conversations/{ID}/export', controller.export_conversation, 'customer'),
    ('GET',  PORTAL+'/issues/following',    controller.issues_following,    'customer'),
    ('POST', PORTAL+f'/issues/{ID}/follow', controller.follow_issue,        'customer'),
    ('GET',  PORTAL+'/session',             controller.conversation,        'customer'),
    ('POST', PORTAL+'/handoff',             controller.hand_off,            'customer'),
    ('POST', PORTAL+'/messages',            controller.post_message,        'customer'),
    ('POST', PORTAL+'/csat',                controller.rate,                'customer'),
    ('GET',  PORTAL+f'/attachments/{ID}',   controller.download_attachment, 'customer'),
    # The team member's photo on the thank-you card of a finished case, for the customer whose chat it is.
    ('GET',  PORTAL+f'/thanks/{ID}/photo',  controller.thanks_photo,        'customer'),
]
