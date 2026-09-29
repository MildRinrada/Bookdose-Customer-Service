"""เสนอป้ายและความเร่งด่วน: when a case opens from a customer's messages, the AI reads its first messages and proposes the
tags, the priority and the team it looks like it needs. Nothing changes by itself: the case screen shows the proposal and
a member uses it (all of it, or what they tick) or sets it aside.

- Only for an organization that has connected an AI and whose owner switched this on (ตั้งค่า → AI).
- What is sent: the case's subject, the customer's first messages (their text only), and the organization's team and tag
  names with short refs (t1, g1) - never who the customer is. The ids behind the refs stay in the job (payload _refs).
- The answer is checked against what was sent: a team or tag it was not shown, or a priority that does not exist, is
  dropped. What would change nothing (the case is already so) is not proposed. A proposal with nothing left is not kept.
- Used through the same services as a member's own clicks, with the member's rights; the activity log says the change
  was the AI's proposal, used by that member.
- Routing rules and แจกเคสอัตโนมัติ run first, when the case opens; the proposal is read against the case as it is then."""
import json

from backend.database import audit
from backend.database.db import one, rows
from backend.exceptions.errors import AIError
from backend.utils.dates import now
from backend.utils.validation import require

MAX_MESSAGES = 3
MAX_MESSAGE_CHARS = 1000
MAX_TAGS = 3
REASON_MAX = 140


def request(db, tenant_id, ticket_id, conversation_id):
    """A case just opened (tickets.service.open_ticket, inside its transaction): queue the reading when it is on and the
    case came from a customer's messages. Quietly nothing otherwise."""
    from backend.modules.ai import service as ai
    from backend.modules.organization import repository as organization
    from backend.modules.tickets import tags
    if not conversation_id or not ai.config(db)['triage_enabled'] or not ai.has_key(tenant_id):
        return None
    found = rows(db,"SELECT body FROM messages WHERE conversation_id=? AND kind='customer' AND body<>'' ORDER BY rowid LIMIT ?",
                 (conversation_id,MAX_MESSAGES))
    if not found:
        return None
    ticket = one(db,'SELECT subject,priority,team_id FROM tickets WHERE id=?',(ticket_id,))
    teams = organization.teams(db)
    catalog = tags.catalog(db)
    team_refs = {f't{n}':t['id'] for n,t in enumerate(teams,1)}
    tag_refs = {f'g{n}':t['id'] for n,t in enumerate(catalog,1)}
    ref_of_team = {v:k for k,v in team_refs.items()}
    have = tags.of_ticket(db,ticket_id)
    payload = {'subject':ticket['subject'],
               'messages':[m['body'][:MAX_MESSAGE_CHARS] for m in found],
               'teams':[{'ref':ref_of_team[t['id']],'name':t['name']} for t in teams],
               'tags':[{'ref':k,'name':t['name']} for k,t in zip(tag_refs,catalog)],
               'priorities':['low','normal','high','urgent'],
               'current':{'priority':ticket['priority'],'team':ref_of_team.get(ticket['team_id'],''),
                          'tags':[k for k,v in tag_refs.items() if v in have]},
               '_refs':{'teams':team_refs,'tags':tag_refs},'_ticket':ticket_id}
    try:
        return ai.enqueue(db,tenant_id,'triage',conversation_id,None,payload=payload)
    except AIError:
        return None


def validate(result, payload):
    """The proposal as ids: {'priority','team_id','tags','reason'}, with what the AI was not shown left out."""
    from backend.modules.tickets.model import PRIORITIES
    if not isinstance(result,dict):
        raise AIError('invalid_output')
    refs = (payload or {}).get('_refs') or {}
    priority = result.get('priority') if result.get('priority') in PRIORITIES else ''
    team_id = refs.get('teams',{}).get(result.get('team'),'') if isinstance(result.get('team'),str) else ''
    picked = result.get('tags') if isinstance(result.get('tags'),list) else []
    tag_ids = list(dict.fromkeys(refs.get('tags',{})[t] for t in picked if isinstance(t,str) and t in refs.get('tags',{})))[:MAX_TAGS]
    reason = result.get('reason') if isinstance(result.get('reason'),str) else ''
    return {'priority':priority,'team_id':team_id,'tags':tag_ids,'reason':' '.join(reason.split())[:REASON_MAX]}


