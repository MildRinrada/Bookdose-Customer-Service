"""Expiring bearer links only for files explicitly sent in a LINE reply."""
import datetime as dt
import ipaddress
import secrets
from urllib.parse import urlsplit
import database as D
import channel_transport as T


def public_origin(value):
    from channel_service import check
    parsed=urlsplit(value)
    check(not value or (parsed.scheme=='https' and parsed.hostname and not parsed.username and not parsed.password and parsed.path in ('','/') and not parsed.query and not parsed.fragment),'URL ไฟล์ต้องเป็นโดเมน HTTPS สาธารณะ ไม่ใส่พาธ')
    if value:
        check(parsed.hostname not in ('localhost','localhost.localdomain') and '.' in parsed.hostname,'กรุณาใช้โดเมนสาธารณะสำหรับไฟล์')
        try:address=ipaddress.ip_address(parsed.hostname)
        except ValueError:address=None
        check(not address or address.is_global,'ห้ามใช้ที่อยู่เครือข่ายภายในสำหรับไฟล์')
    return value.rstrip('/')


def prepare(db,conv,mid,cfg,job_id):
    files=D.rows(db,'SELECT * FROM attachments WHERE message_id=?',(mid,))
    if not files:return
    body=D.one(db,'SELECT body FROM messages WHERE id=?',(mid,))['body']
    messages=[{'type':'text','text':body}] if body else []
    expires=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=7)).isoformat(timespec='seconds')
    for file in files:
        token=secrets.token_urlsafe(32)
        db.execute('INSERT INTO channel_file_links VALUES(?,?,?,?,0)',(D.token_hash(token),file['id'],mid,expires))
        url=cfg['public_base_url']+'/api/channel-files/'+cfg['_tenant_id']+'/'+token
        # LINE preview images are capped at 1 MB. Larger images use the download link.
        if file['mime'] in ('image/jpeg','image/png') and file['size']<=1024*1024:
            messages.append({'type':'image','originalContentUrl':url,'previewImageUrl':url})
        else:messages.append({'type':'text','text':file['name']+' (ลิงก์หมดอายุใน 7 วัน)\n'+url})
    if not messages:raise T.ChannelError('rejected')
    import json
    db.execute('INSERT INTO channel_outbox_payload VALUES(?,?)',(job_id,json.dumps(messages,ensure_ascii=False)))


def resolve(cd,tenant_id,token):
    if not D.one(cd,"SELECT 1 FROM tenants WHERE id=? AND status='active'",(tenant_id,)):return None
    with D.tenant(tenant_id) as db:
        row=D.one(db,"""SELECT a.* FROM channel_file_links l JOIN attachments a ON a.id=l.attachment_id
            JOIN messages m ON m.id=l.message_id JOIN channel_outbox o ON o.message_id=m.id
            WHERE l.token_hash=? AND l.revoked=0 AND l.expires_at>? AND m.kind='reply'
            AND o.kind='line' AND o.status IN ('sending','accepted','unknown')""",(D.token_hash(token),D.now()))
        return row


def valid(db,mid):return not D.one(db,'SELECT 1 FROM channel_file_links WHERE message_id=? AND (revoked=1 OR expires_at<=?)',(mid,D.now()))


def revoke(db,mid):db.execute('UPDATE channel_file_links SET revoked=1 WHERE message_id=?',(mid,))
