"""Conversation rules: the staff inbox, replies and notes (with @mentions), AI draft and mode, linking to a case,
and storing messages (used by staff, the support page and LINE / Email / Facebook)."""
import json

from backend.modules.customers import repository as customer_repository
from backend.database import audit, db as D
from backend.middleware.access import visible_team, get_scoped
from backend.modules.ai import service as ai
from backend.modules.automation import service as automation
from backend.modules.channels import facebook, service as channels
from backend.modules.contacts import repository as contacts
from backend.modules.conversations import repository, schema
from backend.modules.customers import service as customers
from backend.modules.tickets import repository as tickets, schema as ticket_schema, service as ticket_service
from backend.realtime import events as realtime
from backend.utils.dates import now
from backend.utils.security import uid
from backend.utils.validation import require

# Channels whose replies are delivered by a provider (queued), rather than read on the support page.
EXTERNAL = ('line','email','facebook')


def visible_conversation(db, ctx, conversation_id):
    return get_scoped(db,'conversations',conversation_id,ctx)


def list_conversations(db, ctx):
    """Each row carries guest: {follow: [...]} when a guest of guest web chat started it (else null)."""
    from backend.modules.guest import service as guest
    found = repository.list_with_previews(db,visible_team(ctx))
    reach = guest.reach(db,[c['contact_id'] for c in found])
    return [{**c,'guest':reach.get(c['contact_id'])} for c in found]


def conversation_detail(db, conv):
    conv.pop('portal_token',None)
    conv['ai'] = ai.conversation_state(db,conv['id'])
    conv['line'] = repository.line_thread(db,conv['id'])
    conv['category'] = customer_repository.category_of(db,conv['id'])
    # A guest of guest web chat: the inbox shows a badge and how the team's reply can reach them.
    from backend.modules.guest import service as guest
    conv['guest'] = guest.reach(db,[conv['contact_id']]).get(conv['contact_id'])
    contact = contacts.find(db,conv['contact_id'])
    if contact:
        contact['guest'] = conv['guest']
    return {'conversation':conv,'messages':message_list(db,conv['id']),
            'contact':contact,
            'ticket':tickets.for_conversation(db,conv['id']),
            # Read receipt: when the customer (account or guest) last opened this web conversation.
            'customer_read_at':repository.customer_read_at(db,conv['id'],conv['contact_id']) if conv['channel']=='web' else None}


def mark_read(db, ctx, conv):
    """A staff member opened the conversation: when the customer wrote after the team last read it, record the read
    (inside the request's transaction) and tell the customer's pages."""
    if conv['channel']!='web':
        return
    latest = repository.last_message_at(db,conv['id'],'customer')
    read_at = repository.staff_read_at(db,conv['id'])
    # One-second timestamps: a read in the same second as the message is written again on the next open.
    if not latest or (read_at and read_at>latest):
        return
    moment = now()
    repository.set_staff_read(db,conv['id'],ctx['id'],moment)
    realtime.staff_read(db,conv,moment)


def set_conversation_status(db, ctx, conv, body):
    status = schema.conversation_status(body)
    repository.set_status(db,conv['id'],status)
    if status=='closed':
        ai.stop_bot(db,conv['id'])
    audit.record(db,ctx['name'],'conversation.'+status,conv['id'])
    realtime.conversation(db,conv['id'])
    db.commit()


def post_staff_message(db, ctx, conv, body, cd=None):
    """Store a reply or internal note in its own transaction. cd (the control database) lets a note notify the
    members it @mentions."""
    kind = schema.staff_message_kind(body)
    D.begin(db)
    mid = store_staff_message(db,ctx,conv,kind,body,cd)
    db.commit()
    return mid


def store_staff_message(db, ctx, conv, kind, body, cd=None):
    """A reply or internal note inside the caller's transaction (also used by macros). LINE / Email / Facebook
    replies are queued for delivery, a human reply stops the bot, and a note records its @mentions."""
    require(kind=='note' or conv['channel'] in ('web',)+EXTERNAL,'เคสที่บันทึกเองรองรับบันทึกภายใน กรุณารับเรื่องผ่านหน้าลูกค้าเพื่อสนทนากับลูกค้า')
    external = kind=='reply' and conv['channel'] in EXTERNAL
    provider = facebook if conv['channel']=='facebook' else channels
    author = ctx['name']
    if kind=='reply':
        # What the customer sees of the member: the name they chose for customers, and their signature under it.
        from backend.modules.staff_prefs import service as staff_prefs
        if cd is None:
            with D.control() as own:
                author,text = staff_prefs.reply_parts(own,ctx['id'],author,str(body.get('body') or ''))
        else:
            author,text = staff_prefs.reply_parts(cd,ctx['id'],author,str(body.get('body') or ''))
        body = {**body,'body':text}
    if external:
        provider.check_reply(db,ctx['tenant_id'],conv,body)
    mid = store_message(db,ctx['tenant_id'],conv['id'],ctx['id'],author,kind,body)
    if external:
        provider.enqueue_reply(db,ctx,conv,mid)
    if kind=='reply':
        ai.stop_bot(db,conv['id'])
    else:
        automation.record_mentions(cd,db,ctx,conv,mid,str(body.get('body') or ''))
    audit.record(db,ctx['name'],'message.'+kind,conv['id'])
    return mid


