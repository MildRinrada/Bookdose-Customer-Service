"""HTTP handlers for customers."""
from backend.modules.contacts import service


def list_contacts(req):
    return req.send(200,{'contacts':service.list_contacts(req.db,req.ctx)})


def contact_profile(req, contact_id):
    return req.send(200,service.contact_profile(req.db,req.ctx,contact_id))


def create_contact(req):
    return req.send(201,{'id':service.create_contact(req.db,req.ctx,req.body)})


def update_contact(req, contact_id):
    service.update_contact(req.db,req.ctx,contact_id,req.body)
    return req.send(200,{'ok':True})


def merge_contacts(req, contact_id):
    service.merge_contacts(req.db,req.ctx,contact_id,req.body)
    return req.send(200,{'ok':True})


def delete_contact(req, contact_id):
    service.delete_contact(req.db,req.ctx,contact_id)
    return req.send(200,{'deleted':contact_id})
