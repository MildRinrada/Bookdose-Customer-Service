"""In-memory request limits per key, for example (action, client IP) or (action, tenant, user)."""
from collections import defaultdict, deque
import math
import threading
import time

from backend.exceptions.errors import RateLimited

RATE_LOCK = threading.Lock()
RATES = defaultdict(deque)
MESSAGE = 'ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'


def limited(key, count, period=60):
    """Allow at most `count` calls per `period` seconds for `key`; 429 beyond that, with retry_after (and Retry-After):
    the seconds until the oldest counted call leaves the window, so a page can ask again then instead of giving up."""
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
            retry_after = max(1, math.ceil(period-(current-bucket[0])))
            raise RateLimited(str(key[0]) if isinstance(key,tuple) and key else str(key), MESSAGE, retry_after)
        bucket.append(current)
