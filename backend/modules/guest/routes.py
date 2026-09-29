"""Guest web chat. /api/public/<org>/guest/...: 'guest-open' routes need no cookie (req.guest is set when the browser
holds a known one), 'guest' routes need the guest cookie g_<org> and, when changing something, X-Guest-CSRF; both
need the organization's guest chat switched on (backend/http/dispatch.py checks). /api/public/<org>/widget is public.
/api/settings/guest-chat, /api/settings/guest-blocks and /api/conversations/<id>/guest-block are the organization
admin's; /api/customer/guest-claims the signed-in customer's."""
from backend.modules.guest import controller
from backend.utils.routing import ID

GUEST = '/api/public/[a-z0-9-]+/guest'

ROUTES = [
    ('GET',    GUEST,                         controller.overview,            'guest-open'),
    ('POST',   GUEST+'/conversations',        controller.start,               'guest-open'),
    ('POST',   GUEST+'/resume',               controller.resume,              'guest-open'),
    ('GET',    GUEST+'/session',              controller.conversation,        'guest'),
    ('POST',   GUEST+'/messages',             controller.post_message,        'guest'),
    ('POST',   GUEST+f'/messages/{ID}/reaction', controller.react,            'guest'),
    ('POST',   GUEST+'/handoff',              controller.hand_off,            'guest'),
    ('POST',   GUEST+'/callback',             controller.request_callback,    'guest'),
    ('POST',   GUEST+'/csat',                 controller.rate,                'guest'),
    ('GET',    GUEST+f'/attachments/{ID}',    controller.download_attachment, 'guest'),
    ('GET',    GUEST+f'/thanks/{ID}/photo',   controller.thanks_photo,        'guest'),
    ('POST',   GUEST+f'/thanks/{ID}/heart',   controller.thanks_heart,        'guest'),
    ('GET',    GUEST+f'/cases/{ID}',          controller.case_detail,         'guest'),
    ('POST',   GUEST+'/name',                 controller.rename,              'guest'),
    ('POST',   GUEST+'/remember',             controller.remember,            'guest'),
    ('POST',   GUEST+'/link',                 controller.send_link,           'guest'),
    ('POST',   GUEST+'/line-code',            controller.line_code,           'guest'),
    ('DELETE', GUEST+'/line',                 controller.line_unlink,         'guest'),
    ('POST',   GUEST+'/line-continue',        controller.continue_on_line,    'guest'),
    ('POST',   GUEST+'/forget',               controller.forget,              'guest'),
    ('GET',    '/api/public/[a-z0-9-]+/widget', controller.widget,            'portal'),
    ('GET',    '/api/settings/guest-chat',    controller.settings,            'workspace'),
    ('POST',   '/api/settings/guest-chat',    controller.save_settings,       'workspace'),
    # บล็อกผู้ก่อกวน (blocks.py): from the conversation in the inbox, and the list in the settings.
    ('POST',   f'/api/conversations/{ID}/guest-block', controller.block_guest,   'workspace'),
    ('DELETE', f'/api/conversations/{ID}/guest-block', controller.unblock_guest, 'workspace'),
    ('GET',    '/api/settings/guest-blocks',  controller.guest_blocks,        'workspace'),
    ('DELETE', f'/api/settings/guest-blocks/{ID}', controller.lift_guest_block, 'workspace'),
    ('GET',    '/api/customer/guest-claims',  controller.claims,              'customer-account'),
    ('POST',   '/api/customer/guest-claims',  controller.claim,               'customer-account'),
]