def request_ai_draft(db, ctx, conv):
    D.begin(db)
    job_id = ai.enqueue(db,ctx['tenant_id'],'draft',conv['id'],ctx['id'])
    bot = ai.conversation_state(db,conv['id'])['mode']=='bot'
    ai.stop_bot(db,conv['id'])
    # The draft is for staff; the customer only sees the chatbot stop, when it was answering.
    realtime.conversation(db,conv['id'],public=bot,listed=False)
    db.commit()
    return job_id


def set_ai_mode(db, ctx, conv, body):
    mode = schema.ai_mode(body)
    D.begin(db)
    if mode=='human':
        ai.handoff(db,conv['id'],'staff')
    else:
        require(conv['channel'] in ('web','line','email') and conv['status']=='open','เปิด AI ได้เฉพาะบทสนทนาที่เปิดอยู่')
        require(ai.bot_enabled(db,conv['id']) and ai.has_key(ctx['tenant_id']),'กรุณาเปิด Chatbot สำหรับช่องทางนี้และเชื่อม AI ก่อน')
        ai.resume_bot(db,conv['id'])
        audit.record(db,ctx['name'],'ai.resumed',conv['id'])
    realtime.conversation(db,conv['id'],listed=False)
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
        category = customer_repository.category_of(db,conv['id']) or 'ทั่วไป'
        tid = ticket_service.open_ticket(db,conv['contact_id'],conv['team_id'],conv['subject'],priority,category=category,conversation_id=conv['id'])
    audit.record(db,ctx['name'],'conversation.linked',tid,conv['id'])
    realtime.conversation(db,conv['id'])
    realtime.ticket(db,tid,public=True)
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
    """Messages with attachments, delivery state (staff only), whether AI or the system wrote them, and whether a
    message is the satisfaction survey."""
    result = repository.list_messages(db,conversation_id,public)
    surveys = automation.survey_message_ids(db,conversation_id)
    for message in result:
        message['attachments'] = repository.attachments_of(db,message['id'])
        meta = repository.ai_meta(db,message['id'])
        message['channel_delivery'] = channels.delivery(db,message['id']) if not public else None
        message['source'] = meta['source'] if meta else 'human'
        message['citations'] = json.loads(meta['citations']) if meta else []
        message['survey'] = message['id'] in surveys
    return result


def store_message(db, tenant_id, conversation_id, author_id, author_name, kind, body):
    """Save a message with up to 3 attachments and update the conversation and its case (first response, reopening).
    A customer's answer to the satisfaction survey is recorded as the rating and reopens nothing; the first customer
    message of a conversation goes through the routing rules, which may open its case."""
    text,uploads = schema.message_content(body)
    mid = uid()
    repository.insert_message(db,mid,conversation_id,author_id,author_name,kind,text)
    for name,mime,content in uploads:
        file_id = uid()
        repository.save_attachment_file(tenant_id,file_id,content)
        repository.insert_attachment(db,file_id,mid,name,mime,len(content),file_id)
    repository.touch(db,conversation_id)
    channel = repository.find(db,conversation_id)['channel']
    # LINE / Email / Facebook replies count as the first response only once the provider accepts them.
    if kind=='reply' and channel not in EXTERNAL:
        tickets.record_first_response(db,conversation_id)
    # A support-page customer with an account hears about the reply by email (unless they read it on the page first).
    if kind=='reply' and channel=='web':
        customers.notify_reply(db,conversation_id)
    # Every channel stores here (staff, the customer's page, guests, LINE / Email / Facebook workers): the pages that
    # may see the conversation hear about it once this transaction commits; an internal note reaches staff only.
    realtime.conversation(db,conversation_id,public=kind!='note')
    if kind=='customer':
        if not uploads and automation.take_rating(db,conversation_id,text):
            return mid
        repository.reopen(db,conversation_id)
        tickets.reopen_for_conversation(db,conversation_id)
        if repository.customer_message_count(db,conversation_id)==1:
            automation.on_new_conversation(db,conversation_id)
        else:
            # The case's owner asked to hear when the customer answers (ตั้งค่าบัญชี → การแจ้งเตือน).
            from backend.modules.staff_prefs import service as staff_prefs
            ticket = tickets.for_conversation(db,conversation_id)
            if ticket and ticket['assignee_id']:
                staff_prefs.queue(db,ticket['assignee_id'],'customer_reply',f"ลูกค้าตอบกลับในเคส BD-{ticket['number']}",
                                  f"{ticket['subject']}\n\n{text[:300]}",f"/tickets/{ticket['id']}")
    return mid
