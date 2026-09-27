"""What the staff's AI assistant sees of the workspace (ai/assistant.py), so it can find a case, propose what to do with
it and say why something does not work: the open cases the member may see, the people, teams, tags and macros it may
name in an action, the case open on the member's screen, the cases of a customer the question names, customer records
that look like one person (for an owner), and how the organization's channels, case handing out and AI are doing.

It is what the member could see on their own screens: an agent sees their team's cases and people only, and who could
be handed a case and why not goes to the organization's owners. No customer's name, email or phone reaches the
provider: cases go by number and subject (masked), a customer is "the customer of BD-12" or a ref (c1). Members, teams,
tags, macros, customers and case fields go by short refs (u1, t1, g1, m1, c1, f1); the real ids stay in the job's `_refs`, which is
never sent (service.process_one) and is what the answer's actions are checked against (ai/assistant_actions.py). So
does what the confirm list shows of a macro or a customer record (its name, email and phone for the owner)."""
import datetime as dt
import re

from backend.database.db import one, rows
from backend.exceptions.errors import AI_ERRORS, CHANNEL_ERRORS, APIError
from backend.middleware.access import get_scoped, visible_team
from backend.modules.ai import insights, repository
from backend.modules.staff_prefs.model import WORK_TZ
from backend.modules.tickets import fields, sla, tags
from backend.modules.tickets.model import PRIORITIES
from backend.utils.dates import after, now, today

CASES = 60                   # open cases listed, most overdue first
MESSAGES = 14                # of the conversation on screen
CUSTOMER_CASES = 10
FAILED_DAYS = 7
MACROS = 40
DUPLICATE_GROUPS = 10        # listed when the question is about duplicates; otherwise only counted
GROUP_MOST = 6               # more records than this share a name or number: a shared line, not one person
ABOUT_DUPLICATES = re.compile(r'ซ้ำ|รวม|duplicate|merge',re.I)
ID = re.compile(r'[a-f0-9]{32}')
NUMBER = re.compile(r'\bBD-(\d{1,9})\b',re.I)
DONE = ('resolved','closed')
REPLY_CHANNELS = ('web','line','email','facebook','instagram')
FROM = {'customer':'customer','reply':'team','note':'internal_note'}

CASE_SQL = f'''SELECT t.id,t.number,t.subject,t.status,t.priority,t.category,t.team_id,t.assignee_id,t.contact_id,t.created_at,
    t.updated_at,t.first_response_at,t.first_response_due_at,t.resolution_due_at,t.snoozed_until,{tags.IDS_COLUMN},{fields.VALUES_COLUMN},
    (SELECT MAX(m.level) FROM ticket_conversations tc JOIN conversation_moods m ON m.conversation_id=tc.conversation_id
     WHERE tc.ticket_id=t.id) AS mood,
    (SELECT m.kind FROM ticket_conversations tc JOIN messages m ON m.conversation_id=tc.conversation_id
     WHERE tc.ticket_id=t.id AND m.kind!='note' ORDER BY m.created_at DESC,m.rowid DESC LIMIT 1) AS last_kind,
    (SELECT cv.channel FROM ticket_conversations tc JOIN conversations cv ON cv.id=tc.conversation_id
     WHERE tc.ticket_id=t.id ORDER BY cv.created_at,cv.rowid LIMIT 1) AS channel
    FROM tickets t'''


def _hours(since, until):
    return round((dt.datetime.fromisoformat(until)-dt.datetime.fromisoformat(since)).total_seconds()/3600,1)


def _local(stamp):
    return dt.datetime.fromisoformat(stamp).astimezone(WORK_TZ).strftime('%Y-%m-%d %H:%M')


