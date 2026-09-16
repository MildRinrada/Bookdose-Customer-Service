"""Organization join links and QR codes (see model.py), and what the customer's account page shows about the
organizations it belongs to.

Staff side: the organization's permanent link `{base}/?org=<code>` with its QR, and invite links `{base}/join/<token>`
an admin makes with an optional label, lifetime and number of users. Customer side: a preview of a link before
signing in, joining by it (one use per account, however often the link is opened), and องค์กรของฉัน — every
organization the account can contact and whether it has joined it."""
import secrets

from backend.database import audit, db as D
from backend.middleware import security
from backend.modules.customers import repository as accounts, service as customers
from backend.modules.org_links import repository, schema
from backend.modules.org_links.schema import LINK_GONE
from backend.modules.platform import repository as tenants, service as platform
from backend.utils import qrcode
from backend.utils.dates import now
from backend.utils.security import uid
from backend.utils.validation import require

TOKEN_BYTES = 16   # 22 characters: a join link is as public as the organization's code, but cannot be guessed
MAX_LINKS = 20     # links that still work, per organization


def base_url(cd, req):
    """Where the links point: the platform's public address when it is set (that is the one customers can reach),
    else the address this browser used (backend/middleware/security.py decides whom to believe)."""
    base = (platform.registration_config(cd).get('public_base_url') or '').strip().rstrip('/')
    if base:
        return base
    proxied = security.from_web_app(req)
    return ('https://' if req.server.secure_cookies else 'http://')+req.headers.get('X-Forwarded-Host' if proxied else 'Host','')


# The organization's links (staff)
def _gone(row):
    """Why a link cannot be used any more, or '' while it works."""
    if row['revoked_at']:
        return 'ยกเลิกแล้ว'
    if row['expires_at'] and row['expires_at']<=now():
        return 'หมดอายุแล้ว'
    if row['max_uses'] and row['uses']>=row['max_uses']:
        return 'ใช้ครบจำนวนแล้ว'
    return ''


def link_view(row, base):
    """One invite link with its URL and QR (the token is kept, so the QR can always be drawn again)."""
    url = f"{base}/join/{row['token']}"
    return {'id':row['id'],'label':row['label'],'url':url,'qr':qrcode.data_url(url,'QR ลิงก์เข้าร่วมองค์กร'),
            'created_at':row['created_at'],'expires_at':row['expires_at'],'max_uses':row['max_uses'],
            'uses':row['uses'],'revoked_at':row['revoked_at'],'gone':_gone(row)}


def links_view(cd, ctx, base):
    """The organization's permanent link with its QR, and its invite links (newest first)."""
    url = f"{base}/?org={ctx['slug']}"
    return {'org_slug':ctx['slug'],'org_url':url,'org_qr':qrcode.data_url(url,'QR องค์กร'),
            'links':[link_view(row,base) for row in repository.of_tenant(cd,ctx['tenant_id'])]}


def create(cd, db, ctx, body, base):
    """An admin makes an invite link; returns it with its QR. Links that still work are limited, so an organization
    cannot fill the table by clicking."""
    label,expires_at,max_uses = schema.link_form(body)
    require(sum(not _gone(row) for row in repository.of_tenant(cd,ctx['tenant_id']))<MAX_LINKS,
            f'มีลิงก์ที่ใช้งานได้ครบ {MAX_LINKS} ลิงก์แล้ว กรุณายกเลิกลิงก์เดิมก่อน',409)
    link_id = uid()
    repository.insert(cd,link_id,ctx['tenant_id'],secrets.token_urlsafe(TOKEN_BYTES),label,ctx['id'],expires_at,max_uses)
    cd.commit()
    audit.record(db,ctx['name'],'org_links.created',link_id,label)
    db.commit()
    return link_view(repository.find(cd,link_id),base)


def revoke(cd, db, ctx, link_id):
    """The link stops working at once; the row stays as history."""
    row = repository.find(cd,schema.link_id(link_id))
    require(row and row['tenant_id']==ctx['tenant_id'],'ไม่พบลิงก์นี้',404)
    repository.revoke(cd,row['id'])
    cd.commit()
    audit.record(db,ctx['name'],'org_links.revoked',row['id'],row['label'])
    db.commit()


# Joining by a link (customer)
def _link(cd, token):
    """(link row, its organization); 404 for an unknown token or a closed organization (the same answer either way)."""
    row = repository.find_by_token(cd,schema.token(token))
    require(row,LINK_GONE,404)
    org = tenants.find_active(cd,row['tenant_id'])
    require(org,LINK_GONE,404)
    return row,org


def preview(cd, token):
    """What the /join page shows before signing in: the organization and whether the link still works."""
    row,org = _link(cd,token)
    gone = _gone(row)
    return {'org_slug':org['slug'],'org_name':org['name'],'valid':not gone,'reason':gone}


def join(cd, session, token):
    """The signed-in customer joins the organization of the link, counting one use. Opening the link again is free
    (the account is counted once), but a link that is revoked, expired or used up opens for nobody new. The use is
    counted in its own transaction before joining, so two people cannot pass the last place at the same time."""
    row,org = _link(cd,token)
    account_id = session['account_id']
    D.begin(cd)
    row = repository.find(cd,row['id'])
    require(not _gone(row) or repository.used_by(cd,row['id'],account_id),LINK_GONE,410)
    repository.count_use(cd,row['id'],account_id)
    cd.commit()
    customers._join(cd,account_id,org)
    return {'organization':customers._org_view(org,tenants.home_organization(cd))}


# องค์กรของฉัน (customer account page)
def org_roles(cd, session):
    """{'organizations': [{slug, name, home, member}]}: every organization the customer can contact, the platform's
    own first; member is whether the account has joined it (the platform's own is open to everyone)."""
    found,home = customers._connected(cd,session)
    joined = set(accounts.org_ids(cd,session['account_id']))
    return {'organizations':[{'slug':org['slug'],'name':org['name'],'home':bool(home) and org['id']==home['id'],
                              'member':org['id'] in joined} for org in found]}
