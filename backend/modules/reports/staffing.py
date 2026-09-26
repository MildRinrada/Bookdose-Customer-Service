"""คนที่ต้องใช้แต่ละวัน: who of the team is expected to work on each of the coming days, for the report's staffing
card, which sets it against the forecast of new cases (frontend reports/staffing.ts) to say which days are short.

A member works on a day unless they are on leave then (ตั้งค่าบัญชี → สถานะการทำงาน → วันลา), it is not one of their
working days (their own hours, when they set them), or the organization is closed for a holiday (เวลาทำการ →
วันหยุดพิเศษ, when the organization uses its hours). A member who never set their hours is counted on the days the
organization is open, or every day when the organization has no hours either, and is flagged so the card can say
the count rests on a guess.

Owners only: it tells who is on leave when. The reason of a leave stays with the member; only that they are away."""
import datetime as dt

from backend.modules.organization import hours as business_hours, repository as organization
from backend.modules.staff_prefs.model import WORK_TZ
from backend.utils.dates import after
from backend.utils.validation import require

DAYS = 15
HANDLED_DAYS = 28


def _schedule(prefs, org, day):
    """(works, why not: '' | 'leave' | 'off' | 'holiday', from their own hours)."""
    text = day.isoformat()
    if org['uses'] and text in org['holidays']:
        return False,'holiday'
    if any(item['from']<=text<=item['to'] for item in prefs['leave']):
        return False,'leave'
    if prefs['hours']['enabled']:
        return (True,'') if day.weekday() in prefs['hours']['days'] else (False,'off')
    return (True,'') if org['open'][day.weekday()] else (False,'off')


def overview(cd, db, ctx):
    from backend.modules.staff_prefs import service as staff_prefs
    require(ctx['role']=='admin','เฉพาะเจ้าขององค์กร',403)
    cfg = business_hours.config(db)
    uses = bool((cfg.get('enabled') or cfg.get('sla')) and any(cfg['days']))
    org = {'uses':uses,'holidays':{h['date']:h['name'] for h in cfg.get('holidays') or []},
           'open':[bool(d) for d in cfg['days']] if uses else [True]*7}
    today = dt.datetime.now(WORK_TZ).date()
    days = [today+dt.timedelta(days=i) for i in range(DAYS)]
    handled = dict(db.execute('SELECT assignee_id,COUNT(*) FROM tickets WHERE assignee_id IS NOT NULL AND resolved_at>=? GROUP BY assignee_id',
                              (after(days=-HANDLED_DAYS),)).fetchall())
    members = []
    for m in organization.tenant_members(cd,ctx['tenant_id']):
        if not m['active']:
            continue
        prefs = staff_prefs.prefs_of(cd,m['id'])
        plan = [_schedule(prefs,org,day) for day in days]
        members.append({'id':m['id'],'name':m['name'],'role':m['role'],'team_id':m['team_id'],
                        'resolved':handled.get(m['id'],0),'hours_set':bool(prefs['hours']['enabled']),
                        'days':[{'works':works,'why':why} for works,why in plan]})
    return {'days':[d.isoformat() for d in days],'members':members,'handled_days':HANDLED_DAYS,
            'holidays':[{'date':d.isoformat(),'name':org['holidays'][d.isoformat()]} for d in days if uses and d.isoformat() in org['holidays']],
            'org_hours':uses}