class Refs:
    """Short names for what an action may point at, and the ids behind them."""
    def __init__(self):
        self.ids = {'u':{},'t':{},'g':{},'m':{},'c':{},'f':{}}
        self.back = {}
        self.cases = {}
        self.failed = {}
        self.current = None
        # What the confirm list shows of a macro and of a customer record, by id (never sent); the case fields as the
        # organization set them, which a proposed value is checked against.
        self.macros = {}
        self.customers = {}
        self.fields = {}

    def add(self, kind, entity_id):
        ref = f'{kind}{len(self.ids[kind])+1}'
        self.ids[kind][ref] = entity_id
        self.back[(kind,entity_id)] = ref
        return ref

    def of(self, kind, entity_id):
        return self.back.get((kind,entity_id),'')

    def ref(self, kind, entity_id):
        return self.of(kind,entity_id) or self.add(kind,entity_id)

    def dump(self):
        return {'members':self.ids['u'],'teams':self.ids['t'],'tags':self.ids['g'],'macros':self.ids['m'],'customers':self.ids['c'],
                'fields':self.ids['f'],'cases':self.cases,'failed':self.failed,'current':self.current,'macro_cards':self.macros,
                'customer_cards':self.customers,'field_cards':self.fields}


def _case(row, refs, moment):
    """One case as the assistant reads it."""
    item = {'case':f"BD-{row['number']}",'subject':insights._mask(insights._plain(row['subject'],100)),'status':row['status'],
            'priority':row['priority'],'category':row['category'] or '','channel':row['channel'] or '',
            'team':refs.of('t',row['team_id']),
            'assignee':refs.of('u',row['assignee_id']) or ('other' if row['assignee_id'] else ''),
            'tags':[ref for ref in (refs.of('g',t) for t in tags.split_ids(row['tag_ids'])) if ref],
            'hours_open':_hours(row['created_at'],moment),'hours_since_activity':_hours(row['updated_at'],moment)}
    # The organization's case fields by ref, what the team filled in (masked), and the required ones still empty.
    values = fields.parse_values(row['field_values'],list(refs.fields.values()))
    if values:
        item['fields'] = {refs.of('f',k):insights._mask(v) for k,v in values.items()}
    empty = [refs.of('f',f['id']) for f in refs.fields.values() if f['required'] and not values.get(f['id'])]
    if empty and row['status'] not in DONE:
        item['missing_to_close'] = empty
    if row['status'] not in DONE:
        replied = bool(row['first_response_at'])
        due = row['resolution_due_at'] if replied else row['first_response_due_at']
        item.update(deadline='ปิดเคส' if replied else 'ตอบครั้งแรก',hours_past_deadline=max(0,_hours(due,moment)) if due else 0,
                    waiting_for='customer' if row['status']=='pending_customer' or row['last_kind']=='reply' else 'team')
        if row['snoozed_until'] and row['snoozed_until']>moment:
            item['paused_until'] = _local(row['snoozed_until'])
    if row['mood']:
        item['customer_upset'] = row['mood']
    refs.cases[item['case']] = row['id']
    return item


def _team_filter(ctx, where, params=()):
    team = visible_team(ctx)
    return (f'{where} AND t.team_id=?',(*params,team)) if team else (where,tuple(params))


def _cases(db, ctx, refs, moment, question):
    """The open cases, most overdue and most upset first, plus any case the question names by number."""
    where,params = _team_filter(ctx,f"t.status NOT IN {DONE}")
    found = [_case(r,refs,moment) for r in rows(db,f'{CASE_SQL} WHERE {where}',params)]
    found.sort(key=lambda c:(-c['hours_past_deadline'],-c.get('customer_upset',0),-c['hours_open']))
    listed = found[:CASES]
    for key in [c['case'] for c in found[CASES:]]:
        refs.cases.pop(key,None)
    named = sorted({int(n) for n in NUMBER.findall(question)}-{int(c['case'][3:]) for c in listed})[:10]
    if named:
        where,params = _team_filter(ctx,f"t.number IN ({','.join('?'*len(named))})",named)
        listed += [_case(r,refs,moment) for r in rows(db,f'{CASE_SQL} WHERE {where}',params)]
    return listed,max(0,len(found)-CASES)


