"""HTTP handlers for LINE / Email / Facebook settings, OAuth, delivery retries, the LINE and Facebook webhooks
and temporary file links."""
from backend.exceptions.errors import APIError
from backend.middleware.auth import require_role
from backend.middleware.rate_limit import limited
from backend.modules.channels import facebook, service
from backend.utils.validation import require

MAX_WEBHOOK_BYTES = 2*1024*1024


def download_file_link(req, tenant_id, token):
    return req.send_download(*service.file_link_download(tenant_id,token))


def _raw_body(req):
    """Webhook signatures cover the exact bytes sent, so the body is read here instead of as JSON."""
    length = req.headers.get('Content-Length','')
    # ASCII digits only: isdigit() is also true of ², which int() then refuses (a 500 instead of this answer).
    require(length.isascii() and length.isdigit() and 0<int(length)<=MAX_WEBHOOK_BYTES,'ขนาด Webhook ไม่ถูกต้อง',413)
    raw = req.rfile.read(int(length))
    require(len(raw)==int(length),'Webhook ไม่ครบ',400)
    return raw


def receive_line_webhook(req, route_id):
    raw = _raw_body(req)
    try:
        service.accept_line_webhook(route_id,raw,req.headers.get('X-Line-Signature',''))
    except PermissionError:
        raise APIError(403,'ลายเซ็น Webhook ไม่ถูกต้อง') from None
    return req.send(200,{'ok':True})


def verify_facebook_webhook(req, route_id):
    """Meta calls this once when the webhook URL is saved in the app dashboard."""
    return req.send(200,facebook.verify_subscription(route_id,req.query).encode(),'text/plain; charset=utf-8')


def receive_facebook_webhook(req, route_id):
    raw = _raw_body(req)
    try:
        facebook.accept_webhook(route_id,raw,req.headers.get('X-Hub-Signature-256',''))
    except PermissionError:
        raise APIError(403,'ลายเซ็น Webhook ไม่ถูกต้อง') from None
    return req.send(200,{'ok':True})


@require_role('admin')
def facebook_overview(req):
    return req.send(200,facebook.overview(req.db,req.ctx['tenant_id']))


@require_role('admin')
def save_facebook(req):
    _limit_settings(req)
    return req.send(200,facebook.save(req.cd,req.db,req.ctx,req.body))


@require_role('admin')
def test_facebook(req):
    _limit_settings(req)
    facebook.test(req.db,req.ctx['tenant_id'])
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
