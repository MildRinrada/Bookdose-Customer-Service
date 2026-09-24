"""Which cases are likely to break their SLA, before they do: from the queue in front of each case and how fast the
team is getting through work right now.

A clock only says a case is late once it is. What decides whether it will be is how many cases stand ahead of it
and how quickly they are being cleared, so each open case is given an expected time and compared with its deadline:

    expected = now + (cases ahead of it + 1) / cases cleared per hour

The first reply: every case nobody has answered yet stands in its team's queue, earliest deadline first (the order
the team works it), and the rate is the team's first replies an hour - over the last two hours, or its seven-day
average when that is higher, so a quiet morning with nothing coming in does not read as a team that has stopped.

Resolution: a case stands in its owner's queue (the team's, while nobody owns it), earliest deadline first, and the
rate is the cases that owner closed an hour over the last day, or over seven days when that is higher. Calendar
hours on both sides: a two-day resolution deadline runs through the night, and so does the average.

A case already past its deadline is the clock's business (SLA Watch), not a forecast. A queue with no rate at all -
nothing answered or closed in seven days - cannot be forecast, and says so rather than calling every case late. """
import datetime as dt

from backend.database.db import rows
from backend.utils.dates import iso, utc_now

WORKING = "('new','open','pending_internal')"   # a case waiting for the customer is not the team's move
RECENT_HOURS, DAY_HOURS, WEEK_HOURS = 2, 24, 7*24


def _at(value):
    return dt.datetime.fromisoformat(value) if value else None


def _rate(recent, recent_hours, week):
    """Cases an hour: the recent pace, or the seven-day one when that is higher."""
    return max(recent/recent_hours, week/WEEK_HOURS)


def predict(cases, response_rates, resolution_rates, moment):
    """The cases expected past a deadline, soonest deadline first, each once (the deadline it misses first).

    cases: open working cases (dicts with id, number, subject, priority, team_id, assignee_id, first_response_at,
    first_response_due_at, resolution_due_at). response_rates: {team_id: first replies an hour}. resolution_rates:
    {('member', id) or ('team', team_id): cases closed an hour}. Returns (forecast list, cases that could not be
    forecast for want of any pace)."""
    found,unknown = {},set()

    def queue(members, due_key, rate, kind):
        members.sort(key=lambda t:(t[due_key],t['number']))
        for ahead,t in enumerate(members):
            due = _at(t[due_key])
            if due is None or due<=moment:
                continue
            if not rate:
                unknown.add(t['id'])
                continue
            expected = moment+dt.timedelta(hours=(ahead+1)/rate)
            if expected<=due:
                continue
            late = (expected-due).total_seconds()/60
            current = found.get(t['id'])
            if current is None or due<_at(current['due']):
                found[t['id']] = {'id':t['id'],'number':t['number'],'subject':t['subject'],'priority':t['priority'],
                                  'assignee_id':t['assignee_id'],'team_id':t['team_id'],'kind':kind,'due':iso(due),
                                  'expected':iso(expected),'late_minutes':round(late),'ahead':ahead,'per_hour':round(rate,2)}

    by_team,by_owner = {},{}
    for t in cases:
        if not t['first_response_at']:
            by_team.setdefault(t['team_id'],[]).append(t)
        owner = ('member',t['assignee_id']) if t['assignee_id'] else ('team',t['team_id'])
        by_owner.setdefault(owner,[]).append(t)
    for team_id,members in by_team.items():
        queue(members,'first_response_due_at',response_rates.get(team_id,0),'response')
    for owner,members in by_owner.items():
        queue(members,'resolution_due_at',resolution_rates.get(owner,0),'resolution')
    result = sorted(found.values(),key=lambda f:(f['due'],f['number']))
    return result,len(unknown-set(found))


def _count(db, sql, params):
    return {r[0]:r[1] for r in db.execute(sql,params).fetchall()}


def team_pace(db, moment):
    """({team_id: first replies an hour}, {('member'|'team', id): cases closed an hour})."""
    recent,day,week = (iso(moment-dt.timedelta(hours=h)) for h in (RECENT_HOURS,DAY_HOURS,WEEK_HOURS))
    first_sql = 'SELECT team_id,COUNT(*) FROM tickets WHERE first_response_at>=? GROUP BY team_id'
    first_recent,first_week = _count(db,first_sql,(recent,)),_count(db,first_sql,(week,))
    response = {team:_rate(first_recent.get(team,0),RECENT_HOURS,first_week.get(team,0)) for team in first_week}
    member_sql = 'SELECT assignee_id,COUNT(*) FROM tickets WHERE assignee_id IS NOT NULL AND resolved_at>=? GROUP BY assignee_id'
    team_sql = 'SELECT team_id,COUNT(*) FROM tickets WHERE resolved_at>=? GROUP BY team_id'
    resolution = {}
    for kind,sql in (('member',member_sql),('team',team_sql)):
        closed_day,closed_week = _count(db,sql,(day,)),_count(db,sql,(week,))
        for key in closed_week:
            resolution[(kind,key)] = _rate(closed_day.get(key,0),DAY_HOURS,closed_week.get(key,0))
    return response,resolution


def sla_forecast(db, team_id=None):
    """The dashboard's forecast. The queues and the pace are the whole organization's - a team's queue is shared by
    everyone in it - and the list is cut to the team an agent may see (team_id) afterwards."""
    moment = utc_now().replace(microsecond=0)
    cases = rows(db,f'''SELECT id,number,subject,priority,team_id,assignee_id,first_response_at,first_response_due_at,resolution_due_at
                        FROM tickets WHERE status IN {WORKING} AND snoozed_until IS NULL''')
    response,resolution = team_pace(db,moment)
    found,unknown = predict(cases,response,resolution,moment)
    if team_id is not None:
        found = [f for f in found if f['team_id']==team_id]
    first = [rate for rate in response.values() if rate]
    return {'cases':found,'unknown':unknown,'generated_at':iso(moment),
            'response_per_hour':round(sum(first),2) if first else None}
