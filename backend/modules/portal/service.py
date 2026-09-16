"""Customer support page: organization info, and what a signed-in customer does in their own conversations.
The accounts themselves (sign-up with a confirmed email, sign-in, password reset) are in backend/modules/customers.
The portal has no tables of its own; it works on conversations, public articles and customer accounts."""
from backend.database import db as D
from backend.modules.ai import service as ai
from backend.modules.automation import service as automation
from backend.modules.channels import repository as channel_settings
from backend.modules.conversations import repository as conversations, service as conversation_service
from backend.modules.customers import service as customers
from backend.modules.knowledge import repository as knowledge
from backend.modules.organization import repository as organization
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
    return found


def portal_info(cd, db, org):
    return schema.organization_view(org,organization.setting(db,'welcome'),
                                    ai.config(db)['chatbot_enabled'] and ai.has_key(org['id']),
                                    # The organization's own public articles, then the platform's articles for every customer.
                                    knowledge.list_public(db)+tenants.global_articles(cd,'customer'),organization.setting(db,'response_hours'),
                                    customers.email_ready(cd),contact_channels(db),[c['name'] for c in customers.categories(db)])


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


def conversation_view(db, conv, viewer):
    """Opening the conversation counts as reading the team's replies (no notice for them)."""
    _mark_seen(db,viewer,conv['id'])
    return schema.conversation_view(conv,conversation_service.message_list(db,conv['id'],True),
                                    tickets.for_conversation(db,conv['id']),ai.conversation_state(db,conv['id']),
                                    automation.portal_survey(db,conv['id']))


def hand_off_to_staff(db, conv):
    D.begin(db)
    ai.handoff(db,conv['id'])
    db.commit()


def post_customer_message(db, tenant_id, conv, viewer, body):
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
