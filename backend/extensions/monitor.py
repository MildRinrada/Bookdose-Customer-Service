"""What the server has done since it started, kept in memory for the platform console: API requests per minute for
the last 24 hours (with errors and response time), requests per area and per organization, the latest errors, and
when each background worker last started a round. Nothing is written to disk; a restart starts the counts again.
Request paths are recorded only for errors, and never with their query string (it can hold search terms)."""
import collections
import datetime as dt
import threading
import time

from backend.utils.dates import iso, now

STARTED = time.time()
KEEP_MINUTES = 24*60
# How long a worker may go without starting a round before the console calls it stopped (seconds). A worker that has
# not had its first round yet counts as starting, not stopped, for that long after the server started (the automation
# worker's first round comes only after its first 30 seconds of waiting).
WORKER_GRACE = {'ai':30,'channels':30,'email':30,'automation':120,'security':150}

_lock = threading.Lock()
_minutes = collections.OrderedDict()      # minute number -> [requests, server errors, client errors, total ms]
_areas = collections.Counter()
_tenants = collections.Counter()
_errors = collections.deque(maxlen=100)
_workers = {}


def record(area, status, ms, tenant_id=None):
    """One answered API request. area: staff, customer, platform or webhook."""
    minute = int(time.time()//60)
    with _lock:
        bucket = _minutes.get(minute)
        if bucket is None:
            bucket = _minutes[minute] = [0,0,0,0.0]
            while next(iter(_minutes))<=minute-KEEP_MINUTES:
                _minutes.popitem(last=False)
        bucket[0] += 1
        bucket[1] += status>=500
        bucket[2] += 400<=status<500
        bucket[3] += ms
        _areas[area] += 1
        if tenant_id:
            _tenants[tenant_id] += 1


def error(source, detail, where=''):
    """Something failed: 'server' for a request that could not be answered, or a worker's name."""
    with _lock:
        _errors.appendleft({'at':now(),'source':source,'detail':detail,'where':where})


def heartbeat(name):
    with _lock:
        _workers[name] = time.time()


def _minute_start(minute):
    return iso(dt.datetime.fromtimestamp(minute*60,dt.timezone.utc))


def snapshot():
    moment = time.time()
    minute = int(moment//60)
    with _lock:
        minutes,areas,tenants = dict(_minutes),dict(_areas),dict(_tenants)
        errors,workers = list(_errors),dict(_workers)
    recent = {m:v for m,v in minutes.items() if m>minute-KEEP_MINUTES}
    total = [sum(v[i] for v in recent.values()) for i in range(4)]
    hours = []
    for back in range(23,-1,-1):
        first,last = minute-(back+1)*60+1,minute-back*60
        values = [v for m,v in recent.items() if first<=m<=last]
        hours.append({'start':_minute_start(first),'requests':sum(v[0] for v in values),'errors':sum(v[1] for v in values)})
    return {'started_at':iso(dt.datetime.fromtimestamp(STARTED,dt.timezone.utc)),'uptime_seconds':int(moment-STARTED),
            'requests':total[0],'server_errors':total[1],'client_errors':total[2],
            'average_ms':round(total[3]/total[0],1) if total[0] else 0,
            'last_hour':hours[-1]['requests'],'hours':hours,'areas':areas,'tenants':tenants,'errors':errors,
            'workers':[{'name':name,'running':(moment-workers[name]<=grace) if name in workers else moment-STARTED<=grace,
                        'starting':name not in workers and moment-STARTED<=grace,
                        'seconds_ago':int(moment-workers[name]) if name in workers else None} for name,grace in WORKER_GRACE.items()]}


def server_errors_since(minutes):
    """Requests answered with a server error in the last `minutes` (the console's alert on a sudden rise)."""
    first = int(time.time()//60)-minutes+1
    with _lock:
        return sum(v[1] for m,v in _minutes.items() if m>=first)
