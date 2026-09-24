"""ลำดับคิวและเวลารอโดยประมาณ: what a customer waiting for the team is told on their chat page, so they do not write
again only to ask whether anyone is there.

A customer is waiting from their first message after the team's last reply (the chatbot's answers and the system's
notices do not count as the team answering) until a member of the team replies, while the conversation is open and
with a person rather than the chatbot. Their place is the number of the same team's customers who have been waiting
longer, on any channel, plus one - the order the queue would clear in if taken first come first served; the team may
take an upset customer or a close deadline first, so it is a guide, and the page says "about".

The wait comes from what the team really did, over the last seven days (answered waits: from the customer's first
unanswered message to the reply):

    expected = the larger of  (the team's usual wait - what this customer has waited already)
                        and  (customers ahead + 1) / waits the team answers an hour

The usual wait is the median of those seven days (the whole organization's when the team has too few); the pace is
the waits answered an hour over the last two hours, or the seven-day average when that is higher, as in the SLA
forecast (automation/forecast.py). With no answered wait in seven days there is nothing honest to say: the place is
shown without a time. When nobody who could answer is available now (their status, leave or working hours), the page
says so instead of a time the team will not keep.

Worked out for the whole organization at most once a minute (the chat pages ask every ten seconds). """
import datetime as dt
import statistics
import threading
import time

from backend.database.db import rows
from backend.utils.dates import iso, utc_now

RECENT_HOURS, WEEK_HOURS = 2, 7*24
# Fewer answered waits than this and the team's median says little: the organization's is used.
MIN_WAITS = 5
CACHE_SECONDS = 60
_cache = {}
_lock = threading.Lock()

# The team's last reply to a customer: a message written by a member (not the chatbot or a notice), and gone out.
_HUMAN_REPLY = "r.kind='reply' AND r.delivery!='translating' AND r.id NOT IN (SELECT message_id FROM ai_message_meta)"


def _waiting(db, conversation_id=None):
    """[{id, team_id, since, n}] for every conversation waiting for the team (or only that one), longest waiting first;
    n is the rowid of the first waiting message, which orders two customers who wrote in the same second."""
    only,params = (' AND c.id=?',(conversation_id,)) if conversation_id else ('',())
    found = rows(db,f'''SELECT c.id,c.team_id,
        (SELECT MIN(m.rowid) FROM messages m WHERE m.conversation_id=c.id AND m.kind='customer' AND m.rowid>
            COALESCE((SELECT MAX(r.rowid) FROM messages r WHERE r.conversation_id=c.id AND {_HUMAN_REPLY}),0)) AS n
        FROM conversations c LEFT JOIN ai_conversations a ON a.conversation_id=c.id
        WHERE c.status='open' AND c.channel!='manual' AND COALESCE(a.mode,'human')='human'{only}''',params)
    found = [c for c in found if c['n']]
    for c in found:
        c['since'] = db.execute('SELECT created_at FROM messages WHERE rowid=?',(c['n'],)).fetchone()[0]
    return sorted(found,key=lambda c:(c['since'],c['n']))


def _answered(db, moment):
    """[(team_id, waited seconds, answered at)] for the waits the team answered in the last seven days."""
    week = iso(moment-dt.timedelta(hours=WEEK_HOURS))
    found = rows(db,'''SELECT m.conversation_id,c.team_id,m.kind,m.created_at,
                              (m.kind='reply' AND m.id NOT IN (SELECT message_id FROM ai_message_meta)) AS human
                       FROM messages m JOIN conversations c ON c.id=m.conversation_id
                       WHERE m.created_at>=? AND m.kind IN ('customer','reply') AND m.delivery!='translating'
                       ORDER BY m.conversation_id,m.created_at,m.rowid''',(week,))
    waits,start,current = [],None,None
    for m in found:
        if m['conversation_id']!=current:
            current,start = m['conversation_id'],None
        if m['kind']=='customer':
            start = start or m['created_at']
        elif m['human'] and start:
            waited = (dt.datetime.fromisoformat(m['created_at'])-dt.datetime.fromisoformat(start)).total_seconds()
            waits.append((m['team_id'],max(0,waited),m['created_at']))
            start = None
    return waits


def _pace(waits, moment):
    """(usual wait in seconds or None, waits answered an hour or 0) of a list from _answered."""
    if not waits:
        return None,0
    recent = iso(moment-dt.timedelta(hours=RECENT_HOURS))
    usual = statistics.median(w for _,w,_ in waits)
    rate = max(sum(1 for _,_,at in waits if at>=recent)/RECENT_HOURS,len(waits)/WEEK_HOURS)
    return usual,rate


def _available_teams(tenant_id):
    """(team ids with a member who can answer now, whether an owner who answers every team can)."""
    from backend.database import db as D
    from backend.modules.organization import repository as organization
    from backend.modules.staff_prefs import service as staff_prefs
    with D.control() as cd:
        members = [m for m in organization.tenant_members(cd,tenant_id) if m['active'] and not m['expires_at']]
        state = staff_prefs.availability_of(cd,[m['id'] for m in members])
    here = [m for m in members if state[m['id']]['available']]
    return {m['team_id'] for m in here if m['team_id']},any(m['role']=='admin' for m in here)


def _organization(db, tenant_id):
    """The queues, the pace of each team and the organization's, and who can answer: once a minute at most."""
    with _lock:
        kept = _cache.get(tenant_id)
        if kept and time.monotonic()-kept[0]<CACHE_SECONDS:
            return kept[1]
    moment = utc_now().replace(microsecond=0)
    waits = _answered(db,moment)
    teams = {}
    for team_id,waited,at in waits:
        teams.setdefault(team_id,[]).append((team_id,waited,at))
    pace = {team:_pace(found,moment) for team,found in teams.items() if len(found)>=MIN_WAITS}
    value = {'waiting':_waiting(db),'pace':pace,'overall':_pace(waits,moment),'available':_available_teams(tenant_id)}
    with _lock:
        _cache[tenant_id] = (time.monotonic(),value)
    return value


def estimate(position, waited, usual, rate):
    """Minutes until the team is expected to answer, or None when there is nothing to go by."""
    by_usual = max(0,usual-waited)/60 if usual is not None else None
    by_queue = position/rate*60 if rate else None
    found = [m for m in (by_usual,by_queue) if m is not None]
    return round(max(found)) if found else None


def of(db, tenant_id, conversation):
    """What this customer's chat page shows, or None when they are not waiting for the team: their place, the
    expected wait in minutes (None when unknown), and whether nobody who could answer is available now."""
    # This customer's own wait is read fresh - the page stops showing a queue the moment the team replies; the
    # others' is the minute-old one.
    mine = _waiting(db,conversation['id'])
    if not mine:
        return None
    since,key = mine[0]['since'],(mine[0]['since'],mine[0]['n'])
    value = _organization(db,tenant_id)
    ahead = sum(1 for c in value['waiting'] if c['team_id']==conversation['team_id'] and c['id']!=conversation['id']
                and (c['since'],c['n'])<key)
    teams,owner = value['available']
    if not owner and conversation['team_id'] not in teams:
        return {'position':ahead+1,'wait_minutes':None,'away':True}
    usual,rate = value['pace'].get(conversation['team_id'],value['overall'])
    waited = max(0,(utc_now()-dt.datetime.fromisoformat(since)).total_seconds())
    return {'position':ahead+1,'wait_minutes':estimate(ahead+1,waited,usual,rate),'away':False}
