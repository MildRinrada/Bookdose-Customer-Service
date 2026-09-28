"""The JSON API's routing, shared by every server. Each request goes through the middleware for its route's access
level, then to the controller listed in backend/modules/*/routes.py. The pages are the Next.js app in frontend/, which
forwards /api/* here; this server answers nothing else.

Access levels, checked in this order:
  page      GET answers that are not JSON: temporary file links, the Facebook webhook check (no sign-in)
  webhook   raw-body callbacks from providers, checked by signature
  portal    a customer's dealings with one active organization (/api/public/<code>); 'customer' routes also
            need the customer's session cookie; 'guest-open' and 'guest' routes are guest web chat (no account: the
            guest cookie g_<code>, required on 'guest' routes) while the organization has it switched on
  customer-public, customer-account  the customer's own account (/api/customer/), the second signed in
  public    sign-up, first-run setup and sign-in
  session   may be signed out (bootstrap)
  account   signed in, with CSRF token
  platform  signed-in platform administrator
  workspace signed-in member of the selected organization (X-Tenant-ID)

A server hands dispatch() an Exchange: the request object controllers know as `req`. The server fills in
  command         HTTP method ('GET', 'POST', 'PATCH', 'DELETE')
  path            the request target as sent (path and query string)
  headers         case-insensitive .get() and `in`, first value wins
  client_address  (address, port) of the socket peer; never taken from a proxy header
  server          .server_address (the address the server was started on) and .secure_cookies
  rfile           .read(n): up to n bytes of the request body, read only when a controller asks
and implements write_response(status, fields, body) to deliver the answer."""
import json
from pathlib import Path
import sys
import time
from urllib.parse import parse_qs, quote, unquote, urlsplit

from backend.database import db as D
from backend.exceptions.errors import APIError, RateLimited
from backend.exceptions.handlers import error_response
from backend.extensions import monitor
from backend.middleware import auth
from backend.middleware.rate_limit import limited
from backend.middleware.security import SECURITY_HEADERS, check_host_and_origin, request_ip
from backend.modules.achievements import routes as achievement_routes
from backend.modules.ai import routes as ai_routes
from backend.modules.auth import routes as auth_routes
from backend.modules.automation import routes as automation_routes, service as automation
from backend.modules.board import routes as board_routes
from backend.modules.channels import routes as channel_routes
from backend.modules.contacts import routes as contact_routes
from backend.modules.customer_security import routes as customer_security_routes
from backend.modules.customers import routes as customer_routes
from backend.modules.guest import blocks as guest_blocks, routes as guest_routes, service as guest_service
from backend.modules.incidents import routes as incident_routes
from backend.modules.pdpa import routes as pdpa_routes
from backend.modules.invitations import routes as invitation_routes
from backend.modules.conversations import routes as conversation_routes
from backend.modules.knowledge import routes as knowledge_routes
from backend.modules.kudos import routes as kudos_routes
from backend.modules.org_links import routes as org_link_routes
from backend.modules.organization import routes as organization_routes, team_security
from backend.modules.platform import routes as platform_routes
from backend.modules.portal import routes as portal_routes, service as portal_service
from backend.modules.reports import routes as report_routes
from backend.modules.search import routes as search_routes
from backend.modules.security import admin_guard, blocks, events as security_events, routes as security_routes, traps
from backend.modules.security.model import TRAP_PATH
from backend.modules.staff_prefs import routes as staff_prefs_routes
from backend.modules.staff_security import routes as staff_security_routes
from backend.modules.support_access import routes as support_access_routes
from backend.modules.tickets import routes as ticket_routes
from backend.modules.trash import routes as trash_routes
from backend.utils.dates import now
from backend.utils.routing import find
from backend.utils.validation import require

ROUTES = [*auth_routes.ROUTES, *platform_routes.ROUTES, *pdpa_routes.ROUTES, *portal_routes.ROUTES, *organization_routes.ROUTES,
          *ticket_routes.ROUTES, *conversation_routes.ROUTES, *contact_routes.ROUTES, *knowledge_routes.ROUTES,
          *ai_routes.ROUTES, *channel_routes.ROUTES, *trash_routes.ROUTES, *automation_routes.ROUTES, *customer_routes.ROUTES,
          *customer_security_routes.ROUTES, *org_link_routes.ROUTES, *guest_routes.ROUTES, *security_routes.ROUTES,
          *support_access_routes.ROUTES, *staff_security_routes.ROUTES, *invitation_routes.ROUTES, *staff_prefs_routes.ROUTES,
          *board_routes.ROUTES, *report_routes.ROUTES, *incident_routes.ROUTES, *kudos_routes.ROUTES, *achievement_routes.ROUTES,
          *search_routes.ROUTES]
