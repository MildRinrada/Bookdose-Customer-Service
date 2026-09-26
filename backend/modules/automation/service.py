"""Automation: routing rules for new cases (channel + keywords -> priority, team, owner), SLA escalation to the team
lead, macros (one click, several steps) with follow-up reminders, the CSAT survey sent when a case is closed,
@mentions in internal notes, and the numbers behind the manager's live view (who is active, busy hours, satisfaction).
Channel services are imported inside functions: they import the case and conversation services, which import this."""
import datetime as dt
import json
import sqlite3
import threading
import time

from backend.extensions import monitor
from backend.database import audit, db as D
from backend.exceptions.errors import APIError, ChannelError
from backend.middleware.access import get_scoped, visible_team
from backend.modules.ai import repository as ai_repository
from backend.modules.automation import repository, schema
from backend.modules.channels import repository as channel_repository
from backend.modules.contacts import repository as contacts
from backend.modules.conversations import repository as conversations
from backend.modules.customers import notify as customer_notify, service as customers
from backend.modules.organization import repository as organization
from backend.modules.platform import repository as tenants
from backend.modules.tickets import repository as tickets
from backend.realtime import events as realtime
from backend.utils.dates import after, iso, now, utc_now
from backend.utils.security import uid
from backend.utils.validation import require

SYSTEM_ACTOR = 'ระบบอัตโนมัติ'
DONE = ('resolved','closed')
REPLYABLE = ('web','line','email','facebook','instagram')   # channels a reply reaches the customer on
SURVEY_DAYS = 7                                  # a survey answer is accepted this long after it was sent
TEAM_MENTION = '@ทีม'                            # mentions everyone in the conversation's team


def settings(db):
    values = organization.settings(db)
    return {'escalation_enabled':values.get('escalation_enabled','1')=='1',
            'escalation_minutes':int(float(values.get('escalation_minutes','15'))),
            'csat_enabled':values.get('csat_enabled','1')=='1','csat_message':values.get('csat_message','')}


# Administration (admins and team leads)
def automation_page(db):
    return {'rules':repository.rules(db),'macros':repository.macros(db),'settings':settings(db),
            'escalations':repository.recent_escalations(db,20)}


def _check_rule(cd, db, ctx, values):
    if values['set_team_id']:
        require(organization.team_exists(db,values['set_team_id']),'ไม่พบทีม')
    if values['set_assignee_id']:
        member = organization.find_active_membership(cd,ctx['tenant_id'],values['set_assignee_id'])
        require(member,'ผู้รับผิดชอบต้องเป็นสมาชิกที่ใช้งานอยู่')
        require(not values['set_team_id'] or member['team_id']==values['set_team_id'],'ผู้รับผิดชอบต้องอยู่ในทีมที่เลือก')


def save_rule(cd, db, ctx, rule_id, body):
    values = schema.rule_form(body)
    _check_rule(cd,db,ctx,values)
    if rule_id:
        require(repository.find_rule(db,rule_id),'ไม่พบกฎ',404)
        repository.update_rule(db,rule_id,values)
    else:
        rule_id = uid()
        repository.insert_rule(db,rule_id,values,ctx['id'])
    audit.record(db,ctx['name'],'automation.rule_saved',rule_id,values['name'])
    db.commit()
    return rule_id


def delete_rule(db, ctx, rule_id):
    rule = repository.find_rule(db,rule_id)
    require(rule,'ไม่พบกฎ',404)
    repository.delete_rule(db,rule_id)
    audit.record(db,ctx['name'],'automation.rule_deleted',rule_id,rule['name'])
    db.commit()


def save_macro(db, ctx, macro_id, body):
    values = schema.macro_form(body)
    if macro_id:
        require(repository.find_macro(db,macro_id),'ไม่พบ Macro',404)
        repository.update_macro(db,macro_id,values)
    else:
        macro_id = uid()
        repository.insert_macro(db,macro_id,values,ctx['id'])
    audit.record(db,ctx['name'],'automation.macro_saved',macro_id,values['name'])
    db.commit()
    return macro_id


def delete_macro(db, ctx, macro_id):
    macro = repository.find_macro(db,macro_id)
    require(macro,'ไม่พบ Macro',404)
    repository.delete_macro(db,macro_id)
    audit.record(db,ctx['name'],'automation.macro_deleted',macro_id,macro['name'])
    db.commit()


