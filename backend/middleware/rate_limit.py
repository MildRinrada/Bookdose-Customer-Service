"""In-memory request limits per key, for example (action, client IP) or (action, tenant, user)."""
from collections import defaultdict, deque
import threading
import time

from backend.exceptions.errors import RateLimited

RATE_LOCK = threading.Lock()
RATES = defaultdict(deque)
MESSAGE = 'ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'


def limited(key, count, period=60):
    """Allow at most `count` calls per `period` seconds for `key`; 429 beyond that."""
    with RATE_LOCK:
        current = time.monotonic()
        if len(RATES) > 10000:
            for old_key in list(RATES):
                if not RATES[old_key] or current-RATES[old_key][-1] > 900:
                    del RATES[old_key]
        bucket = RATES[key]
        while bucket and current-bucket[0] > period:
            bucket.popleft()
        if len(bucket) >= count:
            # The dispatcher records it as a 'rate_limited' security event (action = the first part of the key).
            raise RateLimited(str(key[0]) if isinstance(key,tuple) and key else str(key), MESSAGE)
        bucket.append(current)