def apply(db, job, result):
    """Keep what would change the case as it is now; nothing is kept when nothing would."""
    from backend.modules.tickets import tags
    payload = json.loads(job['payload'] or '{}')
    ticket = one(db,'SELECT id,priority,team_id FROM tickets WHERE id=?',(payload.get('_ticket'),))
    if not ticket:
        return None
    have = tags.of_ticket(db,ticket['id'])
    priority = result['priority'] if result['priority']!=ticket['priority'] else ''
    team_id = result['team_id'] if result['team_id']!=ticket['team_id'] else ''
    new_tags = [t for t in result['tags'] if t not in have]
    if not (priority or team_id or new_tags):
        return None
    db.execute('''INSERT INTO ticket_triage(ticket_id,priority,team_id,tags,reason,status,updated_at) VALUES(?,?,?,?,?,'proposed',?)
                  ON CONFLICT(ticket_id) DO UPDATE SET priority=excluded.priority,team_id=excluded.team_id,tags=excluded.tags,
                  reason=excluded.reason,status='proposed',decided_by='',updated_at=excluded.updated_at''',
               (ticket['id'],priority,team_id,json.dumps(new_tags),result['reason'],now()))
    return ticket['id']


def of_ticket(db, ticket_id):
    """The proposal the case screen shows (None when there is none waiting). A part the case already has, or a team or
    tag deleted since, is left out."""
    from backend.modules.organization import repository as organization
    from backend.modules.tickets import tags
    row = one(db,"SELECT * FROM ticket_triage WHERE ticket_id=? AND status='proposed'",(ticket_id,))
    ticket = one(db,'SELECT priority,team_id FROM tickets WHERE id=?',(ticket_id,))
    if not row or not ticket:
        return None
    have = tags.of_ticket(db,ticket_id)
    known = tags.known_ids(db)
    team = organization.find_team(db,row['team_id']) if row['team_id'] and row['team_id']!=ticket['team_id'] else None
    proposal = {'priority':row['priority'] if row['priority'] and row['priority']!=ticket['priority'] else '',
                'team_id':team['id'] if team else '','team_name':team['name'] if team else '',
                'tags':[t for t in json.loads(row['tags']) if t in known and t not in have],'reason':row['reason']}
    return proposal if proposal['priority'] or proposal['team_id'] or proposal['tags'] else None


def decide(cd, db, ctx, ticket_id, body):
    """POST /api/tickets/<id>/triage {use: ['priority','team','tags'] | []}: use the parts ticked (through the case's own
    services, with the member's rights), or set the proposal aside with none."""
    from backend.middleware.access import get_scoped
    from backend.modules.tickets import service as tickets, tags
    ticket = get_scoped(db,'tickets',ticket_id,ctx)
    use = (body or {}).get('use')
    require(isinstance(use,list) and set(use)<={'priority','team','tags'},'เลือกสิ่งที่จะใช้ไม่ถูกต้อง')
    proposal = of_ticket(db,ticket['id'])
    require(proposal,'ไม่มีข้อเสนอของ AI สำหรับเคสนี้แล้ว',409)
    changes = {}
    if 'priority' in use and proposal['priority']:
        changes['priority'] = proposal['priority']
    if 'team' in use and proposal['team_id']:
        changes['team_id'] = proposal['team_id']
        # Another team: nobody in it has the case yet.
        changes['assignee_id'] = None
    if changes:
        tickets.update_ticket(cd,db,ctx,ticket['id'],changes)
    if 'tags' in use and proposal['tags']:
        have = tags.of_ticket(db,ticket['id'])
        tags.set_for_ticket(db,ctx,ticket['id'],{'tags':have+[t for t in proposal['tags'] if t not in have]})
    status = 'applied' if use else 'dismissed'
    db.execute('UPDATE ticket_triage SET status=?,decided_by=?,updated_at=? WHERE ticket_id=?',(status,ctx['name'],now(),ticket['id']))
    audit.record(db,ctx['name'],'ai.triage_'+status,ticket['id'],','.join(use))
    db.commit()
    return {'ok':True}
