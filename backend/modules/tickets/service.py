"""Case rules: numbering and SLA deadlines, listing, opening, updating and exporting cases."""
import datetime as dt
import json

from backend.database import audit, db as D
from backend.middleware.access import visible_team, get_scoped, validate_team, validate_assignee
from backend.modules.ai import service as ai
from backend.modules.automation import service as automation
from backend.modules.contacts import repository as contacts, service as contact_service
from backend.modules.conversations import repository as conversations, service as conversation_service
from backend.modules.organization import repository as organization
from backend.modules.tickets import repository, schema
from backend.modules.trash import service as trash
from backend.utils.dates import iso, now, utc_now
from backend.utils.security import uid
from backend.utils.validation import require


def open_ticket(db, contact_id, team_id, subject, priority, assignee_id=None, category='ทั่วไป', conversation_id=None):
    """Create a case with SLA deadlines from the organization's settings and return its id.
    When linked to a conversation that already has a staff reply, that reply is its first response.
    Matching routing rules then set its priority, team and owner."""
    ticket_id = uid()
    settings = organization.settings(db)
    timestamp = utc_now()
    repository.insert(db,ticket_id,repository.next_number(db),subject,contact_id,team_id,assignee_id,priority,category,
                      iso(timestamp+dt.timedelta(hours=float(settings['response_hours']))),
                      iso(timestamp+dt.timedelta(hours=float(settings['resolution_hours']))))
    if conversation_id:
        repository.link_conversation(db,ticket_id,conversation_id)
        response = repository.first_staff_reply_time(db,conversation_id)
        if response:
            repository.set_first_response(db,ticket_id,response)
    automation.apply_rules(db,ticket_id)
    return ticket_id


def list_tickets(db, ctx):
    return repository.list_with_contacts(db,visible_team(ctx))


def create_ticket(cd, db, ctx, body):
    """Open a case recorded by staff (a 'manual' conversation), optionally with a first internal note."""
    D.begin(db)
    subject,contact_id = schema.new_ticket(body)
    require(contact_service.contact_visible(db,contact_id,ctx),'ไม่พบลูกค้า',404)
    team_id = body.get('team_id') or ctx['team_id']
    validate_team(db,ctx,team_id)
    assignee = body.get('assignee_id') or None
    validate_assignee(cd,ctx,assignee,team_id)
    priority = schema.priority(body)
    category = schema.category(body)
    conv_id = uid()
    conversations.insert(db,conv_id,contact_id,subject,'manual',team_id)
    tid = open_ticket(db,contact_id,team_id,subject,priority,assignee,category,conv_id)
    if body.get('body'):
        mid = conversation_service.store_message(db,ctx['tenant_id'],conv_id,ctx['id'],ctx['name'],'note',body)
        automation.record_mentions(cd,db,ctx,conversations.find(db,conv_id),mid,body['body'])
    audit.record(db,ctx['name'],'ticket.created',tid,subject)
    db.commit()
    return tid


def ticket_detail(db, ctx, ticket_id):
    ticket = get_scoped(db,'tickets',ticket_id,ctx)
    convs = conversations.for_ticket(db,ticket['id'])
    for conv in convs:
        conv['messages'] = conversation_service.message_list(db,conv['id'])
        conv['ai'] = ai.conversation_state(db,conv['id'])
        conv['line'] = conversations.line_thread(db,conv['id'])
        conv.pop('portal_token',None)
    return {'ticket':ticket,'contact':contacts.find(db,ticket['contact_id']),
            'conversations':convs,'events':audit.for_entity(db,ticket['id']),
            'automation':automation.ticket_extras(db,ticket['id'])}


def update_ticket(cd, db, ctx, ticket_id, body):
    """Change status, priority, team or assignee. Changes are audited; the case's conversations follow its team.
    Closing an open case sends the customer the satisfaction survey."""
    ticket = get_scoped(db,'tickets',ticket_id,ctx)
    status,priority,team_id,assignee = schema.ticket_update(body,ticket)
    validate_team(db,ctx,team_id)
    validate_assignee(cd,ctx,assignee,team_id)
    resolved_at = (ticket['resolved_at'] or now()) if status in ('resolved','closed') else None
    repository.update(db,ticket['id'],status,priority,team_id,assignee,resolved_at)
    conversations.set_team_for_ticket(db,ticket['id'],team_id)
    automation.after_status_change(db,ctx,ticket,status)
    changes = {key:{'before':ticket[key],'after':value} for key,value in [('status',status),('priority',priority),('team_id',team_id),('assignee_id',assignee)] if ticket[key]!=value}
    audit.record(db,ctx['name'],'ticket.updated',ticket['id'],json.dumps(changes,ensure_ascii=False))
    db.commit()


def export_tickets_csv(db, ctx):
    """CSV of the cases the user may see."""
    records = repository.export_rows(db,visible_team(ctx))
    data = schema.tickets_csv(records)
    audit.record(db,ctx['name'],'tickets.exported',ctx['tenant_id'],str(len(records)))
    db.commit()
    return data


def delete_ticket(db, ctx, ticket_id):
    """Remove a case. Its conversations are only unlinked - the customer's messages stay in the inbox - the
    deletion is recorded in the activity log with the case number, and the case itself waits in the recycle bin,
    so nothing about the work is lost by one wrong click."""
    ticket = get_scoped(db,'tickets',ticket_id,ctx)
    customer = contacts.find(db,ticket['contact_id']) or {}
    trash.capture(db,ctx,'ticket',ticket['id'],f"BD-{ticket['number']} · {ticket['subject']}",
                  {'tickets':[ticket],'ticket_conversations':repository.conversation_links(db,ticket['id'])},
                  detail=customer.get('name',''))
    repository.delete(db,ticket['id'])
    audit.record(db,ctx['name'],'ticket.deleted',ticket['id'],f"BD-{ticket['number']} · {ticket['subject']}")
    db.commit()
