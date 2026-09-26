"""Realtime hints over WebSocket (FastAPI server only; docs/realtime.md).

The socket carries hints, the REST API carries data: an event says what changed ({"type":"changed","scope":...}) and
the page fetches it again through the usual endpoints, where every permission rule stays. Events never carry message
text, attachment names, internal notes, emails or phone numbers; only typing and read receipts are shown as they come.

  hub.py     the in-process hub: who is connected, and a thread-safe send() from request threads and background
             workers to the asyncio loop (loop.call_soon_threadsafe). Imports nothing asyncio-specific, so the legacy
             http.server can import the services that publish; without a running FastAPI loop every send is a no-op.
  events.py  what the services call where they change data: works out who may know (staff of the conversation's
             team, the customer accounts and guests that own it) and queues the events on the database connection,
             so they go out only after that transaction commits (a rolled-back change sends nothing).
  socket.py  the three WebSocket endpoints (staff, customer, guest): Host/Origin and cookie checks at the handshake,
             the session checked again every minute, limits, pings, and typing frames from the browser.

One process only: the hub lives in the memory of the uvicorn worker. Running several workers or machines would need a
message broker (for example Redis pub/sub) between them."""
