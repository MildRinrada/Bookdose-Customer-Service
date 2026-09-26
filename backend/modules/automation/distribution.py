"""แจกเคสอัตโนมัติ: a new case nobody owns goes straight to someone in its team who can take it, instead of waiting for
somebody to press รับเคส.

Who can take it: an active member of the case's team (the organization's owners too, when the owner chose that),
available for new cases (ตั้งค่าบัญชี → สถานะการทำงาน: พร้อมรับเรื่อง, within their hours, not on leave), with the app
open in the last ACTIVE_MINUTES (a status left on พร้อมรับเรื่อง overnight must not collect the night's cases), and
holding fewer cases than the ceiling the owner set. Of those, the one holding the fewest cases right now; on a tie, the
one who was given a case longest ago, so a quiet morning does not hand everything to the first name in the list.

What counts as holding a case is งานค้าง of the manager view (repository.backlog_by_assignee): open and not waiting
for the customer, not paused. A case waiting for the customer is not work in hand, so it does not stop anyone from
getting the next one.

When nobody can take a case it waits in the team's queue as before, and the automation worker (every 30 seconds)
tries again as people free up, the most urgent and then the oldest first. A case left unowned that long is still
escalated to an owner (service.escalate_due), which runs after this in the same round. A rule that names an owner, or
a member who assigns by hand, always wins: only cases without an owner are handed out.

Settings are the organization's (ระบบอัตโนมัติ → แจกเคสอัตโนมัติ, owners only)."""
import json

from backend.database import audit, db as D
from backend.modules.automation import repository
from backend.modules.organization import repository as organization
from backend.modules.tickets import repository as tickets
from backend.realtime import events as realtime
from backend.utils.dates import after, now
from backend.utils.validation import require

KEY = 'auto_assign'
CAP_MIN, CAP_MAX = 1, 50
DEFAULT = {'enabled':False,'cap':5,'all_teams':True,'teams':[],'owners':False}
ACTIVE_MINUTES = 10
SYSTEM_ACTOR = 'ระบบอัตโนมัติ'
WORKING = "('new','open','pending_internal')"
URGENCY = "CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END"

TABLE = '''
CREATE TABLE IF NOT EXISTS auto_assignments (
    id INTEGER PRIMARY KEY, ticket_id TEXT NOT NULL, user_id TEXT NOT NULL, assigned_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS auto_assignments_user ON auto_assignments(user_id,assigned_at);
'''


def config(db):
    row = db.execute('SELECT value FROM settings WHERE key=?',(KEY,)).fetchone()
    try:
        value = json.loads(row[0]) if row and row[0] else None
    except ValueError:
        value = None
    found = {**DEFAULT,**value} if isinstance(value,dict) else dict(DEFAULT)
    teams = found.get('teams')
    found['teams'] = [t for t in teams if isinstance(t,str)] if isinstance(teams,list) else []
    return found


def form(body, team_ids):
    enabled,all_teams,owners = body.get('enabled'),body.get('all_teams',True),body.get('owners',False)
    require(all(type(v) is bool for v in (enabled,all_teams,owners)),'ข้อมูลการแจกเคสไม่ถูกต้อง')
    cap = body.get('cap')
    require(type(cap) is int and CAP_MIN<=cap<=CAP_MAX,f'เพดานต่อคนต้องเป็น {CAP_MIN}-{CAP_MAX} เคส')
    teams = body.get('teams',[]) or []
    require(isinstance(teams,list) and all(isinstance(t,str) and t in team_ids for t in teams),'ไม่พบทีมที่เลือก')
    teams = list(dict.fromkeys(teams))
    require(not enabled or all_teams or teams,'เลือกทีมที่จะแจกเคสอย่างน้อย 1 ทีม')
    return {'enabled':enabled,'cap':cap,'all_teams':all_teams,'teams':[] if all_teams else teams,'owners':owners}


def _covers(cfg, team_id):
    return cfg['all_teams'] or team_id in cfg['teams']


def people(cd, db, tenant_id, cfg=None):
    """Everyone the handing out could consider, with whether they can take a case now and, if not, why:
    [{'id','name','role','team_id','load','ready','reason','last'}]."""
    from backend.modules.staff_prefs import service as staff_prefs
    cfg = cfg or config(db)
    members = [m for m in organization.tenant_members(cd,tenant_id) if m['active']]
    states = staff_prefs.availability_of(cd,[m['id'] for m in members])
    seen,load = repository.last_seen(db),repository.backlog_by_assignee(db,now())
    last = dict(db.execute('SELECT user_id,MAX(assigned_at) FROM auto_assignments GROUP BY user_id').fetchall())
    recent = after(minutes=-ACTIVE_MINUTES)
    found = []
    for m in members:
        state,held = states[m['id']],load.get(m['id'],0)
        reason = ('เจ้าขององค์กร (ไม่ได้เปิดให้แจก)' if m['role']=='admin' and not cfg['owners']
                  else state['reason'] if not state['available']
                  else 'ไม่ได้เปิดโปรแกรมอยู่' if (seen.get(m['id']) or '')<recent
                  else f"ถือเคสครบ {cfg['cap']} เคสแล้ว" if held>=cfg['cap'] else '')
        found.append({'id':m['id'],'name':m['name'],'role':m['role'],'team_id':m['team_id'],'load':held,
                      'ready':not reason,'reason':reason,'last':last.get(m['id'])})
    return found


