"""The background workers, whichever server runs: AI drafts (bookdose-ai), LINE / Email / Facebook delivery and
polling (bookdose-channels, bookdose-email) and automation (SLA, reminders, notices, clean-up; bookdose-automation).
Started at most once per process; FastAPI starts them in its lifespan, the legacy server in app.py."""
import threading

_lock = threading.Lock()
_running = False


def start_workers():
    """Start every worker; returns them, or None when this process already runs them."""
    global _running
    from backend.modules.ai.service import Worker as AIWorker
    from backend.modules.automation.service import Worker as AutomationWorker
    from backend.modules.channels.service import Worker as ChannelWorker
    from backend.modules.conversations.service import store_message
    with _lock:
        if _running:
            return None
        _running = True
    workers = [AIWorker(),ChannelWorker(store_message),AutomationWorker()]
    for worker in workers:
        worker.start()
    return workers


def stop_workers(workers):
    """Ask the workers from start_workers() to stop (they finish their current step)."""
    global _running
    if not workers:
        return
    for worker in workers:
        worker.stop.set()
    with _lock:
        _running = False
