"""The in-process hub between whatever changes data (request threads, background workers) and the open sockets
(the asyncio loop of uvicorn).

An audience names who may receive an event:
  ('staff', tenant_id, teams)      members of that organization; teams is a frozenset of team ids an agent must
                                   belong to (admins and managers see every team), or None for every member
  ('account', account_id)          every socket of a signed-in customer account
  ('guest', tenant_id, visitor_id) every browser of a guest of guest web chat in that organization

send() may be called from any thread. Nothing here imports asyncio machinery: the legacy http.server never attaches a
loop, so every send is a no-op there."""
import json
import threading

# Sockets per session (staff, customer) or per browser (guest).
MAX_SOCKETS_PER_KEY = 5


class Hub:
    def __init__(self):
        self._lock = threading.Lock()
        self._loop = None
        self._clients = set()

    # The loop (FastAPI lifespan)
    def attach(self, loop):
        with self._lock:
            self._loop = loop

    def detach(self, loop=None):
        with self._lock:
            if loop is None or self._loop is loop:
                self._loop = None
                self._clients = set()

    def listening(self):
        """True while a loop runs and at least one socket is open: only then is it worth working out recipients."""
        return self._loop is not None and bool(self._clients)

    # Sockets (called on the loop)
    def add(self, client):
        """Register an authenticated socket; False when its session or browser already has the most sockets."""
        with self._lock:
            if sum(1 for c in self._clients if c.key==client.key)>=MAX_SOCKETS_PER_KEY:
                return False
            self._clients = self._clients|{client}
            return True

    def remove(self, client):
        with self._lock:
            self._clients = self._clients-{client}

    def count(self):
        return len(self._clients)

    # Events
    def send(self, deliveries):
        """deliveries: [(audience, payload dict)], delivered in order on the loop. Safe from any thread."""
        loop = self._loop
        if loop is None or not deliveries:
            return
        frames = [(audience,json.dumps(payload,ensure_ascii=False)) for audience,payload in deliveries]
        try:
            loop.call_soon_threadsafe(self._fan_out,frames)
        except RuntimeError:
            # The loop is closing (server shutdown).
            pass

    def _fan_out(self, frames):
        clients = self._clients
        for audience,text in frames:
            for client in clients:
                if client.wants(audience):
                    client.push(text)


hub = Hub()
