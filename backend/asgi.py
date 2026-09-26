"""ASGI application: FastAPI on uvicorn in front of the same route table as the old http.server (backend/server.py).

Phase 1 of docs/architecture.md: FastAPI is only the transport. One catch-all route hands every request to
backend.http.dispatch.dispatch(), which runs the same middleware, controllers, error messages and status codes as
before. FastAPI's own answers never reach a client: no /docs or /openapi.json, and its 404/405/422/500 pages are
replaced by {error: message} with the security headers.

Phase 2a: realtime hints over WebSocket (backend/realtime, docs/realtime.md): /api/realtime/staff,
/api/realtime/customer and /api/public/<org>/guest/realtime. The lifespan attaches the event loop to the in-process
hub, so services and background workers can publish from their threads.

Start it with `python app.py` (see app.py for the options), which runs uvicorn with one worker, no proxy headers and
no access log of its own. `uvicorn backend.asgi:app` also works; then the host, port and secure-cookie setting come
from BOOKDOSE_HOST, BOOKDOSE_PORT and BOOKDOSE_SECURE_COOKIES, and must match the uvicorn options."""
import asyncio
from contextlib import asynccontextmanager
import json
import os
import sys

import anyio
import anyio.to_thread
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.responses import Response

from config import settings
from backend.database import db as D
from backend.http.adapter import RequestAdapter
from backend.http.dispatch import METHODS, SERVER_ERROR, UNSUPPORTED_METHOD, dispatch, log_request
from backend.middleware.security import SECURITY_HEADERS
from backend.realtime import socket as realtime_socket
from backend.realtime.hub import hub
from backend.utils.dates import now
from backend.workers import start_workers, stop_workers

# Requests answered at the same time (each holds a worker thread while its controller runs).
REQUEST_THREADS = 100
# An idle keep-alive connection stays open longer than the web app's proxy keeps it (Node's HTTP agent: 5 s). With
# equal times the server could close a connection just as the proxy sent the next request on it: ECONNRESET, and
# that request answered 500 by Next.js.
KEEP_ALIVE_SECONDS = 20
# Every method the catch-all route accepts; the ones outside METHODS are answered 501 like the old server.
ROUTE_METHODS = [*METHODS,'PUT','HEAD','OPTIONS']

class ServerInfo:
    """req.server for controllers: the address the server was started on (the localhost-only Host check) and whether
    cookies are marked Secure. Tests may change secure_cookies while the server runs."""

    def __init__(self, host, port, secure_cookies=False):
        self.server_address = (host,port)
        self.secure_cookies = secure_cookies


class RawResponse(Response):
    """An answer sent exactly as dispatch() produced it: status, headers in order, body bytes."""

    def __init__(self, status, raw_headers, body):
        self.status_code, self.body, self.background = status, body, None
        self.raw_headers = raw_headers


def error_answer(status, message, close=False):
    """{error: message} with the security headers, for answers made outside dispatch()."""
    body = json.dumps({'error':message},ensure_ascii=False).encode()
    fields = [('Content-Type','application/json; charset=utf-8'),('Content-Length',str(len(body))),*SECURITY_HEADERS.items()]
    if close:
        fields.append(('Connection','close'))
    return RawResponse(status,[(k.lower().encode('latin-1'),v.encode('latin-1')) for k,v in fields],body)


def create_app(server=None, workers=True, log_requests=True, init_database=False):
    """The FastAPI application. server: a ServerInfo (default from config/settings.py). workers: run the background
    workers in the lifespan. init_database: create or upgrade the databases at startup (app.py does it itself)."""
    server = server or ServerInfo(settings.HOST,settings.PORT,settings.SECURE_COOKIES)

    @asynccontextmanager
    async def lifespan(app):
        if init_database:
            if hasattr(os,'umask'):
                os.umask(0o077)
            D.init()
        app.state.limiter = anyio.CapacityLimiter(REQUEST_THREADS)
        loop = asyncio.get_running_loop()
        hub.attach(loop)
        running = start_workers() if workers else None
        try:
            yield
        finally:
            stop_workers(running)
            hub.detach(loop)

    app = FastAPI(title='Bookdose Customer Service',docs_url=None,redoc_url=None,openapi_url=None,lifespan=lifespan)
    app.state.server = server

    async def answer(request: Request):
        method = request.method
        if method not in METHODS:
            return error_answer(501,UNSUPPORTED_METHOD,close=True)
        limiter = getattr(request.app.state,'limiter',None)
        if limiter is None:
            limiter = request.app.state.limiter = anyio.CapacityLimiter(REQUEST_THREADS)
        req = RequestAdapter(request.scope,request.receive,server)
        await anyio.to_thread.run_sync(dispatch,req,limiter=limiter)
        if req.response is None:
            # The client went away or sent its body too slowly; the old server closed the connection unanswered.
            return error_answer(500,SERVER_ERROR,close=True)
        status,raw_headers,body = req.response
        if log_requests:
            log_request(method,status)
        return RawResponse(status,raw_headers,body)

    app.add_api_route('/{target:path}',answer,methods=ROUTE_METHODS,include_in_schema=False)
    # WebSocket routes only match WebSocket handshakes; plain HTTP to these paths still reaches dispatch() (404).
    realtime_socket.add_routes(app,server)

    # FastAPI's own error pages, should anything reach them, answer in the application's format instead.
    async def http_error(request, error):
        if error.status_code==404:
            # A request target the catch-all route cannot hold (an absolute URL): dispatch() judges it as before.
            return await answer(request)
        if error.status_code==405:
            return error_answer(501,UNSUPPORTED_METHOD,close=True)
        return error_answer(error.status_code,'ข้อมูลไม่ถูกต้อง')

    async def validation_error(request, error):
        return error_answer(400,'ข้อมูลไม่ถูกต้อง')

    async def server_error(request, error):
        print(f'[{now()}] Server error: {type(error).__name__}',file=sys.stderr,flush=True)
        return error_answer(500,SERVER_ERROR)

    app.add_exception_handler(HTTPException,http_error)
    app.add_exception_handler(RequestValidationError,validation_error)
    app.add_exception_handler(Exception,server_error)
    return app


def uvicorn_config(app, host, port, **overrides):
    """uvicorn settings for this application: one worker (the realtime hub and rate limits live in this process), the
    client address from the socket only (the web app's forwarded address is judged by middleware/security.py), no
    access log (it would print query strings), no Server header, idle keep-alive connections kept longer than the web
    app's proxy keeps them (KEEP_ALIVE_SECONDS). WebSocket through the pinned `websockets` package
    (sans-I/O implementation), frames above 16 KB refused by uvicorn (the application allows 2 KB), no compression
    (events are tiny), protocol pings every 20 s."""
    import uvicorn
    options = dict(host=host,port=port,workers=1,lifespan='on',proxy_headers=False,forwarded_allow_ips='',
                   access_log=False,server_header=False,date_header=True,timeout_keep_alive=KEEP_ALIVE_SECONDS,
                   timeout_graceful_shutdown=10,h11_max_incomplete_event_size=64*1024,http='h11',
                   ws='websockets-sansio',ws_max_size=16*1024,ws_per_message_deflate=False,ws_ping_interval=20.0,
                   ws_ping_timeout=20.0)
    options.update(overrides)
    return uvicorn.Config(app,**options)


app = create_app(init_database=True)
