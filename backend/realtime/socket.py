"""The WebSocket endpoints (FastAPI only; the legacy http.server has none and the pages keep polling there).

  /api/realtime/staff                 a staff member in the session's current organization
  /api/realtime/customer              a signed-in customer (every organization the account is connected with)
  /api/public/<org>/guest/realtime    a guest of guest web chat of that organization (cookie g_<org>)

Handshake: the socket is accepted, then a blocked client address closes 4403, Host is checked like HTTP (middleware/security.py) and Origin must be this
site's own origin, else close 4403; the cookie is the only credential, and no or an invalid session closes 4401
(an organization without guest chat: 4403). The server then sends {"type":"hello","poll_ms":60000}.

While open: the session is checked again every minute (signed out, device signed out, member removed, organization
switched or suspended: 4401); the server sends {"type":"ping"} every 25 s and closes a socket that sent no frame for
70 s (4408); at most 5 sockets per session or guest browser, frames up to 2 KB and 20 frames per 10 s (else 4429);
a socket that cannot keep up with its events is closed 1013 (the page reconnects and fetches again).

From the browser: {"type":"pong"}, {"type":"typing","conversation_id":"<id>"} and, from staff only,
{"type":"viewing","conversation_id":"<id>"}. Both are passed on only when the sender may reply in that conversation
(staff: a conversation their team may see; customer and guest: their own), at most once per 2.5 s per conversation
per socket. Typing goes to the other side; both also tell the rest of the team who has the conversation open, so two
members do not answer the same customer at once (realtime/events.py staff_here)."""
import asyncio
import collections
import json
import re
import sqlite3
import sys
import time

import anyio.to_thread
from fastapi import WebSocket

from backend.database import db as D
from backend.exceptions.errors import APIError
from backend.http.adapter import Headers
from backend.middleware.security import check_host_and_origin, from_web_app, request_ip
from backend.realtime import events
from backend.realtime.hub import hub
from backend.utils.dates import now

POLL_MS = 60000
PING_SECONDS = 25
IDLE_SECONDS = 70
RECHECK_SECONDS = 60
MAX_FRAME_BYTES = 2048
FRAME_LIMIT = 20
FRAME_WINDOW_SECONDS = 10
TYPING_EVERY_SECONDS = 2.5
QUEUE_SIZE = 256

CLOSE_NORMAL = 1000
CLOSE_BACKLOG = 1013
CLOSE_UNAUTHORIZED = 4401
CLOSE_FORBIDDEN = 4403
CLOSE_IDLE = 4408
CLOSE_LIMIT = 4429

REPLY_CHANNELS = ('web','line','email','facebook','instagram')
# What a browser may signal about a conversation; each is a method name on the identity.
SIGNALS = ('typing','viewing')
ID = re.compile(r'[a-f0-9]{32}')
SLUG = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*')
PING = json.dumps({'type':'ping'})