def save_settings(db, ctx, body):
    for key,value in schema.settings_form(body):
        organization.update_setting(db,key,value)
    audit.record(db,ctx['name'],'automation.settings_updated',ctx['tenant_id'])
    db.commit()


def macro_list(db):
    return repository.macros(db)


# Routing rules
def _customer_text(db, conversation_id):
    return '\n'.join(m['body'] for m in conversations.list_messages(db,conversation_id,True) if m['kind']=='customer')


def matching_rules(db, channel, text):
    """Enabled rules whose channel (or 'any') and at least one keyword (or none) match, oldest first."""
    text = text.lower()
    found = []
    for rule in repository.enabled_rules(db):
        words = [w for w in rule['keywords'].split('\n') if w]
        if (not rule['channel'] or rule['channel']==channel) and (not words or any(w.lower() in text for w in words)):
            found.append(rule)
    return found


def apply_rules(db, ticket_id):
    """Run the matching rules on a case that was just opened, inside the caller's transaction; returns their names.
    An owner that is not an active member of the case's final team is left out, as when staff assign by hand."""
    ticket = D.find_in_team(db,'tickets',ticket_id)
    convs = conversations.for_ticket(db,ticket_id)
    channel = convs[0]['channel'] if convs else 'manual'
    text = '\n'.join([ticket['subject'],*(c['subject']+'\n'+_customer_text(db,c['id']) for c in convs)])
    matched = matching_rules(db,channel,text)
    if not matched:
        return []
    priority,team,assignee = ticket['priority'],ticket['team_id'],ticket['assignee_id']
    for rule in matched:
        priority = rule['set_priority'] or priority
        if rule['set_team_id'] and organization.team_exists(db,rule['set_team_id']):
            team = rule['set_team_id']
        assignee = rule['set_assignee_id'] or assignee
    away = ''
    if assignee:
        from backend.modules.staff_prefs import service as staff_prefs
        with D.control() as cd:
            if not organization.is_active_team_member(cd,channel_repository.tenant_id_of(db),assignee,team):
                assignee = None
            elif assignee!=ticket['assignee_id']:
                # A member on a break, busy, away, off shift or on leave gets no new case from a rule: it waits for
                # the team (and the SLA escalation) instead.
                state = staff_prefs.availability(staff_prefs.prefs_of(cd,assignee))
                if not state['available']:
                    away = f" · ไม่มอบหมายให้ผู้รับผิดชอบตามกฎ เพราะ{state['reason']}"
                    assignee = ticket['assignee_id']
    tickets.update(db,ticket_id,ticket['status'],priority,team,assignee,ticket['resolved_at'])
    if priority!=ticket['priority']:
        # An urgent case is measured against the urgent targets from the start (tickets/sla.py).
        from backend.modules.tickets import sla
        sla.follow_priority(db,ticket_id)
    conversations.set_team_for_ticket(db,ticket_id,team)
    names = [rule['name'] for rule in matched]
    audit.record(db,SYSTEM_ACTOR,'automation.rule_applied',ticket_id,', '.join(names)+away)
    if assignee and assignee!=ticket['assignee_id']:
        from backend.modules.staff_prefs import service as staff_prefs
        staff_prefs.queue(db,assignee,'assigned',f"เคส BD-{ticket['number']} มอบหมายให้คุณ",
                          f"{ticket['subject']}\nโดยกฎการกระจายงาน {', '.join(names)}",f'/tickets/{ticket_id}')
    return names


def on_new_conversation(db, conversation_id):
    """The first customer message of a conversation without a case: when a rule matches, the case is opened right
    away (the rule then sets its priority, team and owner). Returns the new case id or None."""
    if tickets.is_conversation_linked(db,conversation_id):
        return None
    conv = conversations.find(db,conversation_id)
    if conv['channel']=='manual' or not matching_rules(db,conv['channel'],conv['subject']+'\n'+_customer_text(db,conversation_id)):
        return None
    from backend.modules.tickets import service as ticket_service
    return ticket_service.open_ticket(db,conv['contact_id'],conv['team_id'],conv['subject'],'normal',conversation_id=conversation_id)