def _people(cd, db, ctx, refs):
    """teams, members (with the cases they hold) and tags, each with its ref. An owner also sees who the handing out
    could give a case to now and why not (a leave's note stays out)."""
    from backend.modules.automation import distribution
    from backend.modules.organization import repository as organization
    team = visible_team(ctx)
    teams = [{'ref':refs.add('t',t['id']),'name':t['name']} for t in organization.teams(db) if not team or t['id']==team]
    members = [m for m in organization.tenant_members(cd,ctx['tenant_id']) if m['active'] and (not team or m['team_id']==team)]
    held = dict(db.execute(f"SELECT assignee_id,COUNT(*) FROM tickets WHERE assignee_id IS NOT NULL AND status NOT IN {DONE} GROUP BY assignee_id").fetchall())
    ready = {p['id']:p for p in distribution.people(cd,db,ctx['tenant_id'])} if ctx['role']=='admin' else {}
    listed = []
    for m in members:
        item = {'ref':refs.add('u',m['id']),'name':m['name'],'team':refs.of('t',m['team_id']),
                'role':'owner' if m['role']=='admin' else 'agent','open_cases':held.get(m['id'],0)}
        if m['id'] in ready:
            why = ready[m['id']]['reason']
            item.update(auto_assign_ready=ready[m['id']]['ready'],auto_assign_why_not='ลาพัก' if why.startswith('ลาพัก') else why)
        listed.append(item)
    return teams,listed,[{'ref':refs.add('g',t['id']),'name':t['name']} for t in tags.catalog(db)]


def _macros(db, refs):
    """The organization's macros (ระบบอัตโนมัติ → Macro): the team's standard way of doing a thing in one press - a
    reply from its template, a status, a follow-up reminder. What the reply says goes too (masked), so the right one is
    picked."""
    from backend.modules.automation import repository as automation
    found = []
    for m in automation.macros(db)[:MACROS]:
        refs.macros[m['id']] = {'name':m['name'],'reply':bool(m['reply']),'set_status':m['set_status'],'followup_hours':m['followup_hours']}
        found.append({'ref':refs.add('m',m['id']),'name':insights._mask(m['name']),
                      'reply':insights._mask(insights._plain(m['reply'],300)) if m['reply'] else '',
                      'sets_status':m['set_status'],'follow_up_hours':m['followup_hours']})
    return found


def _fields(db, refs):
    """The organization's case fields (ตั้งค่าองค์กร → ช่องข้อมูลของเคส): what the team records about each case, the
    kind of value, a choice's options, and whether it must be filled before the case is closed."""
    found = []
    for f in fields.catalog(db):
        refs.fields[f['id']] = f
        found.append({'ref':refs.add('f',f['id']),'name':f['name'],'kind':f['kind'],**({'options':f['options']} if f['kind']=='select' else {}),
                      'required_to_close':f['required']})
    return found


def phone_key(phone):
    """A phone number as digits, +66 written as 0; '' when too short to tell anyone apart."""
    digits = re.sub(r'\D','',phone or '')
    if digits.startswith('66') and len(digits)==11:
        digits = '0'+digits[2:]
    return digits if len(digits)>=9 else ''


def match_keys(row):
    """(how, key) pairs two records of one person may share: the same email, phone number or name."""
    name = ' '.join((row['name'] or '').casefold().split())
    return [(how,key) for how,key in (('email',(row['email'] or '').strip().lower()),('phone',phone_key(row['phone'])),
                                      ('name',name if len(name)>=4 else '')) if key]


