"""LINE / Email settings, webhook and reply validation."""
import ipaddress
import json
import re
from urllib.parse import urlsplit

from backend.exceptions.errors import APIError, ChannelError
from backend.extensions import channel_transport as T
from backend.utils.validation import require

HOST_NAME = re.compile(r'[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?')
LINE_TEXT_LIMIT = 5000


def text_field(body, key, default='', maximum=250):
    value = body.get(key,default)
    require(isinstance(value,str) and len(value)<=maximum and not any(ord(c)<32 for c in value),f'ข้อมูล {key} ไม่ถูกต้อง')
    return value.strip()


def enabled_flag(body, current):
    enabled = body.get('enabled',current)
    require(type(enabled) is bool,'สถานะช่องทางไม่ถูกต้อง')
    return enabled


def remove_credentials(body, enabled):
    remove = body.get('remove_credentials',False)
    require(type(remove) is bool and not (remove and enabled),'ปิดช่องทางก่อนลบข้อมูลเชื่อมต่อ')
    return remove


CREDENTIAL_KEYS = {'line':('channel_secret','access_token'),'facebook':('page_access_token','app_secret'),'email':('password',)}


def credentials(body, kind, secret):
    """Copy newly typed credentials into `secret`; empty fields keep the saved value."""
    for key in CREDENTIAL_KEYS[kind]:
        value = body.get(key,'')
        require(isinstance(value,str) and len(value)<=2000 and not any(ord(c)<32 for c in value),f'ข้อมูล {key} ไม่ถูกต้อง')
        if value:
            secret[key] = value


def email_account(body, cfg):
    """Mailbox address and login name into `cfg`."""
    address = text_field(body,'address',cfg.get('address',''))
    try:
        cfg['address'] = T.email_address(address)
    except ChannelError:
        raise APIError(400,'กรุณาระบุอีเมลของช่องทางให้ถูกต้อง') from None
    cfg['username'] = text_field(body,'username',cfg.get('username',cfg['address'])) or cfg['address']


def email_servers(body, cfg, fixed_by_provider):
    """IMAP/SMTP servers, SMTP port and polling interval into `cfg`. Google/Microsoft OAuth fixes the servers."""
    for key in ('imap_host','smtp_host'):
        value = cfg[key] if fixed_by_provider else text_field(body,key,cfg.get(key,''))
        require(HOST_NAME.fullmatch(value),'กรุณาระบุชื่อเซิร์ฟเวอร์ IMAP และ SMTP โดยไม่ใส่ https://')
        cfg[key] = value.lower()
    port = cfg['smtp_port'] if fixed_by_provider else body.get('smtp_port',cfg.get('smtp_port',465))
    require(type(port) is int and port in (465,587),'SMTP รองรับ 465 (TLS) หรือ 587 (STARTTLS)')
    cfg['smtp_port'] = port
    interval = body.get('poll_seconds',cfg.get('poll_seconds',60))
    require(type(interval) is int and 30<=interval<=600,'รอบรับอีเมลต้องอยู่ระหว่าง 30-600 วินาที')
    cfg['poll_seconds'] = interval
    cfg['identity'] = cfg['address']


def line_options(body, cfg):
    """Group options and the public HTTPS address used for file links into `cfg`."""
    for key in ('groups_enabled','group_chatbot_enabled'):
        value = body.get(key,cfg.get(key,False))
        require(type(value) is bool,'สถานะกลุ่มไม่ถูกต้อง')
        cfg[key] = value
    cfg['public_base_url'] = public_origin(text_field(body,'public_base_url',cfg.get('public_base_url',''),500))


def chatbot_flag(body, cfg):
    bot = body.get('chatbot_enabled',cfg.get('chatbot_enabled',False))
    require(type(bot) is bool,'สถานะ Chatbot ไม่ถูกต้อง')
    return bot


def public_origin(value):
    """An empty value, or a public https://host with no path (LINE downloads files from it)."""
    parsed = urlsplit(value)
    require(not value or (parsed.scheme=='https' and parsed.hostname and not parsed.username and not parsed.password and parsed.path in ('','/') and not parsed.query and not parsed.fragment),'URL ไฟล์ต้องเป็นโดเมน HTTPS สาธารณะ ไม่ใส่พาธ')
    if value:
        require(parsed.hostname not in ('localhost','localhost.localdomain') and '.' in parsed.hostname,'กรุณาใช้โดเมนสาธารณะสำหรับไฟล์')
        try:
            address = ipaddress.ip_address(parsed.hostname)
        except ValueError:
            address = None
        require(not address or address.is_global,'ห้ามใช้ที่อยู่เครือข่ายภายในสำหรับไฟล์')
    return value.rstrip('/')


def line_webhook_events(raw, identity):
    """The events of a LINE webhook addressed to the connected bot."""
    try:
        data = json.loads(raw)
    except (ValueError,UnicodeError):
        raise APIError(400,'Webhook JSON ไม่ถูกต้อง') from None
    require(isinstance(data,dict) and data.get('destination')==identity,'Webhook ไม่ตรงกับบัญชี LINE ที่เชื่อมไว้')
    events = data.get('events')
    require(isinstance(events,list) and len(events)<=100,'Webhook events ไม่ถูกต้อง')
    for event in events:
        require(isinstance(event,dict) and isinstance(event.get('webhookEventId'),str) and 1<=len(event['webhookEventId'])<=100,'Webhook event ID ไม่ถูกต้อง')
    return events


def facebook_events(raw, page_id):
    """The messaging events of a Page webhook addressed to the connected Page; entries for other Pages are ignored."""
    try:
        data = json.loads(raw)
    except (ValueError,UnicodeError):
        raise APIError(400,'Webhook JSON ไม่ถูกต้อง') from None
    require(isinstance(data,dict) and data.get('object')=='page','Webhook ไม่ใช่เหตุการณ์ของเพจ Facebook')
    entries = data.get('entry')
    require(isinstance(entries,list) and len(entries)<=100,'Webhook entry ไม่ถูกต้อง')
    events = []
    for entry in entries:
        if isinstance(entry,dict) and page_id and str(entry.get('id'))==page_id and isinstance(entry.get('messaging'),list):
            events.extend(event for event in entry['messaging'][:100] if isinstance(event,dict))
    return events


def line_text_length(text):
    """LINE counts UTF-16 code units."""
    return len(text.encode('utf-16-le'))//2


def line_reply(body, cfg):
    text = body.get('body','')
    require(isinstance(text,str) and (text.strip() or body.get('attachments')) and line_text_length(text)<=LINE_TEXT_LIMIT,'LINE ส่งข้อความยาวไม่เกิน 5,000 หน่วยอักขระ หรือแนบไฟล์')
    require(not body.get('attachments') or cfg.get('public_base_url'),'ตั้งค่าโดเมน HTTPS สำหรับไฟล์ในช่องทาง LINE ก่อนส่งไฟล์')


def delivery_view(outbox, error_message, retryable, has_file_links):
    return {'error':error_message,'retryable':retryable,'attempts':outbox['attempts'],'has_file_links':has_file_links}