# SLA escalation
def team_lead(members, load, team_id, available=None):
    """The organization owner an escalated case goes to, or None: an owner in the case's team before one elsewhere,
    one available for new cases (`available`: user ids, ตั้งค่าบัญชี → สถานะการทำงาน) before one who is not, then the
    one with the fewest open cases. When no owner is available, the case still goes to one rather than to nobody."""
    leads = [m for m in members if m['active'] and m['role']=='admin']
    leads.sort(key=lambda m:(available is not None and m['id'] not in available,m['team_id']!=team_id,load.get(m['id'],0),m['name']))
    return leads[0] if leads else None


def escalate_due(cd, db, tenant_id):
    """Move cases nobody took or answered within the set minutes to the team lead, and flag owned cases whose
    first-reply deadline is that close to the lead. Each case is escalated once. Returns how many were escalated."""
    cfg = settings(db)
    if not cfg['escalation_enabled']:
        return 0
    minutes = cfg['escalation_minutes']
    D.begin(db)
    unclaimed = repository.unclaimed_before(db,after(minutes=-minutes))
    at_risk = repository.unanswered_due_before(db,after(minutes=minutes))
    if not unclaimed and not at_risk:
        db.commit()
        return 0
    from backend.modules.staff_prefs import service as staff_prefs
    members = organization.tenant_members(cd,tenant_id)
    names = {m['id']:m['name'] for m in members}
    available = {user_id for user_id,state in staff_prefs.availability_of(cd,[m['id'] for m in members]).items() if state['available']}
    load = repository.open_count_by_assignee(db)
    for t in unclaimed:
        lead = team_lead(members,load,t['team_id'],available)
        if lead:
            tickets.update(db,t['id'],t['status'],t['priority'],t['team_id'],lead['id'],t['resolved_at'])
            load[lead['id']] = load.get(lead['id'],0)+1
            staff_prefs.queue(db,lead['id'],'assigned',f"เคส BD-{t['number']} ยกระดับมาหาคุณ",
                              f"{t['subject']}\nไม่มีผู้รับเรื่องภายใน {minutes} นาที",f"/tickets/{t['id']}")
        repository.insert_escalation(db,t['id'],'unclaimed',None,lead['id'] if lead else None)
        realtime.ticket(db,t['id'])
        audit.record(db,SYSTEM_ACTOR,'ticket.escalated',t['id'],
                     f"ไม่มีผู้รับเรื่องภายใน {minutes} นาที · {'ย้ายให้ '+lead['name'] if lead else 'ไม่พบเจ้าขององค์กรที่ใช้งานอยู่'}")
    for t in at_risk:
        lead = team_lead(members,load,t['team_id'],available)
        repository.insert_escalation(db,t['id'],'sla_risk',t['assignee_id'],lead['id'] if lead else None)
        realtime.ticket(db,t['id'])
        staff_prefs.queue(db,t['assignee_id'],'sla',f"เคส BD-{t['number']} ใกล้ครบกำหนด SLA",
                          f"{t['subject']}\nยังไม่ได้ตอบกลับลูกค้าครั้งแรก",f"/tickets/{t['id']}")
        audit.record(db,SYSTEM_ACTOR,'ticket.escalated',t['id'],
                     f"{names.get(t['assignee_id'],'ผู้รับผิดชอบ')} ยังไม่ตอบกลับครั้งแรก ใกล้ครบ SLA · {'แจ้ง '+lead['name'] if lead else 'ไม่พบเจ้าขององค์กรที่ใช้งานอยู่'}")
    db.commit()
    return len(unclaimed)+len(at_risk)


# Sending to the customer through the conversation's channel
def _check_external(db, tenant_id, conv, body):
    from backend.modules.channels import facebook, service as channels
    if conv['channel'] in facebook.KINDS:
        facebook.check_reply(db,tenant_id,conv,body)
    elif conv['channel'] in ('line','email'):
        channels.check_reply(db,tenant_id,conv,body)


def _enqueue_external(db, ctx, conv, message_id):
    from backend.modules.channels import facebook, service as channels
    if conv['channel'] in facebook.KINDS:
        facebook.enqueue_reply(db,ctx,conv,message_id)
    elif conv['channel'] in ('line','email'):
        channels.enqueue_reply(db,ctx,conv,message_id)


def _reply_conversation(db, ticket):
    """The case's most recently active conversation that reaches the customer, or None (cases recorded by staff)."""
    convs = [c for c in conversations.for_ticket(db,ticket['id']) if c['channel'] in REPLYABLE]
    return max(convs,key=lambda c:c['updated_at']) if convs else None


