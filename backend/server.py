"""HTTP server. Each request goes through the middleware for its route's access level, then to the controller
listed in backend/modules/*/routes.py. Also serves the browser files (public/, css/, frontend/).

Access levels, checked in this order:
  page      GET pages and downloads outside the JSON API (no sign-in)
  webhook   raw-body callbacks from providers, checked by signature
  portal    support page of an active organization; visitor routes also need the visitor's link token
  public    sign-up, first-run setup and sign-in
  session   may be signed out (bootstrap)
  account   signed in, with CSRF token
  platform  signed-in platform administrator
  workspace signed-in member of the selected organization (X-Tenant-ID)"""
from http.server import BaseHTTPRequestHandler
import json
import mimetypes
from pathlib import Path
import sys
from urllib.parse import parse_qs, quote, unquote, urlsplit

from config import settings
from backend.database import db as D
from backend.exceptions.errors import APIError
from backend.exceptions.handlers import error_response
from backend.middleware import auth
from backend.middleware.rate_limit import limited
from backend.middleware.security import SECURITY_HEADERS, check_host_and_origin
from backend.modules.ai import routes as ai_routes
from backend.modules.auth import routes as auth_routes
from backend.modules.automation import routes as automation_routes, service as automation
from backend.modules.channels import routes as channel_routes
from backend.modules.contacts import routes as contact_routes
from backend.modules.conversations import routes as conversation_routes
from backend.modules.knowledge import routes as knowledge_routes
from backend.modules.organization import routes as organization_routes
from backend.modules.platform import routes as platform_routes
from backend.modules.portal import routes as portal_routes, service as portal_service
from backend.modules.tickets import routes as ticket_routes
from backend.modules.trash import routes as trash_routes
from backend.utils.dates import now
from backend.utils.routing import find
from backend.utils.validation import require

ROUTES = [*auth_routes.ROUTES, *platform_routes.ROUTES, *portal_routes.ROUTES, *organization_routes.ROUTES,
          *ticket_routes.ROUTES, *conversation_routes.ROUTES, *contact_routes.ROUTES, *knowledge_routes.ROUTES,
          *ai_routes.ROUTES, *channel_routes.ROUTES, *trash_routes.ROUTES, *automation_routes.ROUTES]
# URL prefix -> folder. Other paths are looked up in public/; nothing outside these folders is ever served.
STATIC_FOLDERS = {'css':settings.CSS_DIR,'frontend':settings.FRONTEND_DIR}
MAX_JSON_BYTES = 8*1024*1024


def template_bundle():
    """Every HTML template under frontend/ as {name: markup}, e.g. 'pages/dashboard/dashboard'.
    The browser loads them in one request instead of one request per file."""
    return {path.relative_to(settings.FRONTEND_DIR).with_suffix('').as_posix():path.read_text(encoding='utf-8')
            for path in sorted(settings.FRONTEND_DIR.rglob('*.html'))}


