"""HTTP handlers for cases."""
from backend.middleware.auth import require_role
from backend.modules.tickets import service


def list_tickets(req):
    return req.send(200,{'tickets':service.list_tickets(req.db,req.ctx)})


def create_ticket(req):
    return req.send(201,{'id':service.create_ticket(req.cd,req.db,req.ctx,req.body)})


def next_task(req):
    return req.send(200,service.next_task(req.cd,req.db,req.ctx))


def show_ticket(req, ticket_id):
    return req.send(200,service.ticket_detail(req.db,req.ctx,ticket_id))


def update_ticket(req, ticket_id):
    service.update_ticket(req.cd,req.db,req.ctx,ticket_id,req.body)
    return req.send(200,{'ok':True})


def snooze_ticket(req, ticket_id):
    return req.send(200,{'snoozed_until':service.snooze_ticket(req.db,req.ctx,ticket_id,req.body)})


def wake_ticket(req, ticket_id):
    service.wake_ticket(req.db,req.ctx,ticket_id)
    return req.send(200,{'ok':True})


def tag_ticket(req, ticket_id):
    from backend.modules.tickets import tags
    return req.send(200,{'tags':tags.set_for_ticket(req.db,req.ctx,ticket_id,req.body)})


def fill_fields(req, ticket_id):
    from backend.modules.tickets import fields
    return req.send(200,{'fields':fields.set_for_ticket(req.db,req.ctx,ticket_id,req.body)})


def export_tickets(req):
    return req.send(200,service.export_tickets_csv(req.db,req.ctx),'text/csv; charset=utf-8',
                    {'Content-Disposition':'attachment; filename="bookdose-tickets.csv"'})


@require_role('admin',message='เฉพาะผู้ดูแลองค์กรลบเคสได้')
def delete_ticket(req, ticket_id):
    service.delete_ticket(req.db,req.ctx,ticket_id)
    return req.send(200,{'deleted':ticket_id})
