"""/api/public/<organization code>/... : 'portal' routes need no token; 'visitor' routes need the visitor's X-Portal-Token."""
import re

from backend.modules.portal import controller
from backend.utils.routing import ID

# Every support-page URL; anything else under /api/public/ is answered "support page not found".
PORTAL_PATH = re.compile(r'/api/public/([a-z0-9-]+)(?:/(conversations|session|messages|attachments|handoff)(?:/([a-f0-9]{32}))?)?')
PORTAL = '/api/public/[a-z0-9-]+'

ROUTES = [
    ('GET',  PORTAL,                        controller.organization_info,   'portal'),
    ('POST', PORTAL+'/conversations',       controller.open_conversation,   'portal'),
    ('GET',  PORTAL+'/session',             controller.conversation,        'visitor'),
    ('POST', PORTAL+'/handoff',             controller.hand_off,            'visitor'),
    ('POST', PORTAL+'/messages',            controller.post_message,        'visitor'),
    ('GET',  PORTAL+f'/attachments/{ID}',   controller.download_attachment, 'visitor'),
]
