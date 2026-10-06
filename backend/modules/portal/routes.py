"""/api/public/<organization code>/... : a customer's dealings with one organization. The 'portal' route needs no
sign-in (the organization's public information and articles); 'customer' routes need the customer's session cookie
(the account itself is under /api/customer/), and a changing request also its X-Customer-CSRF."""
import re

from backend.modules.portal import controller
from backend.utils.routing import ID

# Every URL here; anything else under /api/public/ is answered "not found".
PORTAL_PATH = re.compile(r'/api/public/([a-z0-9-]+)(?:/(conversations|cases|session|messages|attachments|handoff|csat|line|guest|widget|code|logo|issues|thanks|articles|callback|team|no-rush|resolve)(?:/[a-z0-9-]+){0,6})?')
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
    # ฉันก็เจอ: anyone reading a notice says they hit it too (incidents/service.py).
    ('POST', PORTAL+f'/issues/{ID}/affected', controller.issue_affected,    'portal'),
    # บทความนี้ช่วยได้ไหม: anyone reading a published article (knowledge/feedback.py).
    ('POST', PORTAL+f'/articles/{ID}/feedback', controller.article_feedback, 'portal'),
    ('POST', PORTAL+'/conversations',       controller.open_conversation,   'customer'),
    ('GET',  PORTAL+f'/cases/{ID}',         controller.case_detail,         'customer'),
    # What signing in gives (customers/perks.py, incidents/follow.py): send a finished case back or finish it, keep a
    # chat or a case as a file, and hear when a known issue is fixed.
    ('POST', PORTAL+f'/cases/{ID}/reopen',  controller.reopen_case,         'customer'),
    ('POST', PORTAL+f'/cases/{ID}/resolve', controller.resolve_case,        'customer'),
    ('GET',  PORTAL+f'/cases/{ID}/export',  controller.export_case,         'customer'),
    ('GET',  PORTAL+f'/conversations/{ID}/export', controller.export_conversation, 'customer'),
    ('GET',  PORTAL+'/issues/following',    controller.issues_following,    'customer'),
    ('POST', PORTAL+f'/issues/{ID}/follow', controller.follow_issue,        'customer'),
    ('GET',  PORTAL+'/session',             controller.conversation,        'customer'),
    ('POST', PORTAL+'/handoff',             controller.hand_off,            'customer'),
    # ขอให้ติดต่อกลับ (portal/callback.py).
    ('POST', PORTAL+'/callback',            controller.request_callback,    'customer'),
    # ไม่รีบ: a reply tomorrow is fine (portal/no_rush.py).
    ('POST', PORTAL+'/no-rush',             controller.no_rush,             'customer'),
    ('POST', PORTAL+'/messages',            controller.post_message,        'customer'),
    # An emoji on a team reply: tells the team without a message, so a finished case stays finished.
    ('POST', PORTAL+f'/messages/{ID}/reaction', controller.react,           'customer'),
    # The customer's own words: corrected, or taken back (conversations/service.py OWN_MINUTES).
    ('PATCH', PORTAL+f'/messages/{ID}',      controller.edit_message,       'customer'),
    ('DELETE', PORTAL+f'/messages/{ID}',     controller.take_back_message,  'customer'),
    # ปักหมุดข้อความในแชท (conversations/pins.py): the same strip the team sees.
    ('POST', PORTAL+f'/messages/{ID}/pin',   controller.pin_message,        'customer'),
    ('POST', PORTAL+'/csat',                controller.rate,                'customer'),
    # ปิดเคส from the chat (automation/closing.py): the chat named by X-Conversation-ID.
    ('POST', PORTAL+'/resolve',             controller.resolve_chat,        'customer'),
    ('GET',  PORTAL+f'/attachments/{ID}',   controller.download_attachment, 'customer'),
    # The team member's photo on the thank-you card of a finished case, for the customer whose chat it is.
    ('GET',  PORTAL+f'/thanks/{ID}/photo',  controller.thanks_photo,        'customer'),
    # ...and the heart the customer sends back from it, for กำแพงคำชม.
    ('POST', PORTAL+f'/thanks/{ID}/heart',  controller.thanks_heart,        'customer'),
    # The photo beside a team reply, by the key the reply carries (portal/photos.py).
    ('GET',  PORTAL+f'/team/{ID}/photo',    controller.team_photo,          'customer'),
]
