"""HTTP handlers for the public support page. req.org is the organization;
req.conversation is the visitor's conversation (only on 'visitor' routes)."""
from backend.modules.portal import service


def organization_info(req):
    return req.send(200,service.portal_info(req.db,req.org))


def open_conversation(req):
    token,conv_id = service.open_conversation(req.db,req.org['id'],req.body)
    return req.send(201,{'token':token,'conversation_id':conv_id})


def conversation(req):
    return req.send(200,service.conversation_view(req.db,req.conversation))


def hand_off(req):
    service.hand_off_to_staff(req.db,req.conversation)
    return req.send(200,{'ok':True})


def post_message(req):
    return req.send(201,{'id':service.post_customer_message(req.db,req.org['id'],req.conversation,req.body)})


def rate(req):
    service.rate_service(req.db,req.conversation,req.body)
    return req.send(200,{'ok':True})


def download_attachment(req, file_id):
    return req.send_download(*service.public_attachment(req.db,req.org['id'],req.conversation,file_id))
