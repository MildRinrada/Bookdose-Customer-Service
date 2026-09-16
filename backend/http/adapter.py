"""The request object for the ASGI server: an Exchange built from an ASGI scope that collects the answer instead of
writing it to a socket. dispatch() runs in a worker thread; the body is read from the event loop only when a
controller asks for it (JSON body or a webhook's raw bytes), so size and type checks come first, as before."""
import anyio
import anyio.from_thread

from backend.http.dispatch import Exchange

# How long a request body may take to arrive, like the old server's 30-second socket timeout.
BODY_TIMEOUT = 30


class BodyReader:
    """rfile for the ASGI request: read(n) returns up to n bytes, fewer when the body ends or the client leaves."""

    def __init__(self, receive):
        self._receive, self._buffer, self._done = receive, bytearray(), False

    def read(self, size=-1):
        return anyio.from_thread.run(self._read,size)

    async def _read(self, size):
        with anyio.fail_after(BODY_TIMEOUT):
            while not self._done and (size<0 or len(self._buffer)<size):
                message = await self._receive()
                if message['type']=='http.request':
                    self._buffer += message.get('body',b'')
                    self._done = not message.get('more_body',False)
                else:
                    # http.disconnect: what arrived is all there is (a short read, as on a closed socket).
                    self._done = True
        size = len(self._buffer) if size<0 else size
        data = bytes(self._buffer[:size])
        del self._buffer[:size]
        return data


class Headers:
    """Request headers with the lookups controllers use: case-insensitive get() and `in`, first value wins.
    Values are decoded as ISO-8859-1, as http.server does."""

    def __init__(self, raw):
        self._items = [(key.decode('latin-1').lower(),value.decode('latin-1')) for key,value in raw]

    def get(self, name, default=None):
        name = name.lower()
        return next((value for key,value in self._items if key==name),default)

    def __contains__(self, name):
        name = name.lower()
        return any(key==name for key,_ in self._items)


class RequestAdapter(Exchange):
    """One ASGI request. After dispatch(), `response` is (status, [(header, value) as bytes], body) or None when no
    answer was produced (the client went away)."""

    def __init__(self, scope, receive, server):
        self.command = scope['method']
        target = scope.get('raw_path') or scope['path'].encode('latin-1')
        target = target.decode('latin-1')
        # http.server reduces a leading '//' to '/' (it would otherwise read as a host name).
        if target.startswith('//'):
            target = '/'+target.lstrip('/')
        query = scope.get('query_string') or b''
        self.path = target+('?'+query.decode('latin-1') if query else '')
        self.headers = Headers(scope.get('headers') or [])
        client = scope.get('client')
        self.client_address = (client[0],client[1]) if client else ('',0)
        self.server = server
        self.rfile = BodyReader(receive)
        self.response = None

    def write_response(self, status, fields, body):
        # Encoded here, as http.server does while sending, so a header that cannot be sent is a server error.
        raw = [(key.lower().encode('latin-1'),str(value).encode('latin-1')) for key,value in fields]
        # The first answer stands, as on a socket where a later one could not replace what the client already read.
        if self.response is None:
            self.response = (status,raw,body)
