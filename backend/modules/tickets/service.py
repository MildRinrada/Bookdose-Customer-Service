"""Case rules: numbering and SLA deadlines, listing, opening, updating and exporting cases."""
import datetime as dt
import json

from backend.database import audit, db as D
from backend.middleware.access import visible_team, get_scoped, validate_team, validate_assignee
from backend.modules.ai import service as ai
from backend.modules.automation import service as automation
from backend.modules.automation.service import SYSTEM_ACTOR
from backend.modules.contacts import repository as contacts, service as contact_service
from backend.modules.conversations import repository as conversations, service as conversation_service
from backend.modules.organization import repository as organization
from backend.modules.tickets import repository, schema
from backend.modules.trash import service as trash
from backend.realtime import events as realtime
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
    # A new case: staff lists, and the customer's cases; its conversation now shows the case (and may have moved team).
    realtime.ticket(db,ticket_id,public=True,teams=(team_id,),conversations_listed=True)
    if conversation_id:
        realtime.conversation(db,conversation_id,teams=(team_id,))
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
    created = D.one(db,'SELECT * FROM tickets WHERE id=?',(tid,))
    if assignee and created['assignee_id']==assignee:
        notify_assigned(db,created,assignee,ctx)
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
    if status not in ('resolved','closed'):
        repository.note_reopen(db,'id=?',(ticket['id'],),'staff')
    repository.update(db,ticket['id'],status,priority,team_id,assignee,resolved_at)
    conversations.set_team_for_ticket(db,ticket['id'],team_id)
    automation.after_status_change(db,ctx,ticket,status)
    # Priority, team and assignee are for staff; the customer hears only about a new status. The team that had the
    # case until now hears about it moving away.
    realtime.ticket(db,ticket['id'],public=status!=ticket['status'],teams=(ticket['team_id'],),conversations_listed=True)
    for conv in conversations.for_ticket(db,ticket['id']):
        realtime.conversation(db,conv['id'],public=status!=ticket['status'],teams=(ticket['team_id'],))
    changes = {key:{'before':ticket[key],'after':value} for key,value in [('status',status),('priority',priority),('team_id',team_id),('assignee_id',assignee)] if ticket[key]!=value}
    audit.record(db,ctx['name'],'ticket.updated',ticket['id'],json.dumps(changes,ensure_ascii=False))
    if assignee and assignee!=ticket['assignee_id']:
        notify_assigned(db,ticket,assignee,ctx)
    db.commit()


NEXT_SOON_HOURS = 2   # "ใกล้เกิน": the same window as ต้องดำเนินการทันที on the overview


def next_task(cd, db, ctx):
    """รับงานถัดไป: the one case the member should open now - their own past its SLA, then their own due within two
    hours, then the case of their team that has waited longest for anyone, which becomes theirs. Returns the case and
    why, or None when there is nothing to do."""
    D.begin(db)
    mine = repository.my_most_urgent(db,ctx['id'])
    if mine and mine['due']<=iso(utc_now()+dt.timedelta(hours=NEXT_SOON_HOURS)):
        db.commit()
        return {'ticket':{'id':mine['id'],'number':mine['number'],'subject':mine['subject']},
                'reason':'overdue' if mine['due']<now() else 'due_soon','taken':False}
    waiting = repository.oldest_unassigned(db,ctx['team_id']) if ctx['team_id'] else None
    if waiting and organization.is_active_team_member(cd,ctx['tenant_id'],ctx['id'],waiting['team_id']) and repository.take(db,waiting['id'],ctx['id']):
        audit.record(db,ctx['name'],'ticket.updated',waiting['id'],
                     json.dumps({'assignee_id':{'before':None,'after':ctx['id']}},ensure_ascii=False))
        realtime.ticket(db,waiting['id'],public=False,teams=(waiting['team_id'],),conversations_listed=True)
        for conv in conversations.for_ticket(db,waiting['id']):
            realtime.conversation(db,conv['id'],public=False)
        db.commit()
        return {'ticket':{'id':waiting['id'],'number':waiting['number'],'subject':waiting['subject']},'reason':'unassigned','taken':True}
    db.commit()
    # Nothing urgent and nobody waiting: the member's own next case, if any, is still the best thing to open.
    if mine:
        return {'ticket':{'id':mine['id'],'number':mine['number'],'subject':mine['subject']},'reason':'mine','taken':False}
    return {'ticket':None,'reason':'none','taken':False}


