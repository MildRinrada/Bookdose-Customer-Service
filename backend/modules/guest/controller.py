"""HTTP handlers of guest web chat. On /api/public/<org>/guest/...: req.org, req.db, and req.guest = {'visitor',
'device','token'} of the browser's cookie ('guest' routes always have one; 'guest-open' routes only when the browser
holds a known cookie). The conversation a request is about comes in X-Conversation-ID, as on the signed-in pages.
Also the widget settings (/api/public/<org>/widget, public; /api/settings/guest-chat, the organization's admin) and
moving a browser's guest chats into the signed-in customer's account (/api/customer/guest-claims)."""
from backend.exceptions.errors import APIError
from backend.middleware.auth import refuse_stale_guest, require_role
from backend.middleware.rate_limit import limited
from backend.modules.customer_security.service import client_info
from backend.modules.guest import schema, service
from backend.modules.guest.model import (COOKIE_MAX_AGE, COOKIE_PREFIX, LINKS_PER_IP_HOUR, LINKS_PER_TARGET_HOUR,
                                         LINKS_PER_VISITOR_HOUR, START_PER_IP_HOUR)
from backend.modules.org_links.service import base_url
from backend.modules.portal import service as portal
from backend.utils.validation import require


def cookie_header(req, slug, token, remember, clear=False):
    """The guest cookie g_<org>: only for the API, never readable by page scripts. Kept 400 days when remembered,
    else until the browser closes. Inside the widget's frame on another website (X-Embed: 1, behind HTTPS) it must
    be SameSite=None; Secure; Partitioned, or the browser would not keep it."""
    parts = [f'{COOKIE_PREFIX}{slug}={token}','HttpOnly','Path=/api/']
    if req.server.secure_cookies and req.headers.get('X-Embed')=='1':
        parts += ['SameSite=None','Secure','Partitioned']
    else:
        parts += ['SameSite=Lax']+(['Secure'] if req.server.secure_cookies else [])
    if clear:
        parts.append('Max-Age=0')
    elif remember:
        parts.append(f'Max-Age={COOKIE_MAX_AGE}')
    return {'Set-Cookie':'; '.join(parts)}


def _set(req, token, remember):
    return cookie_header(req,req.org['slug'],token,remember)


def _current(req):
    return portal.owned_conversation(req.db,req.guest,req.headers.get('X-Conversation-ID',''))


# Guest chat
def overview(req):
    return req.send(200,service.overview(req.cd,req.db,req.org,req.guest))


def start(req):
    # A valid cookie sent without its CSRF token must not end up replaced by a new guest (its chats would be lost).
    refuse_stale_guest(req)
    limited(('guest-start',req.ip),START_PER_IP_HOUR,3600)
    from backend.extensions import turnstile
    from backend.modules.security import traps
    if traps.form_trapped(req.body):
        # The hidden field was filled: recorded here; the form check refuses it with the usual message.
        traps.record_form(client_info(req),'guest_chat',tenant_id=req.org['id'],actor='guest')
    # The visitor proved they are a person (does nothing while the platform has no Turnstile keys).
    turnstile.check(req)
    # The follow links asked for with the chat count like ones asked for later (per address, per browser address).
    for via,key in (('email','email'),('sms','phone')):
        if isinstance(req.body.get(key),str) and req.body[key].strip():
            limited(('guest-link-ip',req.ip),LINKS_PER_IP_HOUR,3600)
            # The address in the form it will be sent to, so one recipient is one budget here and in send_link below.
            limited(('guest-link-target',req.org['id'],via,schema.link_target(via,req.body[key])),LINKS_PER_TARGET_HOUR,3600)
    answer,token,remember = service.start(req.cd,req.db,req.org,req.guest,req.body,client_info(req),base_url(req.cd,req))
    return req.send(201,answer,headers=_set(req,token,remember) if token else None)


def resume(req):
    # A cookie sent without its CSRF token must not let a link decide what happens to this browser's chats.
    refuse_stale_guest(req)
    limited(('guest-resume',req.ip),30,900)
    try:
        conversation_id,token = service.resume(req.cd,req.db,req.org,req.guest,req.body,client_info(req))
    except APIError as error:
        if error.message==schema.LINK_GONE:
            from backend.modules.security import events
            events.from_request(req,'guest_link_invalid',actor='guest',tenant_id=req.org['id'],detail={'status':error.status})
        raise
    return req.send(200,{'ok':True,'conversation_id':conversation_id},headers=_set(req,token,True))


def conversation(req):
    return req.send(200,portal.conversation_view(req.db,_current(req),req.guest,req.cd))


def thanks_photo(req, card_id):
    """The photo on a thank-you card (automation/thanks.py), for the guest whose chat it is."""
    from backend.modules.automation import thanks
    return req.send(200,thanks.photo(req.cd,req.db,req.guest,card_id),'image/png',{'Cache-Control':'private, max-age=600'})


def continue_on_line(req):
    """POST /guest/line-continue: a code that carries this chat to the organization's LINE (channels/move.py)."""
    from backend.modules.channels import move
    return req.send(200,move.new_code(req.db,req.org['id'],_current(req)))


def post_message(req):
    return req.send(201,{'id':portal.post_customer_message(req.db,req.org['id'],_current(req),req.guest,req.body)})


