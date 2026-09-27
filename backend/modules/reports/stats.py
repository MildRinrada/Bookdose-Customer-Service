"""What the case list cannot tell the service report about each case, from its messages:

  waits    each time the customer wrote after the team's first reply and waited for the next one: minutes from the
           customer's first message of that turn to the team's next reply (a reply the chatbot or the system wrote does
           not end the wait, as it does not count as the first reply either). The first reply itself is the first
           response time the report already has. A wait not answered yet is not counted.
  replies  how many replies the team wrote in the case's conversations (people only): with the reopens, the report's
           แก้จบในครั้งเดียว - a finished case the team answered once and that never came back.
  upset    the most upset its customer was at any point (ai/mood.py's log, and the conversation's reading now for
           cases older than the log): 0 ปกติ, 1 ไม่พอใจ, 2 โกรธมาก.

Figures, never words. case_stats is for the report page (merged onto the case list there); summary is the same
figures for a week, in the weekly email (weekly.py)."""
import datetime as dt
from statistics import median

from backend.database.db import one, rows
from backend.utils.dates import now

WAITS_PER_CASE = 100
DONE = ('resolved','closed')


def _minutes(since, until):
    return max(0.0,(dt.datetime.fromisoformat(until)-dt.datetime.fromisoformat(since)).total_seconds()/60)


def _window(since, team):
    """The cases the report may need for a window: opened in it, or finished or reopened in it."""
    where = '''(t.created_at>=? OR t.resolved_at>=? OR EXISTS(SELECT 1 FROM ticket_reopens r WHERE r.ticket_id=t.id AND r.reopened_at>=?))
               AND (? IS NULL OR t.team_id=?)'''
    return where,(since,since,since,team,team)


def case_stats(db, since, team=None):
    """{ticket id: {'waits': [minutes], 'replies': n, 'upset': 0-2}} of the cases touched since `since` (team: only its)."""
    where,params = _window(since,team)
    cases = {r['id']:r for r in rows(db,f'SELECT t.id,t.first_response_at FROM tickets t WHERE {where}',params)}
    found = {tid:{'waits':[],'replies':0,'upset':0} for tid in cases}
    if not cases:
        return found
    waiting = {}
    for m in rows(db,f'''SELECT tc.ticket_id,m.kind,m.created_at,EXISTS(SELECT 1 FROM ai_message_meta a WHERE a.message_id=m.id) AS automatic
                         FROM tickets t JOIN ticket_conversations tc ON tc.ticket_id=t.id JOIN messages m ON m.conversation_id=tc.conversation_id
                         WHERE {where} AND m.kind IN ('customer','reply') ORDER BY tc.ticket_id,m.created_at,m.rowid''',params):
        tid,stat = m['ticket_id'],found[m['ticket_id']]
        first = cases[tid]['first_response_at']
        if m['kind']=='customer':
            if first and m['created_at']>first and tid not in waiting:
                waiting[tid] = m['created_at']
        elif not m['automatic']:
            stat['replies'] += 1
            since_at = waiting.pop(tid,None)
            if since_at and len(stat['waits'])<WAITS_PER_CASE:
                stat['waits'].append(round(_minutes(since_at,m['created_at']),1))
    for r in rows(db,f'''SELECT tc.ticket_id,MAX(COALESCE((SELECT MAX(l.level) FROM conversation_mood_log l WHERE l.conversation_id=tc.conversation_id),0),
                            COALESCE((SELECT c.level FROM conversation_moods c WHERE c.conversation_id=tc.conversation_id),0)) AS upset
                         FROM tickets t JOIN ticket_conversations tc ON tc.ticket_id=t.id WHERE {where} GROUP BY tc.ticket_id,tc.conversation_id''',params):
        found[r['ticket_id']]['upset'] = max(found[r['ticket_id']]['upset'],r['upset'] or 0)
    return found


def _rate(part, whole):
    return round(100*part/whole,1) if whole else None


def summary(db, since, until, team=None):
    """The report's headline figures for [since, until), as the report page counts them: first reply (cases opened in
    it), the next reply and upset customers (the same cases), one-reply solves and reopens (cases finished in it),
    satisfaction (answers given in it), and the open and overdue cases now."""
    stats = case_stats(db,since,team)
    team_where,team_params = ('AND team_id=?',(team,)) if team else ('',())
    opened = rows(db,f'SELECT id,created_at,first_response_at,first_response_due_at FROM tickets WHERE created_at>=? AND created_at<? {team_where}',
                  (since,until,*team_params))
    answered = [t for t in opened if t['first_response_at']]
    firsts = [_minutes(t['created_at'],t['first_response_at']) for t in answered]
    waits = [w for t in opened for w in stats.get(t['id'],{}).get('waits',[])]
    reopens = {r['ticket_id']:r for r in rows(db,'SELECT ticket_id,COUNT(*) AS n,MAX(reopened_at) AS last FROM ticket_reopens GROUP BY ticket_id')}
    solved = rows(db,f'SELECT id,resolved_at FROM tickets WHERE resolved_at>=? AND resolved_at<? {team_where}',(since,until,*team_params))
    replied = [t for t in solved if stats.get(t['id'],{}).get('replies',0)>=1]
    once = [t for t in replied if stats[t['id']]['replies']==1 and t['id'] not in reopens]
    back = rows(db,f'''SELECT id,resolved_at FROM tickets WHERE ((resolved_at>=? AND resolved_at<?) OR id IN
                       (SELECT ticket_id FROM ticket_reopens GROUP BY ticket_id HAVING MAX(reopened_at)>=? AND MAX(reopened_at)<?)) {team_where}''',
                (since,until,since,until,*team_params))
    came_back = [t for t in back if t['id'] in reopens and since<=reopens[t['id']]['last']<until]
    ratings = [r[0] for r in db.execute(f'''SELECT s.rating FROM csat_surveys s JOIN tickets t ON t.id=s.ticket_id WHERE s.answered_at>=? AND s.answered_at<?
                                            AND s.rating IS NOT NULL {team_where.replace('team_id','t.team_id')}''',(since,until,*team_params))]
    moment = now()
    still = one(db,f'''SELECT COUNT(*) AS open,COALESCE(SUM((first_response_at IS NULL AND first_response_due_at<?) OR resolution_due_at<?),0) AS late
                       FROM tickets WHERE status NOT IN {DONE} {team_where}''',(moment,moment,*team_params))
    return {'opened':len(opened),
            'first_response':round(median(firsts),1) if firsts else None,
            'response_sla':_rate(sum(1 for t in answered if t['first_response_at']<=t['first_response_due_at']),len(answered)),
            'next_reply':round(median(waits),1) if waits else None,
            'fcr':_rate(len(once),len(replied)),
            'csat':round(sum(ratings)/len(ratings),2) if ratings else None,'csat_count':len(ratings),
            'reopen':_rate(len(came_back),len(back)),
            'upset':_rate(sum(1 for t in opened if stats.get(t['id'],{}).get('upset',0)>=1),len(opened)),
            'open_now':still['open'],'late_now':still['late']}
