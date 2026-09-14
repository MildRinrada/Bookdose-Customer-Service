"""HTTP handlers for the staff inbox and attachment downloads."""
from backend.middleware.rate_limit import limited
from backend.modules.conversations import service


def list_conversations(req):
    return req.send(200,{'conversations':service.list_conversations(req.db,req.ctx)})


def show_conversation(req, conversation_id):
    conv = service.visible_conversation(req.db,req.ctx,conversation_id)
    return req.send(200,service.conversation_detail(req.db,conv))


def update_status(req, conversation_id):
    conv = service.visible_conversation(req.db,req.ctx,conversation_id)
    service.set_conversation_status(req.db,req.ctx,conv,req.body)
    return req.send(200,{'ok':True})


def post_message(req, conversation_id):
    conv = service.visible_conversation(req.db,req.ctx,conversation_id)
    return req.send(201,{'id':service.post_staff_message(req.db,req.ctx,conv,req.body)})


def link_ticket(req, conversation_id):
    conv = service.visible_conversation(req.db,req.ctx,conversation_id)
    return req.send(201,{'id':service.link_ticket(req.db,req.ctx,conv,req.body)})


def request_ai_draft(req, conversation_id):
    conv = service.visible_conversation(req.db,req.ctx,conversation_id)
    limited(('ai-draft',req.ctx['tenant_id'],req.ctx['id']),10,60)
    return req.send(201,{'id':service.request_ai_draft(req.db,req.ctx,conv),'status':'pending'})


def set_ai_mode(req, conversation_id):
    conv = service.visible_conversation(req.db,req.ctx,conversation_id)
    service.set_ai_mode(req.db,req.ctx,conv,req.body)
    return req.send(200,{'ok':True})


def download_attachment(req, file_id):
    return req.send_download(*service.staff_attachment(req.db,req.ctx,file_id))
