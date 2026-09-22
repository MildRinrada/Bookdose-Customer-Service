"""คะแนนสุขภาพต่อองค์กร, for the platform console.

Looking across a list of organizations, the one question nobody could answer was the first one: which of these is
fine and which is in trouble? The numbers that answer it were all there and all in different places - how fast the
team answers, what customers said afterwards, how much is stacking up, and whether the channels are delivering at
all - so this puts the four together into one number per organization.

Four things, because they are the four an organization actually fails at:

  response   cases answered within the deadline the organization set itself (ตั้งค่าองค์กร → SLA). Its own promise,
             not ours: an organization that promised four hours is judged against four hours.
  csat       what customers said when asked, 1 to 5.
  backlog    open cases already past their resolution deadline, against everything open.
  channels   LINE / Email / Facebook that are failing or stuck. Everything else can look fine while nothing the team
             writes actually reaches anybody.

Two rules keep the score honest:
  - A signal with no data is left out of the average rather than counted as zero. A new organization with no cases
    yet is 'new', not 'in trouble'; nothing makes a platform admin trust a number less than a healthy organization
    being marked as failing because it is quiet.
  - What the score is made of travels with it. A number on its own is something to argue with; the same number with
    "ตอบในเวลา 62% · เกินกำหนด 9 เคส" beside it is something to act on.
"""
from backend.database import db as D
from backend.utils.dates import after

WINDOW_DAYS = 30
# Enough cases for the rate to mean anything; below this the signal is shown but not scored.
ENOUGH_CASES = 5
ENOUGH_RATINGS = 3
LEVELS = (('ok', 80), ('watch', 60), ('risk', 0))
WEIGHTS = {'response': 0.3, 'csat': 0.3, 'backlog': 0.2, 'channels': 0.2}


def _level(score):
    for name, floor in LEVELS:
        if score >= floor:
            return name
    return 'risk'


def _response(db, since):
    """Cases opened in the window that were answered before their first-response deadline."""
    row = db.execute('''SELECT COUNT(*) AS total,
                               SUM(CASE WHEN first_response_at IS NOT NULL AND first_response_at<=first_response_due_at
                                        THEN 1 ELSE 0 END) AS in_time
                        FROM tickets WHERE created_at>=?''', (since,)).fetchone()
    total, in_time = row[0] or 0, row[1] or 0
    if total < ENOUGH_CASES:
        return {'key': 'response', 'score': None, 'total': total, 'in_time': in_time}
    return {'key': 'response', 'score': round(in_time / total * 100), 'total': total, 'in_time': in_time}


def _csat(db, since):
    row = db.execute('SELECT COUNT(*) AS answers, AVG(rating) AS average FROM csat_surveys WHERE answered_at>=? AND rating IS NOT NULL',
                     (since,)).fetchone()
    answers, average = row[0] or 0, row[1]
    if answers < ENOUGH_RATINGS or average is None:
        return {'key': 'csat', 'score': None, 'answers': answers, 'average': round(average, 2) if average else None}
    # 1 star is 0, 5 stars is 100.
    return {'key': 'csat', 'score': round((average - 1) / 4 * 100), 'answers': answers, 'average': round(average, 2)}


def _backlog(db, moment):
    """What is open now, and how much of it is already past the deadline the organization promised."""
    row = db.execute('''SELECT COUNT(*) AS open_cases,
                               SUM(CASE WHEN resolution_due_at<? THEN 1 ELSE 0 END) AS overdue
                        FROM tickets WHERE status NOT IN ('resolved','closed')''', (moment,)).fetchone()
    open_cases, overdue = row[0] or 0, row[1] or 0
    if not open_cases:
        return {'key': 'backlog', 'score': None, 'open_cases': 0, 'overdue': 0}
    return {'key': 'backlog', 'score': round((1 - overdue / open_cases) * 100), 'open_cases': open_cases, 'overdue': overdue}


def _channels(db):
    """A channel that cannot deliver is the failure an organization's own screens hide best: everything looks sent."""
    from backend.modules.platform import health
    items = health.tenant_channels(db)
    if not items:
        return {'key': 'channels', 'score': None, 'failing': [], 'connected': 0}
    broken = [c['name'] for c in items if c['status'] == 'error']
    slow = [c['name'] for c in items if c['status'] == 'warning']
    score = 0 if broken else 65 if slow else 100
    return {'key': 'channels', 'score': score, 'failing': broken + slow, 'connected': len(items)}


def of_tenant(tenant_id, moment):
    """The four signals and one score for one organization, or None when it has no database yet."""
    path = D.tenant_path(tenant_id)
    if not path.is_file():
        return None
    since = after(days=-WINDOW_DAYS)
    with D.tenant(tenant_id) as db:
        signals = [_response(db, since), _csat(db, since), _backlog(db, moment), _channels(db)]
    scored = [s for s in signals if s['score'] is not None]
    if not scored:
        # Nothing has happened here yet. Saying so is more useful than a number made of nothing.
        return {'score': None, 'level': 'new', 'signals': {s['key']: s for s in signals}}
    weight = sum(WEIGHTS[s['key']] for s in scored)
    score = round(sum(s['score'] * WEIGHTS[s['key']] for s in scored) / weight)
    return {'score': score, 'level': _level(score), 'signals': {s['key']: s for s in signals}}