def handoff_qr(req):
    """คุยต่อบนมือถือ (handoff.py)."""
    from backend.modules.guest import handoff
    limited(('guest-handoff',req.org['id'],req.guest['visitor']['id']),handoff.PER_VISITOR_15_MIN,900)
    return req.send(201,handoff.create(req.db,req.org,req.guest,_current(req),base_url(req.cd,req)))


def no_rush(req):
    """ไม่รีบ, as a guest (portal/no_rush.py)."""
    from backend.modules.guest import schema as guest_schema
    from backend.modules.portal import no_rush
    return req.send(200,no_rush.request(req.db,_current(req),guest_schema.display_name(req.guest['visitor']),req.body))


def request_callback(req):
    """ขอให้ติดต่อกลับ, as a guest (portal/callback.py)."""
    from backend.modules.guest import schema as guest_schema
    from backend.modules.portal import callback
    return req.send(200,callback.request(req.db,_current(req),req.guest,guest_schema.display_name(req.guest['visitor']),req.body))


def hand_off(req):
    portal.hand_off_to_staff(req.db,_current(req))
    return req.send(200,{'ok':True})


def rate(req):
    portal.rate_service(req.db,_current(req),req.body)
    return req.send(200,{'ok':True})


def react(req, message_id):
    from backend.modules.conversations import reactions
    return req.send(200,reactions.react(req.db,_current(req),message_id,req.body))


def thanks_heart(req, card_id):
    from backend.modules.automation import thanks
    return req.send(200,thanks.heart(req.cd,req.db,req.guest,card_id))


def download_attachment(req, file_id):
    return req.send_download(*portal.public_attachment(req.db,req.org['id'],req.guest,file_id))


def case_detail(req, case_id):
    return req.send(200,portal.case_detail(req.db,req.guest,case_id))


def rename(req):
    service.set_name(req.db,req.guest,req.body)
    return req.send(200,{'ok':True})


def remember(req):
    value = service.set_remember(req.db,req.guest,req.body)
    return req.send(200,{'ok':True,'remember':value},headers=_set(req,req.guest['token'],value))


def send_link(req):
    visitor = req.guest['visitor']['id']
    limited(('guest-link-ip',req.ip),LINKS_PER_IP_HOUR,3600)
    limited(('guest-link-visitor',req.org['id'],visitor),LINKS_PER_VISITOR_HOUR,3600)
    limited(('guest-link-target',req.org['id'],*schema.link_form(req.body)),LINKS_PER_TARGET_HOUR,3600)
    masked = service.send_link(req.cd,req.db,req.org,req.guest,req.body,base_url(req.cd,req))
    return req.send(202,{'sent':True,'to_masked':masked})


def line_code(req):
    # A code is a guessable secret while it lives: few per guest and address.
    limited(('guest-line',req.ip),10,900)
    limited(('guest-line',req.org['id'],req.guest['visitor']['id']),5,900)
    return req.send(201,service.line_code(req.db,req.org,req.guest))


def line_unlink(req):
    service.line_unlink(req.db,req.guest)
    return req.send(200,{'ok':True})


def forget(req):
    service.forget(req.db,req.guest)
    return req.send(200,{'ok':True},headers=cookie_header(req,req.org['slug'],'',False,clear=True))


# Settings
def widget(req):
    return req.send(200,service.widget_view(req.db))


@require_role('admin')
def settings(req):
    return req.send(200,service.settings_page(req.cd,req.db,req.ctx,base_url(req.cd,req)))


@require_role('admin')
def save_settings(req):
    service.save_settings(req.db,req.ctx,req.body)
    return settings(req)


# บล็อกผู้ก่อกวน (blocks.py): the organization's owners only
OWNERS_ONLY = 'เฉพาะเจ้าขององค์กรที่บล็อกหรือปลดบล็อกผู้เยี่ยมชมได้'


@require_role('admin',message=OWNERS_ONLY)
def block_guest(req, conversation_id):
    from backend.modules.conversations.service import visible_conversation
    from backend.modules.guest import blocks
    return req.send(200,blocks.block(req.db,req.ctx,visible_conversation(req.db,req.ctx,conversation_id)))


@require_role('admin',message=OWNERS_ONLY)
def unblock_guest(req, conversation_id):
    from backend.modules.conversations.service import visible_conversation
    from backend.modules.guest import blocks
    blocks.unblock_conversation(req.db,req.ctx,visible_conversation(req.db,req.ctx,conversation_id))
    return req.send(200,{'ok':True})


@require_role('admin',message=OWNERS_ONLY)
def guest_blocks(req):
    from backend.modules.guest import blocks
    return req.send(200,{'blocks':blocks.listing(req.db)})


@require_role('admin',message=OWNERS_ONLY)
def lift_guest_block(req, block_id):
    from backend.modules.guest import blocks
    blocks.unblock(req.db,req.ctx,block_id)
    return req.send(200,{'ok':True})


# The signed-in customer
def claims(req):
    return req.send(200,service.claims(req.cd,req.headers.get('Cookie','')))


def claim(req):
    limited(('guest-claim',req.customer['account_id']),20,900)
    slug,moved = service.claim(req.cd,req.customer,req.body,req.headers.get('Cookie',''))
    return req.send(200,{'moved':moved},headers=cookie_header(req,slug,'',False,clear=True))