# Macros
def _fill(text, ticket, contact, ctx):
    return (text.replace('{customer}',contact['name'] if contact else 'ลูกค้า')
                .replace('{case}',f"BD-{ticket['number']}" if ticket else '').replace('{agent}',ctx['name']))


def set_ticket_status(db, ctx, ticket, status):
    """Change a case's status as the case screen does, and send the survey when this closes it."""
    resolved_at = (ticket['resolved_at'] or now()) if status in DONE else None
    tickets.update(db,ticket['id'],status,ticket['priority'],ticket['team_id'],ticket['assignee_id'],resolved_at)
    audit.record(db,ctx['name'],'ticket.updated',ticket['id'],json.dumps({'status':{'before':ticket['status'],'after':status}},ensure_ascii=False))
    after_status_change(db,ctx,ticket,status)
    realtime.ticket(db,ticket['id'],public=True)


def run_macro(cd, db, ctx, macro_id, body):
    """One click, several steps in one transaction: reply with the template, change the case's status, set a reminder.
    Steps that do not apply (no channel to reply on, no case yet) are reported as skipped instead of failing."""
    kind,target = schema.run_target(body)
    D.begin(db)
    macro = repository.find_macro(db,macro_id)
    require(macro,'ไม่พบ Macro',404)
    if kind=='ticket':
        ticket = get_scoped(db,'tickets',target,ctx)
        conv = _reply_conversation(db,ticket)
    else:
        conv = get_scoped(db,'conversations',target,ctx)
        ticket = tickets.for_conversation(db,conv['id'])
    contact = contacts.find(db,(ticket or conv)['contact_id'])
    done,skipped = [],[]
    if macro['reply']:
        if conv and conv['channel'] in REPLYABLE:
            from backend.modules.conversations import service as conversation_service
            conversation_service.store_staff_message(db,ctx,conv,'reply',{'body':_fill(macro['reply'],ticket,contact,ctx)},cd)
            done.append('reply')
        else:
            skipped.append('reply')
    if macro['set_status'] or macro['followup_hours']:
        if ticket:
            ticket = D.find_in_team(db,'tickets',ticket['id'])
            if macro['set_status'] and macro['set_status']!=ticket['status']:
                set_ticket_status(db,ctx,ticket,macro['set_status'])
                done.append('status')
            if macro['followup_hours']:
                repository.insert_followup(db,uid(),ticket['id'],after(hours=macro['followup_hours']),
                                           f"ติดตามผลจาก Macro “{macro['name']}”",ctx['id'],ctx['name'])
                realtime.ticket(db,ticket['id'],public=True)
                done.append('followup')
        else:
            skipped.append('ticket')
    audit.record(db,ctx['name'],'macro.run',ticket['id'] if ticket else conv['id'],macro['name'])
    db.commit()
    return {'done':done,'skipped':skipped,'ticket_id':ticket['id'] if ticket else None}


# Follow-up reminders
def add_followup(db, ctx, ticket_id, body):
    ticket = get_scoped(db,'tickets',ticket_id,ctx)
    hours,note = schema.followup_form(body)
    followup_id = uid()
    repository.insert_followup(db,followup_id,ticket['id'],after(hours=hours),note or 'ติดตามผลกับลูกค้า',ctx['id'],ctx['name'])
    audit.record(db,ctx['name'],'followup.created',ticket['id'],note)
    realtime.ticket(db,ticket['id'],public=True)
    db.commit()
    return followup_id


def finish_followup(db, ctx, followup_id):
    followup = repository.find_followup(db,followup_id)
    require(followup,'ไม่พบรายการติดตาม',404)
    get_scoped(db,'tickets',followup['ticket_id'],ctx)
    repository.finish_followup(db,followup_id)
    audit.record(db,ctx['name'],'followup.done',followup['ticket_id'])
    realtime.ticket(db,followup['ticket_id'],public=True)
    db.commit()


# CSAT
def after_status_change(db, ctx, before, status):
    """Called in the transaction that changes a case's status; closing an open case sends the survey."""
    if status in DONE and before['status'] not in DONE:
        send_survey(db,ctx,before)