class Refused(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class Probe:
    """The handshake as middleware/security.py reads a request."""
    command = 'GET'

    def __init__(self, scope, server):
        self.headers = Headers(scope.get('headers') or [])
        client = scope.get('client')
        self.client_address = (client[0],client[1]) if client else ('',0)
        self.server = server


def check_origin(probe):
    """A blocked client address first (4403, recorded); then Host as for HTTP; Origin must be present and be this site
    (cross-site WebSocket hijacking). Every refusal is recorded as a security event."""
    from backend.modules.security import blocks, events
    ip = request_ip(probe)
    try:
        blocks.refuse_blocked(ip,(probe.headers.get('User-Agent') or '')[:300])
    except APIError:
        raise Refused(CLOSE_FORBIDDEN) from None
    try:
        check_host_and_origin(probe)
    except APIError:
        raise Refused(CLOSE_FORBIDDEN) from None
    host = probe.headers.get('X-Forwarded-Host' if from_web_app(probe) else 'Host','')
    if probe.headers.get('Origin') not in ('http://'+host,'https://'+host):
        events.record('origin_rejected',ip=ip,user_agent=(probe.headers.get('User-Agent') or '')[:300],
                      detail={'check':'websocket_origin','host':host[:200],'origin':(probe.headers.get('Origin') or '')[:200]})
        raise Refused(CLOSE_FORBIDDEN)


# Who is on the socket. Every method runs in a worker thread (database work).
class StaffIdentity:
    """A staff member in the organization their session has selected; agents hear only about their team's work."""

    def __init__(self, probe):
        self.cookie = probe.headers.get('Cookie','')
        member,session = self._member()
        if not member:
            raise Refused(CLOSE_UNAUTHORIZED)
        self.token,self.tenant_id,self.user_id = session['token'],session['tenant_id'],session['user_id']
        self.key = ('staff',self.token)
        self._take(member,session)

    def _member(self):
        from backend.modules.auth import service as auth
        from backend.modules.organization import repository as memberships
        with D.control() as cd:
            session = auth.read_session(cd,self.cookie,optional=True)
            member = memberships.workspace_membership(cd,session['user_id'],session['tenant_id']) if session and session['tenant_id'] else None
        return member,session

    def _take(self, member, session):
        self.name,self.role,self.team_id = session['name'],member['role'],member['team_id']

    def recheck(self):
        member,session = self._member()
        if not member or session['token']!=self.token or session['tenant_id']!=self.tenant_id:
            return CLOSE_UNAUTHORIZED
        self._take(member,session)
        return None

    def wants(self, audience):
        return (audience[0]=='staff' and audience[1]==self.tenant_id
                and (self.role!='agent' or audience[2] is None or self.team_id in audience[2]))

    def _repliable(self, db, conversation_id):
        """The conversation when this member may reply in it, else None."""
        conv = D.find_in_team(db,'conversations',conversation_id,self.team_id if self.role=='agent' else None)
        return conv if conv and conv['channel'] in REPLY_CHANNELS else None

    def typing(self, conversation_id):
        with D.tenant(self.tenant_id) as db:
            conv = self._repliable(db,conversation_id)
            if not conv:
                return None
            # The customer sees "กำลังพิมพ์" on their own page; the team sees who is already writing the answer.
            return events.staff_typing(db,conv,self.name)+events.staff_here(db,conv,self.user_id,self.name,True)

    def viewing(self, conversation_id):
        """The member has the conversation open: the rest of the team hears, the customer does not."""
        with D.tenant(self.tenant_id) as db:
            conv = self._repliable(db,conversation_id)
            return events.staff_here(db,conv,self.user_id,self.name,False) if conv else None


class CustomerIdentity:
    """A signed-in customer account, in every organization it is connected with."""

    def __init__(self, probe):
        from backend.modules.customers import service as customers
        self.cookie = probe.headers.get('Cookie','')
        with D.control() as cd:
            session = customers.read_session(cd,self.cookie)
        if not session:
            raise Refused(CLOSE_UNAUTHORIZED)
        self.token_hash,self.account_id,self.name = session['token_hash'],session['account_id'],session['name']
        self.key = ('customer',self.token_hash)
        self._tenants = {}

    def recheck(self):
        from backend.modules.customers import service as customers
        # Signed out, device signed out, or past its limits (the check itself is never activity).
        with D.control() as cd:
            session = customers.read_session(cd,self.cookie)
        if not session or session['token_hash']!=self.token_hash:
            return CLOSE_UNAUTHORIZED
        self.name = session['name']
        return None

    def wants(self, audience):
        return audience==('account',self.account_id)

    def typing(self, conversation_id):
        from backend.modules.customers import repository as accounts
        from backend.modules.platform import repository as tenants
        with D.control() as cd:
            candidates = [t for t in accounts.org_ids(cd,self.account_id) if tenants.is_active(cd,t)]
        known = self._tenants.get(conversation_id)
        for tenant_id in ([known] if known in candidates else [])+candidates:
            with D.tenant(tenant_id) as db:
                conv = accounts.owned_conversation(db,self.account_id,conversation_id)
                if conv:
                    if len(self._tenants)>100:
                        self._tenants.clear()
                    self._tenants[conversation_id] = tenant_id
                    return events.customer_typing(db,conv,self.name)
        return None


class GuestIdentity:
    """A guest of guest web chat in one organization (its browser's cookie)."""

    def __init__(self, probe, slug):
        from backend.modules.guest import schema, service as guest
        from backend.modules.platform import repository as tenants
        if not SLUG.fullmatch(slug or ''):
            raise Refused(CLOSE_FORBIDDEN)
        with D.control() as cd:
            org = tenants.find_active_by_slug(cd,slug)
        if not org:
            raise Refused(CLOSE_FORBIDDEN)
        with D.tenant(org['id']) as db:
            if not guest.guest_chat_enabled(db):
                raise Refused(CLOSE_FORBIDDEN)
            token,_ = guest.cookie_token(probe.headers.get('Cookie',''),slug)
            found = guest.read_guest(db,token) if token else None
        if not found:
            raise Refused(CLOSE_UNAUTHORIZED)
        self.tenant_id,self.visitor_id = org['id'],found['visitor']['id']
        self.token_hash,self.name = found['device']['token_hash'],schema.display_name(found['visitor'])
        self.key = ('guest',self.tenant_id,self.token_hash)

    def recheck(self):
        from backend.modules.guest import repository, schema, service as guest
        from backend.modules.platform import repository as tenants
        with D.control() as cd:
            if not tenants.is_active(cd,self.tenant_id):
                return CLOSE_FORBIDDEN
        with D.tenant(self.tenant_id) as db:
            if not guest.guest_chat_enabled(db):
                return CLOSE_FORBIDDEN
            device = repository.device(db,self.token_hash)
            if not device or device['visitor_id']!=self.visitor_id:
                return CLOSE_UNAUTHORIZED
            self.name = schema.display_name(repository.visitor(db,self.visitor_id))
        return None

    def wants(self, audience):
        return audience==('guest',self.tenant_id,self.visitor_id)

    def typing(self, conversation_id):
        from backend.modules.guest import repository
        with D.tenant(self.tenant_id) as db:
            conv = repository.owned_conversation(db,self.visitor_id,conversation_id)
            return events.customer_typing(db,conv,self.name) if conv else None


# One open socket
class Socket:
    def __init__(self, websocket, identity):
        self.websocket,self.identity,self.key = websocket,identity,identity.key
        self.queue = asyncio.Queue(QUEUE_SIZE)
        self.done = asyncio.Event()
        self.code = None
        self.frames = collections.deque()
        # The last time each signal was passed on, per conversation: {'typing': {...}, 'viewing': {...}}.
        self.signalled = {kind:{} for kind in SIGNALS}

    # Called by the hub on the loop
    def wants(self, audience):
        return self.identity.wants(audience)

    def push(self, text):
        try:
            self.queue.put_nowait(text)
        except asyncio.QueueFull:
            self.finish(CLOSE_BACKLOG)

    def finish(self, code):
        if self.code is None:
            self.code = code
        self.done.set()

    async def run(self):
        self.push(json.dumps({'type':'hello','poll_ms':POLL_MS}))
        tasks = [asyncio.create_task(job) for job in (self._send(),self._receive(),self._ping(),self._recheck(),self.done.wait())]
        try:
            await asyncio.wait(tasks,return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks,return_exceptions=True)
        if self.code!='gone':
            try:
                await self.websocket.close(self.code or CLOSE_NORMAL)
            except Exception:
                pass

    async def _send(self):
        try:
            while True:
                await self.websocket.send_text(await self.queue.get())
        except asyncio.CancelledError:
            raise
        except Exception:
            self.finish('gone')

    async def _ping(self):
        while True:
            await asyncio.sleep(PING_SECONDS)
            self.push(PING)

    async def _recheck(self):
        while True:
            await asyncio.sleep(RECHECK_SECONDS)
            try:
                code = await anyio.to_thread.run_sync(self.identity.recheck)
            except sqlite3.OperationalError:
                # Busy for a moment: try again next time.
                continue
            except Exception:
                code = CLOSE_UNAUTHORIZED
            if code:
                return self.finish(code)

    async def _receive(self):
        try:
            while True:
                try:
                    message = await asyncio.wait_for(self.websocket.receive(),IDLE_SECONDS)
                except asyncio.TimeoutError:
                    return self.finish(CLOSE_IDLE)
                if message['type']=='websocket.disconnect':
                    return self.finish('gone')
                text = message.get('text')
                size = len(text.encode('utf-8','replace')) if text is not None else len(message.get('bytes') or b'')
                moment = time.monotonic()
                self.frames.append(moment)
                while self.frames and self.frames[0]<=moment-FRAME_WINDOW_SECONDS:
                    self.frames.popleft()
                if size>MAX_FRAME_BYTES or len(self.frames)>FRAME_LIMIT:
                    return self.finish(CLOSE_LIMIT)
                try:
                    frame = json.loads(text) if text is not None else None
                except ValueError:
                    continue
                if isinstance(frame,dict) and frame.get('type') in SIGNALS:
                    await self._signal(frame['type'],frame.get('conversation_id'))
        except asyncio.CancelledError:
            raise
        except Exception:
            self.finish('gone')

    async def _signal(self, kind, conversation_id):
        """A typing or viewing frame: rate-limited per conversation, then whatever the identity says it means.
        An identity that does not know the signal (a customer has no 'viewing') simply says nothing."""
        handler = getattr(self.identity,kind,None)
        if handler is None or not isinstance(conversation_id,str) or not ID.fullmatch(conversation_id):
            return
        seen = self.signalled[kind]
        moment = time.monotonic()
        if moment-seen.get(conversation_id,float('-inf'))<TYPING_EVERY_SECONDS:
            return
        if len(seen)>100:
            seen.clear()
        seen[conversation_id] = moment
        try:
            deliveries = await anyio.to_thread.run_sync(handler,conversation_id)
        except Exception as error:
            print(f'[{now()}] Realtime {kind}: {type(error).__name__}',file=sys.stderr,flush=True)
            return
        hub.send(deliveries or [])


async def serve(websocket, server, identify):
    await websocket.accept()
    try:
        probe = Probe(websocket.scope,server)
        await anyio.to_thread.run_sync(check_origin,probe)
        identity = await anyio.to_thread.run_sync(identify,probe)
    except Refused as refused:
        await websocket.close(refused.code)
        return
    except Exception as error:
        print(f'[{now()}] Realtime handshake: {type(error).__name__}',file=sys.stderr,flush=True)
        await websocket.close(1011)
        return
    socket = Socket(websocket,identity)
    if not hub.add(socket):
        await websocket.close(CLOSE_LIMIT)
        return
    try:
        await socket.run()
    finally:
        hub.remove(socket)


def add_routes(app, server):
    """The three endpoints on the FastAPI app (server: the ServerInfo the Host check reads)."""

    async def staff(websocket: WebSocket):
        await serve(websocket,server,StaffIdentity)

    async def customer(websocket: WebSocket):
        await serve(websocket,server,CustomerIdentity)

    async def guest(websocket: WebSocket, org: str):
        await serve(websocket,server,lambda probe:GuestIdentity(probe,org))

    app.add_api_websocket_route('/api/realtime/staff',staff)
    app.add_api_websocket_route('/api/realtime/customer',customer)
    app.add_api_websocket_route('/api/public/{org}/guest/realtime',guest)