def _cards(db, refs, ids):
    """Each record's history in numbers, and what the confirm list shows of it (kept in the refs, never sent)."""
    marks = ','.join('?'*len(ids))
    cases = dict(db.execute(f'SELECT contact_id,COUNT(*) FROM tickets WHERE contact_id IN ({marks}) GROUP BY contact_id',ids).fetchall())
    still = dict(db.execute(f"SELECT contact_id,COUNT(*) FROM tickets WHERE contact_id IN ({marks}) AND status NOT IN {DONE} GROUP BY contact_id",ids).fetchall())
    talks = {r['contact_id']:r for r in rows(db,f'''SELECT contact_id,COUNT(*) AS n,GROUP_CONCAT(DISTINCT channel) AS channels FROM conversations
                                                   WHERE contact_id IN ({marks}) GROUP BY contact_id''',ids)}
    found = {}
    for r in rows(db,f'SELECT id,name,email,phone,created_at FROM contacts WHERE id IN ({marks})',ids):
        talk = talks.get(r['id'])
        found[r['id']] = {'cases':cases.get(r['id'],0),'open_cases':still.get(r['id'],0),'conversations':talk['n'] if talk else 0,
                          'channels':sorted((talk['channels'] or '').split(',')) if talk else [],'added':r['created_at'][:10]}
        refs.customers[r['id']] = {'name':r['name'],'email':r['email'],'phone':r['phone'],'cases':found[r['id']]['cases'],
                                   'conversations':found[r['id']]['conversations']}
    return found


def _duplicates(db, ctx, refs, asked):
    """Customer records that look like one person - the same email, phone number or name - for an owner (only they
    merge records). Listed, the one with the most history first, when the question is about duplicates or merging;
    otherwise only counted, so the assistant can say there are some. Their details stay here: the provider gets how
    they match and their history in numbers."""
    if ctx['role']!='admin':
        return None
    sharing = {}
    for r in rows(db,'SELECT id,name,email,phone FROM contacts'):
        for key in match_keys(r):
            sharing.setdefault(key,[]).append(r['id'])
    shared = [(key[0],ids) for key,ids in sharing.items() if 1<len(ids)<=GROUP_MOST]
    parent = {}

    def root(cid):
        while parent.get(cid,cid)!=cid:
            cid = parent[cid]
        return cid
    for _,ids in shared:
        for other in ids[1:]:
            a,b = root(ids[0]),root(other)
            if a!=b:
                parent[b] = a
    groups,how = {},{}
    for kind,ids in shared:
        top = root(ids[0])
        groups.setdefault(top,set()).update(ids)
        how.setdefault(top,set()).add(kind)
    # Matched by an email or a phone number before a name alone (two people may share a name).
    ranked = sorted(((sorted(how[top],key=('email','phone','name').index),g) for top,g in groups.items() if len(g)<=GROUP_MOST),
                    key=lambda item:(item[0]==['name'],-len(item[1])))
    found = {'groups':len(ranked),'listed':[]}
    if not ABOUT_DUPLICATES.search(asked):
        return found
    for matched,group in ranked[:DUPLICATE_GROUPS]:
        cards = _cards(db,refs,list(group))
        order = sorted(group,key=lambda c:(-(cards[c]['cases']+cards[c]['conversations']),cards[c]['added'],c))
        found['listed'].append({'matched_by':matched,'customers':[{'ref':refs.ref('c',c),**cards[c]} for c in order]})
    return found


def _messages(db, conversation_id):
    found = repository.recent_messages(db,conversation_id,False)
    at = dict(db.execute(f"SELECT id,created_at FROM messages WHERE id IN ({','.join('?'*len(found))})",[m['id'] for m in found]).fetchall()) if found else {}
    return [{'from':FROM.get(m['kind'],m['kind']),'text':insights._mask(m['body'][:1500]),'at':_local(at[m['id']]),
             **({'attachments':m['attachment_count']} if m['attachment_count'] else {})} for m in found]


