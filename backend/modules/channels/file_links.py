"""Expiring bearer links for files sent in a LINE reply (LINE downloads files from a URL)."""
import json
import secrets

from backend.database import db as D
from backend.exceptions.errors import ChannelError
from backend.modules.channels import repository
from backend.modules.conversations import repository as conversations
from backend.modules.platform import repository as tenants
from backend.utils.dates import after
from backend.utils.security import token_hash

LINK_DAYS = 7
PREVIEW_IMAGE_LIMIT = 1024*1024  # LINE preview images are capped at 1 MB; larger images are sent as links.


def prepare(db, conv, mid, cfg, job_id):
    """Build the LINE messages for a reply with files and store them for the outbox."""
    files = conversations.attachment_records(db,mid)
    if not files:
        return
    body = conversations.find_message(db,mid)['body']
    messages = [{'type':'text','text':body}] if body else []
    expires = after(days=LINK_DAYS)
    for file in files:
        token = secrets.token_urlsafe(32)
        repository.insert_file_link(db,token_hash(token),file['id'],mid,expires)
        url = cfg['public_base_url']+'/api/channel-files/'+cfg['_tenant_id']+'/'+token
        if file['mime'] in ('image/jpeg','image/png') and file['size']<=PREVIEW_IMAGE_LIMIT:
            messages.append({'type':'image','originalContentUrl':url,'previewImageUrl':url})
        else:
            messages.append({'type':'text','text':file['name']+' (ลิงก์หมดอายุใน 7 วัน)\n'+url})
    if not messages:
        raise ChannelError('rejected')
    repository.insert_outbox_payload(db,job_id,json.dumps(messages,ensure_ascii=False))


def resolve(cd, tenant_id, token):
    if not tenants.is_active(cd,tenant_id):
        return None
    with D.tenant(tenant_id) as db:
        return repository.file_for_link(db,token_hash(token))


def valid(db, mid):
    return not repository.has_unusable_file_links(db,mid)


def revoke(db, mid):
    repository.revoke_file_links(db,mid)
