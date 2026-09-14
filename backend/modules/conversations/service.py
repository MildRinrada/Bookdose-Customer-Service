"""Conversation rules: the staff inbox, replies and notes, AI draft and mode, linking to a case,
and storing messages (used by staff, the support page and LINE / Email)."""
import json

from backend.database import audit, db as D
from backend.middleware.access import visible_team, get_scoped
from backend.modules.ai import service as ai
from backend.modules.channels import service as channels
from backend.modules.contacts import repository as contacts
from backend.modules.conversations import repository, schema
from backend.modules.tickets import repository as tickets, schema as ticket_schema, service as ticket_service
from backend.utils.security import uid
from backend.utils.validation import require


def visible_conversation(db, ctx, conversation_id):
    return get_scoped(db,'conversations',conversation_id,ctx)


def list_conversations(db, ctx):
    return repository.list_with_previews(db,visible_team(ctx))


def conversation_detail(db, conv):
    conv.pop('portal_token',None)
    conv['ai'] = ai.conversation_state(db,conv['id'])
    conv['line'] = repository.line_thread(db,conv['id'])
    return {'conversation':conv,'messages':message_list(db,conv['id']),
            'contact':contacts.find(db,conv['contact_id']),
            'ticket':tickets.for_conversation(db,conv['id'])}


def set_conversation_status(db, ctx, conv, body):
    status = schema.conversation_status(body)
    repository.set_status(db,conv['id'],status)
    if status=='closed':
        ai.stop_bot(db,conv['id'])
    audit.record(db,ctx['name'],'conversation.'+status,conv['id'])
    db.commit()


def post_staff_message(db, ctx, conv, body):
    """Store a reply or internal note; LINE/Email replies are queued for delivery and a human reply stops the bot."""
    kind = schema.staff_message_kind(body)
    require(kind=='note' or conv['channel'] in ('web','line','email'),'เคสที่บันทึกเองรองรับบันทึกภายใน กรุณารับเรื่องผ่านหน้าช่วยเหลือเพื่อสนทนากับลูกค้า')
    D.begin(db)
    external = kind=='reply' and conv['channel'] in ('line','email')
    if external:
        channels.check_reply(db,ctx['tenant_id'],conv,body)
    mid = store_message(db,ctx['tenant_id'],conv['id'],ctx['id'],ctx['name'],kind,body)
    if external:
        channels.enqueue_reply(db,ctx,conv,mid)
    if kind=='reply':
        ai.stop_bot(db,conv['id'])
    audit.record(db,ctx['name'],'message.'+kind,conv['id'])
    db.commit()
    return mid


def request_ai_draft(db, ctx, conv):
    D.begin(db)
    job_id = ai.enqueue(db,ctx['tenant_id'],'draft',conv['id'],ctx['id'])
    ai.stop_bot(db,conv['id'])
    db.commit()
    return job_id


def set_ai_mode(db, ctx, conv, body):
    mode = schema.ai_mode(body)
    D.begin(db)
    if mode=='human':
        ai.handoff(db,conv['id'],'staff')
    else:
        require(conv['channel'] in ('web','line','email') and conv['status']=='open','เปิด AI ได้เฉพาะบทสนทนาที่เปิดอยู่')
        require(ai.bot_enabled(db,conv['id']) and ai.has_key(ctx['tenant_id']),'กรุณาเปิด Chatbot สำหรับช่องทางนี้และตั้งค่า API Key ก่อน')
        ai.resume_bot(db,conv['id'])
        audit.record(db,ctx['name'],'ai.resumed',conv['id'])
    db.commit()


def link_ticket(db, ctx, conv, body):
    """Attach the conversation to an existing case of the same customer and team, or open a new case for it."""
    D.begin(db)
    require(not tickets.is_conversation_linked(db,conv['id']),'บทสนทนานี้เชื่อมเคสแล้ว',409)
    if body.get('ticket_id'):
        ticket = get_scoped(db,'tickets',schema.linked_ticket_id(body),ctx)
        require(ticket['contact_id']==conv['contact_id'],'ต้องเป็นข้อมูลลูกค้าคนเดียวกันที่ยืนยันแล้ว')
        require(ticket['team_id']==conv['team_id'],'เคสและบทสนทนาต้องอยู่ทีมเดียวกัน')
        tid = ticket['id']
        tickets.link_conversation(db,tid,conv['id'])
    else:
        priority = ticket_schema.priority(body)
        tid = ticket_service.open_ticket(db,conv['contact_id'],conv['team_id'],conv['subject'],priority,conversation_id=conv['id'])
    audit.record(db,ctx['name'],'conversation.linked',tid,conv['id'])
    db.commit()
    return tid


def staff_attachment(db, ctx, file_id):
    """(name, mime, bytes) of a file in a conversation the user may see."""
    file = repository.attachment_with_conversation(db,file_id)
    require(file,'ไม่พบไฟล์',404)
    get_scoped(db,'conversations',file['conversation_id'],ctx)
    return attachment_content(ctx['tenant_id'],file)


def attachment_content(tenant_id, file):
    """(name, mime, bytes) of an attachment record for download."""
    content = repository.read_attachment_file(tenant_id,file['storage_key'])
    require(content is not None,'ไม่พบไฟล์',404)
    return file['name'],file['mime'],content


def message_list(db, conversation_id, public=False):
    """Messages with attachments, delivery state (staff only), and whether AI or the system wrote them."""
    result = repository.list_messages(db,conversation_id,public)
    for message in result:
        message['attachments'] = repository.attachments_of(db,message['id'])
        meta = repository.ai_meta(db,message['id'])
        message['channel_delivery'] = channels.delivery(db,message['id']) if not public else None
        message['source'] = meta['source'] if meta else 'human'
        message['citations'] = json.loads(meta['citations']) if meta else []
    return result


def store_message(db, tenant_id, conversation_id, author_id, author_name, kind, body):
    """Save a message with up to 3 attachments and update the conversation and its case (first response, reopening)."""
    text,uploads = schema.message_content(body)
    mid = uid()
    repository.insert_message(db,mid,conversation_id,author_id,author_name,kind,text)
    for name,mime,content in uploads:
        file_id = uid()
        repository.save_attachment_file(tenant_id,file_id,content)
        repository.insert_attachment(db,file_id,mid,name,mime,len(content),file_id)
    repository.touch(db,conversation_id)
    # LINE / Email replies count as the first response only once the provider accepts them.
    if kind=='reply' and repository.find(db,conversation_id)['channel'] not in ('line','email'):
        tickets.record_first_response(db,conversation_id)
    if kind=='customer':
        repository.reopen(db,conversation_id)
        tickets.reopen_for_conversation(db,conversation_id)
    return mid