class Handler(BaseHTTPRequestHandler):
    server_version = 'Bookdose/1.0'

    def log_message(self, fmt, *args):
        # Omit request paths, which can contain user-entered search terms.
        if args and isinstance(args[0], str) and args[0].startswith(('GET ','POST ','PATCH ','DELETE ')):
            print(f'[{now()}] {self.command} {args[1] if len(args)>1 else ""}',flush=True)

    # Responses
    def send(self, status, data, content_type='application/json; charset=utf-8', headers=None):
        if content_type.startswith('application/json'):
            data = json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(data)))
        for key,value in {**SECURITY_HEADERS,**(headers or {})}.items():
            self.send_header(key,value)
        self.end_headers()
        self.wfile.write(data)

    def send_download(self, name, mime, content):
        return self.send(200,content,mime,{'Content-Disposition':f"attachment; filename=download{Path(name).suffix}; filename*=UTF-8''{quote(name)}"})

    def send_static(self, path):
        require(self.command=='GET','ไม่พบหน้านี้',404)
        prefix, _, rest = path.lstrip('/').partition('/')
        if path=='/' or path.startswith('/support/'):
            folder, name = settings.PUBLIC_DIR, 'index.html'
        elif prefix in STATIC_FOLDERS and rest:
            folder, name = STATIC_FOLDERS[prefix], rest
        else:
            folder, name = settings.PUBLIC_DIR, path.lstrip('/')
        file = folder/name
        require(file.resolve().is_relative_to(folder.resolve()) and file.is_file(),'ไม่พบหน้านี้',404)
        mime = mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
        return self.send(200,file.read_bytes(),mime+'; charset=utf-8')

    # Requests
    def json_body(self):
        require(self.headers.get('Content-Type','').split(';')[0]=='application/json','ต้องส่งข้อมูลแบบ JSON',415)
        try:
            length = int(self.headers.get('Content-Length','0'))
        except ValueError:
            raise APIError(400,'ข้อมูลไม่ถูกต้อง')
        require(0<length<=MAX_JSON_BYTES,'ขนาดข้อมูลมากเกินไป',413)
        try:
            body = json.loads(self.rfile.read(length))
        except (ValueError,UnicodeDecodeError):
            raise APIError(400,'ข้อมูล JSON ไม่ถูกต้อง')
        require(isinstance(body,dict),'ข้อมูลต้องเป็น JSON object')
        return body

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def do_PATCH(self):
        self.handle_request()

    def do_DELETE(self):
        self.handle_request()

    def handle_request(self):
        # Request context filled in by the middleware: body, control/tenant database, session,
        # workspace member (ctx), support-page organization and visitor conversation.
        self.body, self.cd, self.db, self.session, self.ctx, self.org, self.conversation = {}, None, None, None, None, None, None
        try:
            self.connection.settimeout(30)
            parsed = urlsplit(self.path)
            self.query = parse_qs(parsed.query)
            check_host_and_origin(self)
            self.route_request(unquote(parsed.path))
        except (ConnectionError,TimeoutError):
            # The client went away (includes ConnectionAbortedError on Windows); there is nobody to answer.
            pass
        except Exception as error:
            answer = error_response(error)
            if answer is None:
                print(f'[{now()}] Server error: {type(error).__name__}',file=sys.stderr,flush=True)
                answer = (500,'ระบบไม่สามารถทำรายการได้ กรุณาลองใหม่')
            self.send(answer[0],{'error':answer[1]})

    def run(self, path, access):
        """Call the matching controller of this access level; returns False when there is none."""
        controller, params = find(ROUTES,self.command,path,access)
        if not controller:
            return False
        controller(self,*params)
        return True

    def route_request(self, path):
        if self.run(path,'page'):
            return
        if path=='/templates.json' and self.command=='GET':
            return self.send(200,template_bundle())
        if not path.startswith('/api/'):
            return self.send_static(path)
        if self.run(path,'webhook'):
            return
        # GET and DELETE carry no body; everything else must be JSON.
        self.body = self.json_body() if self.command in ('POST','PATCH') else {}
        if path.startswith('/api/public/'):
            return self.route_portal(path)
        if self.run(path,'public'):
            return
        with D.control() as cd:
            self.cd = cd
            self.session = auth.signed_in_session(self,optional=path=='/api/bootstrap')
            if self.run(path,'session'):
                return
            auth.check_csrf(self)
            if self.run(path,'account'):
                return
            if path.startswith('/api/platform'):
                auth.require_platform_admin(self)
                if not self.run(path,'platform'):
                    raise APIError(404,'ไม่พบรายการ')
                return
            self.ctx = auth.select_workspace(self)
            with D.tenant(self.ctx['tenant_id']) as db:
                self.db = db
                # For the live agent monitor: who is using the app right now.
                automation.touch_activity(db,self.ctx)
                if not self.run(path,'workspace'):
                    raise APIError(404,'ไม่พบรายการ AI' if path.startswith('/api/ai/') else 'ไม่พบรายการ')

    def route_portal(self, path):
        match = portal_routes.PORTAL_PATH.fullmatch(path)
        require(match,'ไม่พบหน้าช่วยเหลือ',404)
        limited(('public',self.client_address[0]),180 if self.command=='GET' else 30,60)
        with D.control() as cd:
            self.org = portal_service.active_organization(cd,match[1])
            with D.tenant(self.org['id']) as db:
                self.db = db
                if self.run(path,'portal'):
                    return
                self.conversation = auth.portal_visitor(self)
                if not self.run(path,'visitor'):
                    raise APIError(404,'ไม่พบรายการ')
