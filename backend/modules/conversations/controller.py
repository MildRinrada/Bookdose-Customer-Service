"""HTTP handlers for the staff inbox and attachment downloads."""
from backend.middleware.rate_limit import limited
from backend.modules.conversations import service


def list_conversations(req):
    return req.send(200,{'conversations':service.list_conversations(req.db,req.ctx)})


def show_conversation(req, conversation_id):
    conv = service.visible_conversation(req.db,req.ctx,conversation_id)
    service.mark_read(req.db,req.ctx,conv)
    return req.send(200,service.conversation_detail(req.db,conv))


def update_status(req, conversation_id):
    conv = service.visible_conversation(req.db,req.ctx,conversation_id)
    service.set_conversation_status(req.db,req.ctx,conv,req.body)
    return req.send(200,{'ok':True})


def post_message(req, conversation_id):
    conv = service.visible_conversation(req.db,req.ctx,conversation_id)
    return req.send(201,{'id':service.post_staff_message(req.db,req.ctx,conv,req.body,req.cd)})


def link_ticket(req, conversation_id):
    conv = service.visible_conversation(req.db,req.ctx,conversation_id)
    return req.send(201,{'id':service.link_ticket(req.db,req.ctx,conv,req.body)})


def request_ai_draft(req, conversation_id):
    conv = service.visible_conversation(req.db,req.ctx,conversation_id)
    limited(('ai-draft',req.ctx['tenant_id'],req.ctx['id']),10,60)
    return req.send(201,{'id':service.request_ai_draft(req.db,req.ctx,conv),'status':'pending'})


def summary(req, conversation_id):
    from backend.modules.ai import summary
    conv = service.visible_conversation(req.db,req.ctx,conversation_id)
    return req.send(200,summary.state(req.db,conv['id']))


def request_summary(req, conversation_id):
    """สรุปด้วย AI: no call when nothing new was written since the kept summary."""
    from backend.database import db as D
    from backend.modules.ai import summary
    conv = service.visible_conversation(req.db,req.ctx,conversation_id)
    limited(('ai-summary',req.ctx['tenant_id'],req.ctx['id']),10,60)
    D.begin(req.db)
    found = summary.request(req.db,req.ctx['tenant_id'],req.ctx,conv)
    req.db.commit()
    return req.send(201 if found['working'] else 200,found)


def set_ai_mode(req, conversation_id):
    conv = service.visible_conversation(req.db,req.ctx,conversation_id)
    service.set_ai_mode(req.db,req.ctx,conv,req.body)
    return req.send(200,{'ok':True})


def download_attachment(req, file_id):
    return req.send_download(*service.staff_attachment(req.db,req.ctx,file_id))


def pin_message(req, conversation_id, message_id):
    """ปักหมุดข้อความ of a conversation the member may see (conversations/pins.py)."""
    from backend.modules.conversations import pins
    conv = service.visible_conversation(req.db,req.ctx,conversation_id)
    return req.send(200,pins.pin(req.db,conv,message_id,req.ctx['name'],req.body))


def edit_message(req, conversation_id, message_id):
    """Correct a message already in the thread (its writer only)."""
    conv = service.visible_conversation(req.db,req.ctx,conversation_id)
    return req.send(200,service.edit_message(req.db,req.ctx,conv['id'],message_id,req.body))


def delete_message(req, conversation_id, message_id):
    """Take a message out of the thread (its writer, or the organization's owner)."""
    conv = service.visible_conversation(req.db,req.ctx,conversation_id)
    return req.send(200,service.delete_message(req.db,req.ctx,conv['id'],message_id))
