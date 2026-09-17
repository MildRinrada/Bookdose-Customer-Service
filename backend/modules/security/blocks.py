"""Blocked client addresses, checked before anything else on every HTTP request and WebSocket handshake. The address
is the trusted client address (middleware/security.py: the socket peer, or the browser address the Next.js web app
vouches for) - never a raw X-Forwarded-For. The list is kept in memory and read again every BLOCK_CACHE_SECONDS, or at
once after a change made through this process."""
import ipaddress
import threading
import time

from backend.database import db as D
from backend.exceptions.errors import APIError
from backend.modules.security import events, model, repository
from backend.utils.dates import now

_lock = threading.Lock()
_cache = {'data':None,'loaded':0.0,'blocks':{}}


def normalize(ip):
    """The address in its canonical text form, or None."""
    try:
        return str(ipaddress.ip_address(str(ip or '').strip()))
    except ValueError:
        return None


def invalidate():
    with _lock:
        _cache['loaded'] = 0.0


def _blocks():
    data = str(D.DATA)
    with _lock:
        if _cache['data']==data and time.monotonic()-_cache['loaded']<model.BLOCK_CACHE_SECONDS:
            return _cache['blocks']
    with D.control() as cd:
        found = {row['ip']:row['expires_at'] for row in repository.live_blocks(cd)}
    with _lock:
        _cache.update(data=data,loaded=time.monotonic(),blocks=found)
    return found


def blocked(ip):
    ip = normalize(ip)
    if not ip:
        return False
    blocks = _blocks()
    if ip not in blocks:
        return False
    expires = blocks[ip]
    return expires is None or expires>now()


def refuse_blocked(ip, user_agent=''):
    """403 for a blocked address (recorded, flood-controlled)."""
    try:
        is_blocked = blocked(ip)
    except Exception:
        # The list could not be read (database busy): let the request go on rather than refuse everyone.
        return
    if is_blocked:
        events.record('ip_blocked_request',ip=ip,user_agent=user_agent)
        raise APIError(403,model.BLOCKED_MESSAGE)