def send_survey(db, ctx, ticket):
    """Post the survey question in the case's conversation (queued like any reply on LINE / Email / Facebook).
    It is a system message, so it never counts as the team's first response. When the channel cannot take a
    message right now the case still closes, without a survey. Returns the message id or None."""
    cfg = settings(db)
    if not cfg['csat_enabled'] or repository.pending_survey_for_ticket(db,ticket['id']):
        return None
    conv = _reply_conversation(db,ticket)
    if not conv:
        return None
    text = cfg['csat_message']
    try:
        _check_external(db,ctx['tenant_id'],conv,{'body':text})
    except (ChannelError,APIError):
        return None
    message_id = uid()
    conversations.insert_message(db,message_id,conv['id'],None,'ระบบ','reply',text)
    ai_repository.insert_message_meta(db,message_id,'system','[]')
    conversations.touch(db,conv['id'])
    if conv['channel']!='web':
        _enqueue_external(db,ctx,conv,message_id)
    else:
        customers.notify_reply(db,conv['id'])
    repository.insert_survey(db,uid(),ticket['id'],conv['id'],message_id)
    audit.record(db,SYSTEM_ACTOR,'csat.sent',ticket['id'])
    realtime.conversation(db,conv['id'])
    return message_id


def take_rating(db, conversation_id, text):
    """A customer message that answers a pending survey ("5", "๕", "4 ดาว", "⭐⭐⭐") records the rating.
    Returns True when it did; the message then does not reopen the case."""
    value = schema.rating_from_text(text)
    if value is None:
        return False
    survey = repository.pending_survey(db,conversation_id,after(days=-SURVEY_DAYS))
    if not survey:
        return False
    repository.answer_survey(db,survey['id'],value)
    audit.record(db,'ลูกค้า','csat.rated',survey['ticket_id'],str(value))
    realtime.conversation(db,conversation_id)
    return True


def rate_from_portal(db, conv, body):
    """The customer's stars on the customer page, with an optional comment."""
    value,comment = schema.rating(body),schema.survey_comment(body)
    D.begin(db)
    survey = repository.pending_survey(db,conv['id'],after(days=-SURVEY_DAYS))
    require(survey,'แบบประเมินนี้ปิดแล้ว หรือให้คะแนนไปแล้ว',409)
    repository.answer_survey(db,survey['id'],value,comment)
    audit.record(db,'ลูกค้า','csat.rated',survey['ticket_id'],str(value))
    realtime.conversation(db,conv['id'])
    db.commit()


def portal_survey(db, conversation_id):
    """What the support page shows: a pending survey to answer, or the rating already given."""
    survey = repository.latest_survey(db,'conversation_id',conversation_id)
    if not survey:
        return None
    return {'pending':survey['answered_at'] is None and survey['sent_at']>=after(days=-SURVEY_DAYS),'rating':survey['rating'],
            'comment':survey['comment']}


def survey_message_ids(db, conversation_id):
    return {row[0] for row in db.execute('SELECT message_id FROM csat_surveys WHERE conversation_id=?',(conversation_id,))}


# Mentions in internal notes
def record_mentions(cd, db, ctx, conv, message_id, text):
    """@Name (as shown in the team list) or @ทีม in an internal note notifies those members. Only members who may
    see the conversation are notified; the writer never notifies themselves. Returns the member ids."""
    if cd is None or '@' not in text:
        return []
    members = [m for m in organization.tenant_members(cd,ctx['tenant_id']) if m['active'] and m['id']!=ctx['id']
               and (m['role']!='agent' or m['team_id']==conv['team_id'])]
    everyone = TEAM_MENTION in text
    picked = [m for m in members if (everyone and m['team_id']==conv['team_id']) or '@'+m['name'] in text]
    for member in picked:
        repository.insert_mention(db,uid(),message_id,conv['id'],member['id'],ctx['name'])
    return [m['id'] for m in picked]


def read_mentions(db, ctx, body):
    conversation_id = body.get('conversation_id') or None
    require(conversation_id is None or (isinstance(conversation_id,str) and schema.ID.fullmatch(conversation_id)),'บทสนทนาไม่ถูกต้อง')
    repository.mark_mentions_read(db,ctx['id'],conversation_id)
    db.commit()


