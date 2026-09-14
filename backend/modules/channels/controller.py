"""HTTP handlers for LINE / Email settings, OAuth, delivery retries, the LINE webhook and temporary file links."""
from config import settings
from backend.exceptions.errors import APIError
from backend.middleware.auth import require_role
from backend.middleware.rate_limit import limited
from backend.modules.channels import service
from backend.utils.validation import require

MAX_WEBHOOK_BYTES = 2*1024*1024


def oauth_callback_page(req):
    """The provider sends the admin back here; the page finishes the connection with the browser's session."""
    return req.send(200,(settings.PUBLIC_DIR/'oauth-callback.html').read_bytes(),'text/html; charset=utf-8')


def download_file_link(req, tenant_id, token):
    return req.send_download(*service.file_link_download(tenant_id,token))


def receive_line_webhook(req, route_id):
    """The raw body is needed to check LINE's signature, so it is read here instead of as JSON."""
    length = req.headers.get('Content-Length','')
    require(length.isdigit() and 0<int(length)<=MAX_WEBHOOK_BYTES,'ขนาด Webhook ไม่ถูกต้อง',413)
    raw = req.rfile.read(int(length))
    require(len(raw)==int(length),'Webhook ไม่ครบ',400)
    try:
        service.accept_line_webhook(route_id,raw,req.headers.get('X-Line-Signature',''))
    except PermissionError:
        raise APIError(403,'ลายเซ็น Webhook ไม่ถูกต้อง') from None
    return req.send(200,{'ok':True})


def _limit_oauth(req):
    limited(('email-oauth',req.ctx['tenant_id'],req.ctx['id']),10,60)


def _limit_settings(req):
    limited(('channel-config',req.ctx['tenant_id']),20,60)


@require_role('admin')
def start_email_oauth(req):
    _limit_oauth(req)
    return req.send(200,service.start_email_oauth(req.db,req.ctx,'https://'+req.headers.get('Host','')))


@require_role('admin')
def complete_email_oauth(req):
    _limit_oauth(req)
    return req.send(200,service.complete_email_oauth(req.cd,req.db,req.ctx,req.body))


@require_role('admin')
def overview(req):
    return req.send(200,service.overview(req.db,req.ctx['tenant_id']))


@require_role('admin')
def save_channel(req, kind):
    _limit_settings(req)
    return req.send(200,service.save_channel(req.cd,req.db,req.ctx,kind,req.body))


@require_role('admin')
def test_channel(req, kind):
    _limit_settings(req)
    service.test_channel(req.db,req.ctx['tenant_id'],kind)
    return req.send(200,{'ok':True})


@require_role('admin')
def sync_email(req):
    _limit_settings(req)
    service.request_email_sync(req.db)
    return req.send(200,{'ok':True})


def retry_delivery(req, message_id):
    service.retry_failed_delivery(req.db,req.ctx,message_id)
    return req.send(200,{'ok':True})


def revoke_files(req, message_id):
    service.revoke_message_files(req.db,req.ctx,message_id)
    return req.send(200,{'ok':True})
