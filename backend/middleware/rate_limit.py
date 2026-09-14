"""In-memory request limits per key, for example (action, client IP) or (action, tenant, user)."""
from collections import defaultdict, deque
import threading
import time

from backend.utils.validation import require

RATE_LOCK = threading.Lock()
RATES = defaultdict(deque)


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
        require(len(bucket) < count, 'ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',429)
        bucket.append(current)