# What each person should see
def my_alerts(db, ctx):
    team = visible_team(ctx)
    return {'mentions':repository.unread_mentions(db,ctx['id'],team),
            'followups':repository.open_followups_for(db,ctx['id'],team),
            'escalations':repository.escalations_to(db,ctx['id']),
            'praise':repository.praise_for(db,ctx['id'],after(days=-7)),
            'forecasts':repository.forecasts_to(db,ctx['id'],now()),
            # A channel that stopped working (channels/health.py): for the organization's admins, who can fix it.
            'channels':_channel_alerts(db) if ctx.get('role')=='admin' else []}


def _channel_alerts(db):
    from backend.modules.channels import health
    return health.alerts(db)


def ticket_extras(db, ticket_id):
    return {'followups':repository.followups_for_ticket(db,ticket_id),'escalation':repository.escalation_for(db,ticket_id),
            'survey':repository.latest_survey(db,'ticket_id',ticket_id)}


def _local_day_start(tz):
    """Midnight of the viewer's day, as a UTC timestamp. tz is the browser's getTimezoneOffset()."""
    local = utc_now()-dt.timedelta(minutes=tz)
    return iso(local.replace(hour=0,minute=0,second=0,microsecond=0)+dt.timedelta(minutes=tz))


def csat_summary(db, since):
    counts = repository.rating_counts(db,since)
    total = sum(counts.values())
    return {'count':total,'sent':repository.surveys_sent_since(db,since),
            'average':round(sum(k*v for k,v in counts.items())/total,2) if total else None,
            'satisfied':round(100*(counts.get(4,0)+counts.get(5,0))/total,1) if total else None,
            'distribution':{str(k):counts.get(k,0) for k in range(1,6)},'recent':repository.recent_ratings(db)}


def manager_overview(cd, db, ctx, tz):
    since,day = after(days=-30),_local_day_start(tz)
    seen,open_by = repository.last_seen(db),repository.backlog_by_assignee(db,now())
    resolved,replies = repository.resolved_since_by_assignee(db,day),repository.replies_since_by_author(db,day)
    speed,ratings = repository.first_response_minutes_by_assignee(db,since),repository.csat_by_assignee(db,since)
    agents = [{'id':m['id'],'name':m['name'],'role':m['role'],'team_id':m['team_id'],'last_seen':seen.get(m['id']),
               'open':open_by.get(m['id'],0),'resolved_today':resolved.get(m['id'],0),'replies_today':replies.get(m['id'],0),
               'avg_first_response':speed.get(m['id']),'csat':ratings[m['id']]['average'] if m['id'] in ratings else None}
              for m in organization.tenant_members(cd,ctx['tenant_id']) if m['active']]
    cfg = settings(db)
    # The busy hours and the full satisfaction figures live in the service report (reports/service.py).
    return {'agents':agents,'csat':csat_summary(db,since),
            'automation':{'rules':repository.enabled_rule_count(db),'macros':len(repository.macros(db)),
                          'escalations_today':repository.escalation_count_since(db,day),'followups_due':repository.due_followup_count(db,now()),
                          'escalation_enabled':cfg['escalation_enabled'],'escalation_minutes':cfg['escalation_minutes'],'csat_enabled':cfg['csat_enabled']},
            'escalations':repository.recent_escalations(db,5),'generated_at':now()}


def my_today(db, ctx, tz):
    """วันนี้ของฉัน: the member's own row of the manager view - replies and cases closed today, cases in hand, and
    their first-response time and satisfaction over 30 days."""
    since,day,me = after(days=-30),_local_day_start(tz),ctx['id']
    rating = repository.csat_by_assignee(db,since).get(me)
    return {'replies':repository.replies_since_by_author(db,day).get(me,0),'resolved':repository.resolved_since_by_assignee(db,day).get(me,0),
            'open':repository.open_count_by_assignee(db).get(me,0),'avg_first_response':repository.first_response_minutes_by_assignee(db,since).get(me),
            'csat':round(rating['average'],2) if rating else None,'csat_count':rating['count'] if rating else 0}


def overview(cd, db, ctx, tz):
    """The dashboard's own data: everyone's reminders, mentions, own day and the cases likely to break their SLA; for
    the organization's owners also the manager view, what is left to set up, the chatbot and the knowledge gaps, and
    today's AI summary."""
    from backend.modules.ai import insights
    from backend.modules.automation import forecast, setup
    owner = ctx['role']=='admin' and not ctx.get('read_only')
    return {'me':my_alerts(db,ctx),'today':my_today(db,ctx,tz),'forecast':forecast.sla_forecast(db,visible_team(ctx)),
            'manager':manager_overview(cd,db,ctx,tz) if ctx['role']!='agent' else None,
            'setup':setup.checklist(cd,db,ctx) if owner else None,
            'insights':{**insights.overview(db,ctx['tenant_id']),'brief':insights.latest_brief(db,ctx,_local_day_start(tz))} if owner else None}


