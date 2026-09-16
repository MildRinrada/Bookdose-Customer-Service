"""The old HTTP server (Python's http.server), kept for one release as a rollback: `BOOKDOSE_SERVER=legacy python
app.py`. It answers through the same dispatch layer as the default FastAPI server (backend/asgi.py), so both run the
same route table, middleware and messages; see backend/http/dispatch.py for the access levels."""
from http.server import BaseHTTPRequestHandler

from backend.http.dispatch import MAX_JSON_BYTES, ROUTES, Exchange, dispatch, log_request

__all__ = ['Handler','MAX_JSON_BYTES','ROUTES']


class Handler(Exchange, BaseHTTPRequestHandler):
    server_version = 'Bookdose/1.0'

    def log_message(self, fmt, *args):
        # Omit request paths, which can contain user-entered search terms.
        if args and isinstance(args[0], str) and args[0].startswith(('GET ','POST ','PATCH ','DELETE ')):
            log_request(self.command,args[1] if len(args)>1 else '')

    def write_response(self, status, fields, body):
        self.send_response(status)
        for key,value in fields:
            self.send_header(key,value)
        self.end_headers()
        self.wfile.write(body)

    def handle_request(self):
        try:
            self.connection.settimeout(30)
        except OSError:
            return
        dispatch(self)

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def do_PATCH(self):
        self.handle_request()

    def do_DELETE(self):
        self.handle_request()