MAX_JSON_BYTES = 8*1024*1024
# The methods the route table uses; other methods are refused by the server before dispatch.
METHODS = ('GET','POST','PATCH','DELETE')
UNSUPPORTED_METHOD = 'ไม่รองรับคำขอแบบนี้'
SERVER_ERROR = 'ระบบไม่สามารถทำรายการได้ กรุณาลองใหม่'


def log_request(method, status):
    """The access log line. Request paths are left out on purpose: they can contain user-entered search terms and
    one-time tokens."""
    print(f'[{now()}] {method} {status}',flush=True)


class Exchange:
    """What controllers receive as `req`. Servers subclass it (see the module docstring)."""

    def write_response(self, status, fields, body):
        """Deliver one answer: fields is a list of (header, value) in order, body bytes."""
        raise NotImplementedError

    # Responses
    def send(self, status, data, content_type='application/json; charset=utf-8', headers=None):
        self.status_sent = status
        if content_type.startswith('application/json'):
            data = json.dumps(data,ensure_ascii=False).encode()
        fields = [('Content-Type',content_type),('Content-Length',str(len(data)))]
        fields += {**SECURITY_HEADERS,**self.response_headers,**(headers or {})}.items()
        self.write_response(status,fields,data)

    def send_download(self, name, mime, content):
        return self.send(200,content,mime,{'Content-Disposition':f"attachment; filename=download{Path(name).suffix}; filename*=UTF-8''{quote(name)}"})

    # Requests
    def json_body(self):
        require(self.headers.get('Content-Type','').split(';')[0]=='application/json','ต้องส่งข้อมูลแบบ JSON',415)
        try:
            length = int(self.headers.get('Content-Length','0'))
        except ValueError:
            raise APIError(400,'ข้อมูลไม่ถูกต้อง')
        require(0<length<=MAX_JSON_BYTES,'ขนาดข้อมูลมากเกินไป',413)
        try:
            raw = self.rfile.read(length)
            # Kept for the honeytoken search of the body (security/traps.py); not a copy.
            self.raw_json = raw
            body = json.loads(raw)
        except (ValueError,UnicodeDecodeError):
            raise APIError(400,'ข้อมูล JSON ไม่ถูกต้อง')
        require(isinstance(body,dict),'ข้อมูลต้องเป็น JSON object')
        return body


def dispatch(req):
    """Answer one request (req.command, req.path) through req.send(). Expected errors become {error: message} with
    their status, anything else a 500 with a general message; a client that went away gets no answer."""
    # Request context filled in by the middleware: body, control/tenant database, session,
    # workspace member (ctx), support-page organization and signed-in support-page customer.
    req.body, req.cd, req.db, req.session, req.ctx, req.org, req.customer = {}, None, None, None, None, None, None
    # Guest web chat: the browser's guest, whether its cookie came without the CSRF token, and headers every answer
    # to this request carries (a guest cookie to clear or send again).
    req.guest, req.guest_stale, req.response_headers = None, None, {}
    # For the platform console: which part of the API answered (None for pages and files), status and time.
    req.area, req.status_sent, path, started = None, 0, '', time.perf_counter()
    # Honeypot / honeytoken hits noticed on the way (security/traps.py), written after the answer.
    req.traps = None
    try:
        parsed = urlsplit(req.path)
        req.query = parse_qs(parsed.query)
        path = unquote(parsed.path)
        # The browser's address: the socket's, or the one the Next.js web app forwarded (see middleware/security.py).
        # A blocked address is refused before anything else.
        req.ip = request_ip(req)
        blocks.refuse_blocked(req.ip,(req.headers.get('User-Agent') or '')[:300])
        # Decoy paths and planted API keys are only noted: the request goes on and is answered as it would be anyway.
        traps.inspect_request(req,path)
        check_host_and_origin(req)
        route_request(req,path)
    except (ConnectionError,TimeoutError):
        # The client went away (includes ConnectionAbortedError on Windows); there is nobody to answer.
        pass
    except Exception as error:
        answer = error_response(error)
        if answer is None:
            print(f'[{now()}] Server error: {type(error).__name__}',file=sys.stderr,flush=True)
            monitor.error('server',type(error).__name__,path)
            answer = (500,SERVER_ERROR)
        if isinstance(error,RateLimited):
            security_events.from_request(req,'rate_limited',tenant_id=(req.ctx or {}).get('tenant_id') or (req.org or {}).get('id'),
                                         detail={'area':req.area or '','action':error.action})
        req.send(answer[0],{'error':answer[1],**getattr(error,'extra',{})},headers=getattr(error,'headers',None) or None)
    finally:
        if req.traps:
            traps.report(req)
        if req.area and req.status_sent:
            tenant = (req.ctx or {}).get('tenant_id') or (req.org or {}).get('id')
            monitor.record(req.area,req.status_sent,(time.perf_counter()-started)*1000,tenant)