def _current(db, ctx, page, refs, moment, cases):
    """The case or conversation open on the member's screen: its latest messages and the customer's other cases."""
    from backend.modules.tickets import repository as tickets
    page = page if isinstance(page,dict) else {}
    ticket_id,conversation_id = page.get('ticket_id'),page.get('conversation_id')
    try:
        if isinstance(ticket_id,str) and ID.fullmatch(ticket_id):
            ticket = get_scoped(db,'tickets',ticket_id,ctx)
            conv = one(db,'''SELECT c.* FROM conversations c JOIN ticket_conversations tc ON tc.conversation_id=c.id WHERE tc.ticket_id=?
                             ORDER BY c.updated_at DESC,c.rowid DESC LIMIT 1''',(ticket['id'],))
        elif isinstance(conversation_id,str) and ID.fullmatch(conversation_id):
            conv = get_scoped(db,'conversations',conversation_id,ctx)
            ticket = tickets.for_conversation(db,conv['id'])
        else:
            return None
    except APIError:
        return None
    found = {'case':'','channel':conv['channel'] if conv else ''}
    if ticket:
        number = f"BD-{ticket['number']}"
        if number not in refs.cases:
            cases.append(_case(one(db,f'{CASE_SQL} WHERE t.id=?',(ticket['id'],)),refs,moment))
        found['case'] = number
    else:
        found['subject'] = insights._mask(insights._plain(conv['subject'],100))
    refs.current = {'ticket_id':ticket['id'] if ticket else None,'conversation_id':conv['id'] if conv else None}
    if conv:
        found['can_reply'] = conv['channel'] in REPLY_CHANNELS
        found['messages'] = _messages(db,conv['id'])
    contact = (ticket or conv)['contact_id']
    where,params = _team_filter(ctx,'t.contact_id=? AND t.id!=?',(contact,ticket['id'] if ticket else ''))
    found['customer_other_cases'] = [_case(r,refs,moment) for r in rows(db,f'{CASE_SQL} WHERE {where} ORDER BY t.created_at DESC LIMIT ?',(*params,CUSTOMER_CASES))]
    return found


def _named_customers(db, ctx, question, refs, moment):
    """Cases of a customer the question names by name, email or phone (the customer's details are not sent)."""
    text = question.lower()
    digits = re.sub(r'\D','',question)
    found = rows(db,'''SELECT id FROM contacts WHERE (length(name)>=3 AND instr(?,lower(name))>0) OR (email!='' AND instr(?,lower(email))>0)
                       OR (length(phone)>=8 AND ?!='' AND instr(?,replace(replace(phone,'-',''),' ',''))>0) LIMIT 3''',(text,text,digits,digits))
    named = []
    for contact in found:
        where,params = _team_filter(ctx,'t.contact_id=?',(contact['id'],))
        cases = [_case(r,refs,moment) for r in rows(db,f'{CASE_SQL} WHERE {where} ORDER BY t.created_at DESC LIMIT ?',(*params,CUSTOMER_CASES))]
        if cases:
            _cards(db,refs,[contact['id']])
            named.append({'customer':refs.ref('c',contact['id']),'cases':cases})
    return named


def _channel(db, kinds, name, row, moment):
    marks = ','.join('?'*len(kinds))
    counts = dict(db.execute(f'SELECT status,COUNT(*) FROM channel_outbox WHERE kind IN ({marks}) GROUP BY status',kinds).fetchall())
    return {'channel':name,'on':bool(row['enabled']),'problem':CHANNEL_ERRORS.get(row['last_error'],'') if row['last_error'] else '',
            'hours_since_last_message_in':_hours(row['last_received'],moment) if row['last_received'] else None,
            'chatbot_on':bool(row['config'].get('chatbot_enabled')),'failed_to_send':counts.get('failed',0),
            'waiting_to_send':sum(counts.get(s,0) for s in ('queued','sending'))}


