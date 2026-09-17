"""Security events: written where a check refuses something (or a Superadmin changes something), each in its own short
transaction so a refused request that rolls back still leaves its trace. Recording never breaks the request.

Flood control: the same (kind, ip, subject) in the same minute adds to `count` of its row instead of a new row, and at
most EVENT_ROWS_PER_MINUTE new rows are written per minute in all; beyond that an event only adds to the count of the
latest row of its kind in that minute (or is dropped when there is none)."""
import datetime as dt
import json
import sys
import threading

from backend.database import db as D
from backend.modules.security import repository
from backend.modules.security import model
from backend.utils.dates import iso, now, utc_now

_lock = threading.Lock()
_minute = {'key':None,'rows':0}


def parse(text):
    """An ISO timestamp as stored (UTC), or None."""
    try:
        moment = dt.datetime.fromisoformat(text) if text else None
    except (TypeError, ValueError):
        return None
    if moment and moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt.timezone.utc)
    return moment


def record(kind, actor='anonymous', subject='', tenant_id=None, ip='', user_agent='', detail=None, severity=None):
    """Write one event (flood-controlled). Never raises."""
    try:
        severity = severity if severity in model.SEVERITIES else model.EVENT_KINDS.get(kind,'info')
        actor = actor if actor in model.ACTORS else 'anonymous'
        subject = str(subject or '')[:254]
        detail_text = json.dumps(detail or {},ensure_ascii=False)[:2000]
        with D.control() as cd:
            _write(cd,kind,severity,actor,subject,tenant_id,str(ip or '')[:64],str(user_agent or '')[:300],detail_text)
    except Exception as error:
        print(f'[{now()}] Security event {kind}: {type(error).__name__}',file=sys.stderr,flush=True)


def _write(cd, kind, severity, actor, subject, tenant_id, ip, user_agent, detail):
    moment = utc_now()
    at = iso(moment)
    since = iso(moment.replace(second=0))
    D.begin(cd)
    same = repository.same_event(cd,kind,ip,subject,since)
    if same:
        repository.count_event(cd,same['id'])
        return
    with _lock:
        key = (str(D.DATA),since)
        if _minute['key']!=key:
            _minute.update(key=key,rows=0)
        full = _minute['rows']>=model.EVENT_ROWS_PER_MINUTE
        if not full:
            _minute['rows'] += 1
    if full:
        latest = repository.latest_of_kind(cd,kind,since)
        if latest:
            repository.count_event(cd,latest['id'])
        return
    repository.insert_event(cd,at,kind,severity,actor,subject,tenant_id,ip,user_agent,detail)


def user_agent(req):
    return (req.headers.get('User-Agent') or '')[:300]


def from_request(req, kind, **fields):
    """An event about this request: its trusted client address and browser."""
    record(kind,ip=getattr(req,'ip','') or '',user_agent=user_agent(req),**fields)


def staff_actor(session):
    return 'platform' if session and session.get('platform_admin') else 'staff'
