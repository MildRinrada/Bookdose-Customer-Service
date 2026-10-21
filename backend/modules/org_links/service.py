"""Two things about an organization's links that outlived the join links: where a link the server writes points
(base_url, for the chat link, QR codes and mail), and องค์กรของฉัน, every organization the customer's account can
contact and whether it has joined it."""
from backend.middleware import security
from backend.modules.customers import repository as accounts, service as customers
from backend.modules.platform import service as platform
from backend.utils import qrcode


def base_url(cd, req):
    """Where the links point: the platform's public address when it is set (that is the one customers can reach),
    else the address this browser used (backend/middleware/security.py decides whom to believe)."""
    base = (platform.registration_config(cd).get('public_base_url') or '').strip().rstrip('/')
    if base:
        return base
    proxied = security.from_web_app(req)
    return ('https://' if req.server.secure_cookies else 'http://')+req.headers.get('X-Forwarded-Host' if proxied else 'Host','')


def support_link(cd, ctx, req):
    """หน้าลูกค้า: the organization's page for customers, with its QR to print or put on a poster."""
    url = f"{base_url(cd,req)}/support/{ctx['slug']}"
    return {'url':url,'qr':qrcode.data_url(url,'QR หน้าลูกค้า')}


def org_roles(cd, session):
    """{'organizations': [{slug, name, home, member}]}: every organization the customer can contact, the platform's
    own first; member is whether the account has joined it (the platform's own is open to everyone)."""
    found,home = customers._connected(cd,session)
    joined = set(accounts.org_ids(cd,session['account_id']))
    return {'organizations':[{'slug':org['slug'],'name':org['name'],'home':bool(home) and org['id']==home['id'],
                              'member':org['id'] in joined} for org in found]}
