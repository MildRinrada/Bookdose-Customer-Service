"""Customer support page: organization info, and what a signed-in customer does in their own conversations.
The accounts themselves (sign-up with a confirmed email, sign-in, password reset) are in backend/modules/customers.
The portal has no tables of its own; it works on conversations, public articles and customer accounts."""
import base64
import binascii

from backend.database import db as D
from backend.exceptions.errors import APIError
from backend.modules.ai import service as ai
from backend.modules.automation import service as automation
from backend.modules.channels import repository as channel_settings
from backend.modules.conversations import repository as conversations, service as conversation_service
from backend.modules.customers import service as customers
from backend.modules.knowledge import repository as knowledge
from backend.modules.organization import hours, repository as organization
from backend.modules.platform import repository as tenants
from backend.modules.portal import schema
from backend.modules.tickets import repository as tickets
from backend.utils.validation import require


def active_organization(cd, slug):
    org = tenants.find_active_by_slug(cd,slug)
    require(org,'ไม่พบองค์กรนี้ หรือองค์กรหยุดให้บริการชั่วคราว',404)
    return org


def contact_channels(db):
    """The organization's other ways to reach the team that are switched on, as the customer should see them."""
    found = []
    for kind in ('line','email'):
        row = channel_settings.find_setting(db,kind)
        if row and row['enabled']:
            found.append({'kind':kind,'label':(row['config'].get('display_name') if kind=='line' else row['config'].get('address')) or ''})
    page = channel_settings.find_facebook_setting(db)
    if page and page['enabled']:
        found.append({'kind':'facebook','label':page['config'].get('page_name','')})
        if page['config'].get('instagram_enabled') and page['config'].get('instagram_id'):
            found.append({'kind':'instagram','label':'@'+page['config'].get('instagram_username','')})
    return found


def organization_logo(org):
    """The organization's own picture as a PNG. Public, like its name: it heads the pages its customers open, and the
    lists that show many organizations at once fetch it as an image rather than carrying it in every answer."""
    stored = org.get('logo','')
    require(stored.startswith('data:image/png;base64,'),'องค์กรนี้ยังไม่ได้ตั้งโลโก้',404)
    try:
        return base64.b64decode(stored.split(',',1)[1],validate=True)
    except (ValueError,binascii.Error):
        raise APIError(404,'โลโก้เสียหาย') from None


def portal_info(cd, db, org):
    from backend.modules.organization import banner
    return schema.organization_view(org,organization.setting(db,'welcome'),
                                    ai.config(db)['chatbot_enabled'] and ai.has_key(org['id']),
                                    # The organization's own public articles, then the platform's articles for every customer.
                                    knowledge.list_public(db)+[{**g,'global':True} for g in tenants.global_articles(cd,'customer')],organization.setting(db,'response_hours'),
                                    customers.email_ready(cd),contact_channels(db),[c['name'] for c in customers.categories(db)],
                                    hours.sla_in_opening_time(db),banner.config(db))


# The customer's own conversations. The viewer is the signed-in customer's session, or a guest of guest web chat
# ({'visitor', 'device'}, backend/modules/guest): the same pages and rules, with ownership checked against each.
def _is_guest(viewer):
    return bool(viewer.get('visitor'))


def owned_conversation(db, viewer, conversation_id):
    """A conversation of this viewer; 404 for anyone else's."""
    from backend.modules.guest import service as guest
    if _is_guest(viewer):
        return guest.current_conversation(db,viewer,conversation_id)
    return customers.current_conversation(db,viewer,conversation_id)


def _mark_seen(db, viewer, conversation_id):
    from backend.modules.guest import service as guest
    if _is_guest(viewer):
        guest.mark_seen(db,viewer,conversation_id)
    else:
        customers.mark_seen(db,viewer,conversation_id)


def _author(viewer):
    from backend.modules.guest import schema as guest_schema
    return guest_schema.display_name(viewer['visitor']) if _is_guest(viewer) else viewer['name']


def case_detail(db, viewer, case_id):
    from backend.modules.guest import service as guest
    if _is_guest(viewer):
        return guest.case_detail(db,viewer,case_id)
    return customers.case_detail(db,viewer,case_id)


def conversation_view(db, conv, viewer, cd=None):
    """Opening the conversation counts as reading the team's replies (no notice for them). `cd` (the control database)
    lets the view carry the thank-you card of a finished case (automation/thanks.py) and the team's photos."""
    from backend.modules.automation import thanks
    _mark_seen(db,viewer,conv['id'])
    # Where they stand while they wait for the team, so they do not write again only to ask. A guide only: should it
    # fail, the chat opens without it rather than not at all.
    from backend.database import db as D
    from backend.modules.channels import move
    from backend.modules.conversations import queue
    try:
        place = queue.of(db,D.tenant_id_of(db),conv)
    except Exception as error:
        print(f'Wait queue: {type(error).__name__}',flush=True)
        place = None
    # Each team reply with its writer's photo, when they let customers see it (portal/photos.py).
    from backend.modules.portal import photos
    messages = photos.mark(cd,db,conv['id'],conversation_service.message_list(db,conv['id'],True))
    view = schema.conversation_view(conv,messages,
                                    tickets.for_conversation(db,conv['id']),ai.conversation_state(db,conv['id']),
                                    automation.portal_survey(db,conv['id']),conversations.staff_read_at(db,conv['id']),
                                    place,move.offer(db,D.tenant_id_of(db),conv),thanks.card_for(cd,db,conv['id']))
    # ขอให้ติดต่อกลับ: the request waiting and the times to pick from (portal/callback.py).
    from backend.modules.portal import callback
    view['callback'] = callback.state(db,conv,viewer)
    return view


def hand_off_to_staff(db, conv):
    D.begin(db)
    ai.handoff(db,conv['id'])
    db.commit()


def post_customer_message(db, tenant_id, conv, viewer, body):
    # A chat carried to LINE goes on there: the team's replies go to LINE, so the web page only reads it now.
    from backend.modules.channels import move
    require(not move.moved(db,conv['id']),'แชทนี้ย้ายไปคุยต่อใน LINE แล้ว กรุณาพิมพ์ต่อใน LINE',409)
    D.begin(db)
    mid = conversation_service.store_message(db,tenant_id,conv['id'],None,_author(viewer),'customer',body)
    ai.on_customer_message(db,tenant_id,conv['id'],body.get('body',''))
    _mark_seen(db,viewer,conv['id'])
    db.commit()
    return mid


def rate_service(db, conv, body):
    """The customer answers the satisfaction survey with the star buttons."""
    automation.rate_from_portal(db,conv,body)


def public_attachment(db, tenant_id, viewer, file_id):
    """(name, mime, bytes) of a file on a customer-visible message in one of the viewer's own conversations."""
    record = conversations.attachment_with_conversation(db,file_id)
    require(record,'ไม่พบไฟล์',404)
    owned_conversation(db,viewer,record['conversation_id'])
    file = conversations.public_attachment(db,file_id,record['conversation_id'])
    require(file,'ไม่พบไฟล์',404)
    return conversation_service.attachment_content(tenant_id,file)
