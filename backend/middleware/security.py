"""Security headers on every response, and Host/Origin checks on every request.

The Next.js web app (frontend/) forwards the browser's /api/* requests here. It names the browser's host in
X-Forwarded-Host and, when it knows it, the browser's address in X-Bookdose-Client-IP. Both are believed only from
the web app: a request from this machine while no proxy secret is set, otherwise one carrying the secret
(BOOKDOSE_PROXY_SECRET, the same value in the web app's environment)."""
import hmac
import ipaddress

from config import settings
from backend.utils.validation import require

CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
SECURITY_HEADERS = {
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
    'X-Frame-Options':'DENY',
    'Content-Security-Policy':CONTENT_SECURITY_POLICY,
}
LOOPBACK = ('127.0.0.1','::1')


def from_web_app(req):
    """True when the request came through the Next.js web app."""
    if 'X-Forwarded-Host' not in req.headers:
        return False
    secret = settings.proxy_secret()
    if secret:
        return hmac.compare_digest(req.headers.get('X-Bookdose-Proxy',''),secret)
    return req.client_address[0] in LOOPBACK


def client_ip(req, proxied):
    """The address rate limits and signatures are recorded against: the browser's, when the web app vouches for it."""
    if proxied:
        try:
            return str(ipaddress.ip_address(req.headers.get('X-Bookdose-Client-IP','').strip()))
        except ValueError:
            pass
    return req.client_address[0]


def check_host_and_origin(req):
    """Reject unexpected Host headers (DNS rebinding) and writes sent from another website; returns the client address."""
    proxied = from_web_app(req)
    host = req.headers.get('X-Forwarded-Host' if proxied else 'Host','')
    require(host and not any(c in host for c in '/\\@'),'Host ไม่ถูกต้อง',400)
    # A copy listening only on this machine answers only to localhost, directly or through a local web app. A web app
    # holding the proxy secret is public, and the host the browser used is its own.
    if req.server.server_address[0] in ('127.0.0.1','localhost') and not (proxied and settings.proxy_secret()):
        require(host.split(':')[0] in ('localhost','127.0.0.1'),'Host ไม่ได้รับอนุญาต',403)
    if req.command!='GET':
        origin = req.headers.get('Origin')
        require(not origin or origin in ('http://'+host,'https://'+host),'ไม่อนุญาตคำขอจากเว็บไซต์อื่น',403)
    return client_ip(req,proxied)
