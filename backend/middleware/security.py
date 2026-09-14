"""Security headers on every response, and Host/Origin checks on every request."""
from backend.utils.validation import require

CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
SECURITY_HEADERS = {
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
    'X-Frame-Options':'DENY',
    'Content-Security-Policy':CONTENT_SECURITY_POLICY,
}


def check_host_and_origin(req):
    """Reject unexpected Host headers (DNS rebinding) and writes sent from another website."""
    host = req.headers.get('Host','')
    require(host and not any(c in host for c in '/\\@'),'Host ไม่ถูกต้อง',400)
    if req.server.server_address[0] in ('127.0.0.1','localhost'):
        require(host.split(':')[0] in ('localhost','127.0.0.1'),'Host ไม่ได้รับอนุญาต',403)
    if req.command!='GET':
        origin = req.headers.get('Origin')
        require(not origin or origin in ('http://'+host,'https://'+host),'ไม่อนุญาตคำขอจากเว็บไซต์อื่น',403)