def _pick(candidates, team_id, cap):
    ready = [c for c in candidates if c['ready'] and c['team_id']==team_id and c['load']<cap]
    ready.sort(key=lambda c:(c['load'],c['last'] or '',c['name']))
    return ready[0] if ready else None


def _give(db, ticket, person):
    """Make the case the person's (only while it still has no owner); False when someone got to it first."""
    from backend.modules.staff_prefs import service as staff_prefs
    if not tickets.take(db,ticket['id'],person['id']):
        return False
    moment = now()
    db.execute('INSERT INTO auto_assignments(ticket_id,user_id,assigned_at) VALUES(?,?,?)',(ticket['id'],person['id'],moment))
    audit.record(db,SYSTEM_ACTOR,'ticket.auto_assigned',ticket['id'],
                 json.dumps({'assignee_id':{'before':None,'after':person['id']},'held':person['load']},ensure_ascii=False))
    staff_prefs.queue(db,person['id'],'assigned',f"เคส BD-{ticket['number']} มอบหมายให้คุณ",
                      f"{ticket['subject']}\nโดยการแจกเคสอัตโนมัติ",f"/tickets/{ticket['id']}")
    person['load'] += 1
    person['last'] = moment
    person['ready'] = person['load']<person['cap']
    return True


def _candidates(cd, db, tenant_id, cfg):
    found = people(cd,db,tenant_id,cfg)
    for person in found:
        person['cap'] = cfg['cap']
    return found


def assign_new(db, ticket_id):
    """Right after a case is opened (tickets.service.open_ticket, after the routing rules), inside its transaction:
    hand it out when it has no owner. Returns the member id or None."""
    cfg = config(db)
    if not cfg['enabled']:
        return None
    ticket = D.find_in_team(db,'tickets',ticket_id)
    if not ticket or ticket['assignee_id'] or ticket['status'] not in ('new','open','pending_internal') or not _covers(cfg,ticket['team_id']):
        return None
    from backend.modules.channels import repository as channel_repository
    with D.control() as cd:
        person = _pick(_candidates(cd,db,channel_repository.tenant_id_of(db),cfg),ticket['team_id'],cfg['cap'])
    return person['id'] if person and _give(db,ticket,person) else None


def waiting(db, cfg):
    """Cases the handing out still has to place: no owner, work to do now, not paused, in a team it covers; the most
    urgent first, then the ones waiting longest."""
    found = db.execute(f'''SELECT * FROM tickets WHERE assignee_id IS NULL AND status IN {WORKING} AND snoozed_until IS NULL
                           ORDER BY {URGENCY},created_at,number''').fetchall()
    return [dict(t) for t in found if _covers(cfg,t['team_id'])]


def run(cd, db, tenant_id):
    """The worker's round: place every waiting case someone can take. Returns how many were handed out."""
    cfg = config(db)
    if not cfg['enabled']:
        return 0
    D.begin(db)
    cases = waiting(db,cfg)
    given = 0
    if cases:
        candidates = _candidates(cd,db,tenant_id,cfg)
        for ticket in cases:
            person = _pick(candidates,ticket['team_id'],cfg['cap'])
            if person and _give(db,ticket,person):
                realtime.ticket(db,ticket['id'],teams=(ticket['team_id'],),conversations_listed=True)
                given += 1
    db.commit()
    return given


def given_since(db, since):
    return db.execute('SELECT COUNT(*) FROM auto_assignments a JOIN tickets t ON t.id=a.ticket_id WHERE a.assigned_at>=?',(since,)).fetchone()[0]


def overview(cd, db, tenant_id, day_start):
    """ระบบอัตโนมัติ → แจกเคสอัตโนมัติ: the settings, who would get a case now (and why not), how many are waiting
    and how many were handed out today."""
    cfg = config(db)
    return {'settings':cfg,'people':[{k:p[k] for k in ('id','name','role','team_id','load','ready','reason')} for p in people(cd,db,tenant_id,cfg)],
            'waiting':len(waiting(db,cfg)),'today':given_since(db,day_start),'active_minutes':ACTIVE_MINUTES,
            'cap_range':[CAP_MIN,CAP_MAX]}


def save(cd, db, ctx, body):
    cfg = form(body,{t['id'] for t in organization.teams(db)})
    db.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(KEY,json.dumps(cfg,ensure_ascii=False)))
    words = (f"เปิด เพดาน {cfg['cap']} เคสต่อคน" + (' รวมเจ้าขององค์กร' if cfg['owners'] else '')
             + ('' if cfg['all_teams'] else f" เฉพาะ {len(cfg['teams'])} ทีม")) if cfg['enabled'] else 'ปิด'
    audit.record(db,ctx['name'],'automation.settings_updated',ctx['tenant_id'],f'แจกเคสอัตโนมัติ ({words})')
    db.commit()
    # Cases already waiting are handed out now, rather than at the worker's next round.
    run(cd,db,ctx['tenant_id'])
    return cfg