# Who is active
_seen = {}
_seen_lock = threading.Lock()


def touch_activity(db, ctx):
    """Remember that the member used the app (at most one write a minute per member). Committed on its own, before
    the request's work, so it never holds a transaction open underneath it."""
    key,moment = (ctx['tenant_id'],ctx['id']),time.monotonic()
    with _seen_lock:
        if _seen.get(key,-1e9)>moment-60:
            return
        _seen[key] = moment
    try:
        repository.touch(db,ctx['id'],now())
        db.commit()
    except sqlite3.OperationalError:
        db.rollback()


class Worker:
    """Background thread: every 30 seconds, in each active organization, escalate due cases, email support-page
    customers about replies they have not read yet, and send the customer notices (reminders once a day)."""
    INTERVAL = 30

    def __init__(self):
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.run,name='bookdose-automation',daemon=True)

    def start(self):
        self.thread.start()

    def run(self):
        while not self.stop.wait(self.INTERVAL):
            try:
                with D.control() as cd:
                    ids = tenants.active_tenant_ids(cd)
                monitor.heartbeat('automation')
                try:
                    # Support accesses whose time is over are closed; requests nobody decided lapse.
                    from backend.modules.support_access import service as support
                    support.sweep()
                except Exception as error:
                    print(f'Support access: {type(error).__name__}; retrying next round',flush=True)
                    monitor.error('automation','support: '+type(error).__name__)
                for tenant_id in ids:
                    if self.stop.is_set():
                        return
                    try:
                        with D.control() as cd, D.tenant(tenant_id) as db:
                            escalate_due(cd,db,tenant_id)
                            # A case the queue will not reach in time: its owner hears before the deadline passes.
                            from backend.modules.automation import forecast
                            forecast.alert_new(cd,db,tenant_id)
                            # พักเคส: the ones whose moment has come go back to the queue and their owners hear.
                            from backend.modules.tickets import service as ticket_service
                            ticket_service.wake_due(db)
                            # ปิดเคสเมื่อลูกค้าเงียบ: ask the customers gone quiet, close the cases still quiet.
                            from backend.modules.automation import quiet
                            quiet.run(db,tenant_id)
                            # ระยะเวลาเก็บข้อมูล: the content of conversations kept past the chosen time (hourly).
                            from backend.modules.organization import retention
                            if retention.due(tenant_id):
                                retention.run(db,tenant_id)
                    except Exception as error:
                        print(f'Automation worker: {type(error).__name__}; retrying next round',flush=True)
                        monitor.error('automation',type(error).__name__)
                    try:
                        # Emails members asked for about their own work (ตั้งค่าบัญชี → การแจ้งเตือน).
                        from backend.modules.staff_prefs import service as staff_prefs
                        staff_prefs.send_notices(tenant_id)
                    except Exception as error:
                        print(f'Staff notices: {type(error).__name__}; retrying next round',flush=True)
                        monitor.error('automation','staff notices: '+type(error).__name__)
                    try:
                        customers.send_notices(tenant_id)
                    except Exception as error:
                        print(f'Customer notices: {type(error).__name__}; retrying next round',flush=True)
                        monitor.error('automation','notices: '+type(error).__name__)
                    try:
                        # The customer notices waiting to go out on LINE.
                        customer_notify.send(tenant_id)
                    except Exception as error:
                        print(f'Customer alerts: {type(error).__name__}; retrying next round',flush=True)
                        monitor.error('automation','alerts: '+type(error).__name__)
                    try:
                        # Guest web chat: reply notices on the guests' proven channels, then old browsers and links.
                        from backend.modules.guest import service as guest
                        guest.send_notices(tenant_id)
                        guest.cleanup(tenant_id)
                    except Exception as error:
                        print(f'Guest notices: {type(error).__name__}; retrying next round',flush=True)
                        monitor.error('automation','guest: '+type(error).__name__)
            except Exception as error:
                print(f'Automation worker: {type(error).__name__}; retrying next round',flush=True)