# พักเคสไว้ก่อน
def snooze_ticket(db, ctx, ticket_id, body):
    """Take a case out of the working lists until a moment the member picks, then hand it back by itself.
    Its SLA clocks keep running: pausing is the team stepping away from a case, not the customer agreeing to wait."""
    ticket = get_scoped(db,'tickets',ticket_id,ctx)
    require(ticket['status'] not in ('resolved','closed'),'เคสที่จบแล้วไม่ต้องพัก')
    until,note = schema.snooze_form(body)
    repository.snooze(db,ticket['id'],until,note,ctx['name'])
    audit.record(db,ctx['name'],'ticket.snoozed',ticket['id'],json.dumps({'until':until,'note':note},ensure_ascii=False))
    realtime.ticket(db,ticket['id'],teams=(ticket['team_id'],),conversations_listed=True)
    db.commit()
    return until


def wake_ticket(db, ctx, ticket_id):
    """Back into the queue before its time, because whatever it was waiting for arrived."""
    ticket = get_scoped(db,'tickets',ticket_id,ctx)
    require(ticket['snoozed_until'],'เคสนี้ไม่ได้พักอยู่',404)
    repository.wake(db,ticket['id'])
    audit.record(db,ctx['name'],'ticket.woken',ticket['id'],ticket['snooze_note'])
    realtime.ticket(db,ticket['id'],teams=(ticket['team_id'],),conversations_listed=True)
    db.commit()


def wake_due(db):
    """The automation worker's round: every paused case whose moment has come goes back to the queue, and whoever
    owns it hears about it - a case that comes back silently is a case that was never really put down."""
    from backend.modules.staff_prefs import service as staff_prefs
    D.begin(db)
    due = repository.due_snoozes(db,now())
    if not due:
        db.commit()
        return 0
    for ticket in due:
        repository.wake(db,ticket['id'])
        audit.record(db,SYSTEM_ACTOR,'ticket.woken',ticket['id'],ticket['snooze_note'])
        staff_prefs.queue(db,ticket['assignee_id'],'snoozed',f"เคส BD-{ticket['number']} กลับมาแล้ว",
                          f"{ticket['subject']}\n{ticket['snooze_note'] or 'ครบเวลาที่พักไว้'}",f"/tickets/{ticket['id']}")
        realtime.ticket(db,ticket['id'],teams=(ticket['team_id'],),conversations_listed=True)
    db.commit()
    return len(due)


def wake_for_customer_reply(db, conversation_id):
    """Called where a customer's message reopens a case: a paused case is unpaused by the very thing it was waiting
    for. Runs inside the caller's transaction."""
    for ticket in repository.wake_for_conversation(db,conversation_id):
        audit.record(db,SYSTEM_ACTOR,'ticket.woken',ticket['id'],'ลูกค้าตอบกลับ')


def notify_assigned(db, ticket, assignee, ctx=None):
    """The new owner of a case hears about it by email when they asked to (not when they took it themselves)."""
    from backend.modules.staff_prefs import service as staff_prefs
    by = f"โดย {ctx['name']}" if ctx else 'โดยระบบอัตโนมัติ'
    staff_prefs.queue(db,assignee,'assigned',f"เคส BD-{ticket['number']} มอบหมายให้คุณ",f"{ticket['subject']}\n{by}",
                      f"/tickets/{ticket['id']}",actor_id=ctx['id'] if ctx else None)


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
    realtime.ticket(db,ticket['id'],public=True,conversations_listed=True)
    repository.delete(db,ticket['id'])
    audit.record(db,ctx['name'],'ticket.deleted',ticket['id'],f"BD-{ticket['number']} · {ticket['subject']}")
    db.commit()