def _health(db, ctx, refs, moment):
    """How the organization's channels, case handing out and AI are doing, and the messages that failed to send."""
    from backend.modules.automation import distribution
    from backend.modules.ai import service
    from backend.modules.channels import repository as channels
    found = [{'channel':'แชทบนเว็บ','on':True}]
    for kind,name in (('line','LINE'),('email','อีเมล')):
        row = channels.find_setting(db,kind)
        if row:
            found.append(_channel(db,(kind,),name,row,moment))
    row = channels.find_facebook_setting(db)
    if row:
        found.append(_channel(db,('facebook','instagram'),'Facebook / Instagram',row,moment))
    cfg = service.config(db)
    failed_ai = db.execute("SELECT error,COUNT(*) FROM ai_jobs WHERE created_at>=? AND status='failed' GROUP BY error",(today(),)).fetchall()
    assign = distribution.config(db)
    where,params = _team_filter(ctx,f"o.status='failed' AND o.updated_at>=?",(after(days=-FAILED_DAYS),))
    for r in rows(db,f'''SELECT o.message_id,o.kind,o.error,t.number FROM channel_outbox o JOIN messages m ON m.id=o.message_id
                       JOIN ticket_conversations tc ON tc.conversation_id=m.conversation_id JOIN tickets t ON t.id=tc.ticket_id
                       WHERE {where} ORDER BY o.updated_at DESC LIMIT 30''',params):
        entry = refs.failed.setdefault(f"BD-{r['number']}",{'messages':[],'channel':r['kind'],'error':CHANNEL_ERRORS.get(r['error'],'')})
        entry['messages'].append(r['message_id'])
    unassigned_where,unassigned_params = _team_filter(ctx,f"t.assignee_id IS NULL AND t.status NOT IN {DONE}")
    return {'channels':found,
            'auto_assign':{'on':assign['enabled'],'cap_per_person':assign['cap'],
                           'teams':'all' if assign['all_teams'] else [refs.of('t',t) for t in assign['teams'] if refs.of('t',t)],
                           'owners_included':assign['owners'],'cases_waiting_for_it':len(distribution.waiting(db,assign))},
            'unassigned_open_cases':db.execute(f'SELECT COUNT(*) FROM tickets t WHERE {unassigned_where}',unassigned_params).fetchone()[0],
            'ai':{'staff_ai_on':cfg['drafts_enabled'],'web_chatbot_on':cfg['chatbot_enabled'],'translate_on':cfg['translate_enabled'],
                  'requests_today':repository.jobs_since(db,today()),'daily_limit':cfg['daily_limit'],
                  'failed_today':{AI_ERRORS.get(error,error or 'อื่น ๆ'):count for error,count in failed_ai}},
            'sla_hours':{p:dict(zip(('first_reply','resolve'),sla.targets(db,p))) for p in PRIORITIES},
            'failed_messages':[{'case':case,'messages':len(v['messages']),'channel':v['channel'],'error':v['error']} for case,v in refs.failed.items()]}


def build(cd, db, ctx, question, page):
    """(what goes to the provider with the question, the refs kept on the job)."""
    moment = now()
    refs = Refs()
    teams,members,tag_list = _people(cd,db,ctx,refs)
    case_fields = _fields(db,refs)
    cases,not_listed = _cases(db,ctx,refs,moment,question)
    current = _current(db,ctx,page,refs,moment,cases)
    local = dt.datetime.fromisoformat(moment).astimezone(WORK_TZ)
    days = ('จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์')
    context = {'now':f"{local:%Y-%m-%dT%H:%M}+07:00 (วัน{days[local.weekday()]})",
               'me':{'ref':refs.of('u',ctx['id']),'role':'owner' if ctx['role']=='admin' else 'agent','team':refs.of('t',ctx['team_id'])},
               'teams':teams,'members':members,'tags':tag_list,'macros':_macros(db,refs),'case_fields':case_fields,
               'cases':cases,'cases_not_listed':not_listed,
               'current':current,'customers_named':_named_customers(db,ctx,question,refs,moment),'health':_health(db,ctx,refs,moment)}
    duplicates = _duplicates(db,ctx,refs,question)
    if duplicates is not None:
        context['duplicate_customers'] = duplicates
    return context,refs.dump()