def run(req, path, access):
    """Call the matching controller of this access level; returns False when there is none."""
    controller, params = find(ROUTES,req.command,path,access)
    if not controller:
        return False
    controller(req,*params)
    return True


def _has_json_body(req):
    length = req.headers.get('Content-Length','0') or '0'
    return (req.headers.get('Content-Type','').split(';')[0]=='application/json' and length.isascii() and length.isdigit()
            and int(length)>0)


def route_request(req, path):
    if run(req,path,'page'):
        return
    # Pages belong to the Next.js app (frontend/).
    require(path.startswith('/api/'),'ไม่พบหน้านี้ · เปิดหน้าเว็บผ่านแอป Next.js (frontend/)',404)
    req.area = 'webhook'
    if run(req,path,'webhook'):
        return
    req.area = 'customer' if path.startswith(('/api/public/','/api/customer/')) else 'platform' if path.startswith('/api/platform') else 'staff'
    # GET carries no body; POST and PATCH must be JSON; a DELETE may carry a JSON body (for example {ip}).
    req.body = req.json_body() if req.command in ('POST','PATCH') or (req.command=='DELETE' and _has_json_body(req)) else {}
    if req.body:
        traps.inspect_body(req,path)
    # The web app's report of a trap page visit; from anyone else this path is just another unknown path.
    if path==TRAP_PATH and traps.trusted_report(req):
        return traps.handle_report(req)
    if path.startswith('/api/public/'):
        return route_portal(req,path)
    if path.startswith('/api/customer/'):
        return route_customer(req,path)
    if run(req,path,'public'):
        return
    with D.control() as cd:
        req.cd = cd
        req.session = auth.signed_in_session(req,optional=path=='/api/bootstrap')
        if run(req,path,'session'):
            return
        auth.check_csrf(req)
        if run(req,path,'account'):
            return
        if path.startswith('/api/platform'):
            auth.require_platform_admin(req)
            # The console only with two-step sign-in or a passkey on the account (security/admin_guard.py).
            admin_guard.require_protected(req)
            if not run(req,path,'platform'):
                raise APIError(404,'ไม่พบรายการ')
            return
        req.ctx = auth.select_workspace(req)
        with D.tenant(req.ctx['tenant_id']) as db:
            req.db = db
            # An organization that requires two-step sign-in lets a member without it no further than their account.
            team_security.check(req)
            # For the live agent monitor: who is using the app right now (a platform admin looking in is not staff).
            if not req.ctx.get('read_only'):
                automation.touch_activity(db,req.ctx)
            if not run(req,path,'workspace'):
                raise APIError(404,'ไม่พบรายการ AI' if path.startswith('/api/ai/') else 'ไม่พบรายการ')


def limit_customer_area(req):
    """Reading and writing are counted apart, so a customer who opened many pages can still act on the next one. A
    signed-in customer is counted by account: behind one proxy or office network every visitor may share an address,
    and one busy customer must not slow down the others. Anyone else (guests, signed out, a cookie naming no session)
    is counted by address."""
    from backend.modules.customers.service import cookie_account
    account = cookie_account(req.cd,req.headers.get('Cookie',''))
    who = ('account',account) if account else ('ip',req.ip)
    limited(('public-read' if req.command=='GET' else 'public-write',*who),180 if req.command=='GET' else 30,60)


def route_portal(req, path):
    match = portal_routes.PORTAL_PATH.fullmatch(path)
    require(match,'ไม่พบรายการ',404)
    with D.control() as cd:
        req.cd = cd
        limit_customer_area(req)
        req.org = portal_service.active_organization(cd,match[1])
        with D.tenant(req.org['id']) as db:
            req.db = db
            if run(req,path,'portal'):
                return
            if match[2]=='guest':
                return route_guest(req,path)
            req.customer = auth.customer_session(req)
            if not run(req,path,'customer'):
                raise APIError(404,'ไม่พบรายการ')


def route_guest(req, path):
    """Guest web chat of the organization (req.org, req.db already chosen)."""
    guest_service.require_enabled(req.db)
    req.guest = auth.guest_session(req)
    if run(req,path,'guest-open'):
        return
    auth.refuse_stale_guest(req)
    require(req.guest,'ไม่พบแชทของคุณในเบราว์เซอร์นี้',401)
    # A guest the organization blocked reads its chats and writes nothing (guest/blocks.py).
    guest_blocks.refuse(req,path)
    if not run(req,path,'guest'):
        raise APIError(404,'ไม่พบรายการ')


def route_customer(req, path):
    """The customer's account, the same for every organization (control database only)."""
    with D.control() as cd:
        req.cd = cd
        limit_customer_area(req)
        if run(req,path,'customer-public'):
            return
        req.customer = auth.customer_session(req)
        if not run(req,path,'customer-account'):
            raise APIError(404,'ไม่พบรายการ')
