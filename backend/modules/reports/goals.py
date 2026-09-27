"""เป้าหมายของทีม: what the organization's owner calls good enough, so the service report can say whether a figure is -
for the whole organization, and per team where a team's differs (a team left out follows the organization's).

Kept in the organization's settings (report_goals, JSON: {org: {metric: target}, teams: {team id: {metric: target}}}),
so they reach every member's report with the workspace; the report works each figure out as it always does and
compares. A metric with no target is simply not a goal."""
import json

from backend.database import audit
from backend.utils.validation import require

KEY = 'report_goals'
# metric: (what it is in the report, better high or low, the lowest and highest target that makes sense)
METRICS = {
    'response_sla':('ตอบทัน SLA (%)','high',1,100),
    'first_response':('ตอบครั้งแรก ค่ากลาง (นาที)','low',1,10080),
    'next_reply':('รอคำตอบถัดไป ค่ากลาง (นาที)','low',1,10080),
    'fcr':('แก้จบในครั้งเดียว (%)','high',1,100),
    'csat':('คะแนนความพึงพอใจ (1-5)','high',1,5),
    'reopen':('เปิดซ้ำ (%)','low',0,100),
    'upset':('ลูกค้าไม่พอใจ (%)','low',0,100),
}


def saved(db):
    row = db.execute('SELECT value FROM settings WHERE key=?',(KEY,)).fetchone()
    try:
        value = json.loads(row[0]) if row and row[0] else {}
    except ValueError:
        value = {}
    value = value if isinstance(value,dict) else {}
    return {'org':value.get('org') if isinstance(value.get('org'),dict) else {},
            'teams':value.get('teams') if isinstance(value.get('teams'),dict) else {}}


def _targets(value, where):
    require(isinstance(value,dict),'ข้อมูลเป้าหมายไม่ถูกต้อง')
    found = {}
    for metric,target in value.items():
        require(metric in METRICS,'ข้อมูลเป้าหมายไม่ถูกต้อง')
        if target is None or target=='':
            continue
        label,_,low,high = METRICS[metric]
        require(isinstance(target,(int,float)) and not isinstance(target,bool) and low<=target<=high,
                f'{label} ของ{where}ต้องอยู่ระหว่าง {low:g} ถึง {high:,}')
        found[metric] = round(float(target),2)
    return found


def form(db, body):
    """{org: {metric: target}, teams: {team id: {metric: target}}}; an empty or missing target is no goal."""
    from backend.modules.organization import repository as organization
    body = body if isinstance(body,dict) else {}
    teams = body.get('teams') or {}
    require(isinstance(teams,dict),'ข้อมูลเป้าหมายไม่ถูกต้อง')
    names = {t['id']:t['name'] for t in organization.teams(db)}
    require(set(teams)<=set(names),'บางทีมถูกลบไปแล้ว กรุณาโหลดหน้าใหม่')
    found = {'org':_targets(body.get('org') or {},'ทั้งองค์กร'),'teams':{}}
    for team_id,value in teams.items():
        targets = _targets(value,f'ทีม{names[team_id]}')
        if targets:
            found['teams'][team_id] = targets
    return found


def save(db, ctx, body):
    goals = form(db,body)
    db.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(KEY,json.dumps(goals,ensure_ascii=False)))
    audit.record(db,ctx['name'],'settings.updated',ctx['tenant_id'],'เป้าหมายของทีมในรายงาน')
    db.commit()
    return goals


def met(metric, value, target):
    """Whether a figure reaches its target (None when there is no figure)."""
    if value is None:
        return None
    return value>=target if METRICS[metric][1]=='high' else value<=target
