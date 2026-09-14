"""Customer support page: organization info, opening a conversation, and the conversation tracked by its link token.
The portal has no tables of its own; it works on contacts, conversations and public articles."""
import secrets

from backend.database import audit, db as D
from backend.modules.ai import service as ai
from backend.modules.automation import service as automation
from backend.modules.contacts import repository as contacts
from backend.modules.conversations import repository as conversations, service as conversation_service
from backend.modules.knowledge import repository as knowledge
from backend.modules.organization import repository as organization
from backend.modules.platform import repository as tenants
from backend.modules.portal import schema
from backend.modules.tickets import repository as tickets
from backend.utils.security import token_hash, uid
from backend.utils.validation import require


def active_organization(cd, slug):
    org = tenants.find_active_by_slug(cd,slug)
    require(org,'ไม่พบหน้าช่วยเหลือ หรือองค์กรหยุดให้บริการชั่วคราว',404)
    return org


def portal_info(db, org):
    return schema.organization_view(org,organization.setting(db,'welcome'),
                                    ai.config(db)['chatbot_enabled'] and ai.has_key(org['id']),
                                    knowledge.list_public(db),organization.setting(db,'response_hours'))


def open_conversation(db, tenant_id, body):
    """Start a web conversation for a visitor; returns (tracking token, conversation id)."""
    D.begin(db)
    name,email,subject = schema.visitor_form(body)
    cid,conv_id,token = uid(),uid(),secrets.token_urlsafe(32)
    # Never merge contacts based on unverified visitor-supplied email.
    team_id = organization.first_team_id(db)
    contacts.insert(db,cid,name,email,'','','','portal')
    conversations.insert(db,conv_id,cid,subject,'web',team_id,token_hash(token))
    conversation_service.store_message(db,tenant_id,conv_id,None,name,'customer',body)
    ai.on_customer_message(db,tenant_id,conv_id,body['body'],is_new=True)
    audit.record(db,'ผู้ติดต่อผ่านเว็บ','conversation.created',conv_id)
    db.commit()
    return token, conv_id


def conversation_for_token(db, token):
    require(20<=len(token)<=100,'กรุณาใช้ลิงก์ติดตามเรื่องของคุณ',401)
    conv = conversations.find_by_portal_token(db,token_hash(token))
    require(conv,'ลิงก์ติดตามไม่ถูกต้อง',404)
    return conv


def conversation_view(db, conv):
    return schema.conversation_view(conv,conversation_service.message_list(db,conv['id'],True),
                                    tickets.for_conversation(db,conv['id']),ai.conversation_state(db,conv['id']),
                                    automation.portal_survey(db,conv['id']))


def rate_service(db, conv, body):
    """The visitor answers the satisfaction survey with the star buttons."""
    automation.rate_from_portal(db,conv,body)


def hand_off_to_staff(db, conv):
    D.begin(db)
    ai.handoff(db,conv['id'])
    db.commit()


def post_customer_message(db, tenant_id, conv, body):
    D.begin(db)
    contact = contacts.find(db,conv['contact_id'])
    mid = conversation_service.store_message(db,tenant_id,conv['id'],None,contact['name'],'customer',body)
    ai.on_customer_message(db,tenant_id,conv['id'],body.get('body',''))
    db.commit()
    return mid


def public_attachment(db, tenant_id, conv, file_id):
    """(name, mime, bytes) of a file on a customer-visible message of this conversation."""
    file = conversations.public_attachment(db,file_id,conv['id'])
    require(file,'ไม่พบไฟล์',404)
    return conversation_service.attachment_content(tenant_id,file)
