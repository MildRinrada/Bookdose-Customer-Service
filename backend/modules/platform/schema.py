"""Organization and registration-email form validation."""
import base64
import re
from pathlib import Path
from urllib.parse import urlsplit

from backend.exceptions.errors import APIError
from backend.modules.platform.model import GLOBAL_AUDIENCES, REPORT_MAX, REPORT_STATUSES, TENANT_STATUSES
from backend.utils.files import matches_file_type
from backend.utils.validation import require, field, email_field, slug_field, new_password

# Pictures of what went wrong, sent with a problem report: screenshots, so images only, few and small enough that a
# report is a report and not a file store (the JSON body itself is capped at 8 MB, base64 adds a third).
REPORT_IMAGES = 5
REPORT_IMAGE_BYTES = 5*1024*1024
REPORT_IMAGE_TYPES = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'}


def tenant_form(body):
    """(name, slug)"""
    return field(body,'name',100),slug_field(body)


def admin_email(body):
    return email_field(body)


def new_admin(body):
    """(name, password hash) for an admin who has no account yet."""
    return field(body,'admin_name',100),new_password(body)


def tenant_status(body):
    status = body.get('status')
    require(status in TENANT_STATUSES,'สถานะไม่ถูกต้อง')
    return status


def suspension_confirmed(body, org):
    require(body.get('confirmation') in ('CONFIRM',org['name']),'กรุณาพิมพ์ CONFIRM หรือชื่อองค์กรเพื่อยืนยันการระงับ')


def global_article(body):
    """(title, category, body, audience) of a global FAQ article."""
    audience = body.get('audience')
    require(audience in GLOBAL_AUDIENCES,'กรุณาเลือกผู้อ่านบทความ')
    return field(body,'title',200),field(body,'category',80),field(body,'body',50000),audience


def article_template(body):
    """(title, category, body) of a ready-made answer in the template library."""
    return field(body,'title',200),field(body,'category',80),field(body,'body',50000)


def tenant_feature(body):
    """(feature key, on) from the console's switch. An unknown key is refused, so a typo never becomes a setting
    that quietly does nothing."""
    from backend.modules.platform.model import FEATURES
    feature,enabled = body.get('feature'),body.get('enabled')
    require(feature in FEATURES,'ไม่รู้จักฟีเจอร์นี้')
    require(enabled is True or enabled is False,'ค่าเปิด/ปิดไม่ถูกต้อง')
    return feature,enabled


def tenant_quota(body):
    """How many MB of the shared disk this organization may take; 0 removes the ceiling."""
    from backend.modules.platform.model import NO_QUOTA, QUOTA_BOUNDS
    value = body.get('quota_mb')
    low,high = QUOTA_BOUNDS
    require(type(value) is int and (value==NO_QUOTA or low<=value<=high),
            f'โควตาต้องอยู่ระหว่าง {low} MB ถึง {high//1024} GB หรือ 0 เพื่อไม่จำกัด')
    return value


def problem_report(body):
    """(message, page, images) of a report sent from the ? in the top bar. The page is whatever address the reporter
    was on, kept short and free of control characters; it is a hint for reproducing, not something to trust. images:
    [(name, mime, bytes)], each one's content checked against its type, not only its name."""
    page = body.get('page','')
    require(isinstance(page,str) and len(page)<=300 and not any(ord(c)<32 for c in page),'หน้าที่แจ้งไม่ถูกต้อง')
    return field(body,'message',REPORT_MAX),page.strip(),report_images(body.get('images',[]))


def report_images(uploads):
    require(isinstance(uploads,list) and len(uploads)<=REPORT_IMAGES,f'แนบรูปได้สูงสุด {REPORT_IMAGES} รูป')
    found,total = [],0
    for item in uploads:
        require(isinstance(item,dict) and isinstance(item.get('data'),str),'รูปที่แนบไม่ถูกต้อง')
        name = field(item,'name',150)
        require('/' not in name and '\\' not in name and not any(ord(c)<32 for c in name),'ชื่อไฟล์ไม่ถูกต้อง')
        mime = REPORT_IMAGE_TYPES.get(Path(name).suffix.lower())
        require(mime,'แนบได้เฉพาะรูป PNG, JPG, GIF หรือ WebP')
        try:
            content = base64.b64decode(item['data'],validate=True)
        except (ValueError,TypeError):
            raise APIError(400,'รูปที่แนบไม่ถูกต้อง')
        total += len(content)
        require(content and total<=REPORT_IMAGE_BYTES,'รูปทั้งหมดรวมกันต้องไม่เกิน 5 MB')
        require(matches_file_type(Path(name).suffix.lower()[1:],content),f'“{name}” ไม่ใช่ไฟล์รูปจริง')
        found.append((name,mime,content))
    return found


def report_status(body):
    status = body.get('status')
    require(status in REPORT_STATUSES,'สถานะไม่ถูกต้อง')
    return status


def registration_mail(body):
    """(settings, new SMTP password or '') from the platform admin's form."""
    # Two separate switches: the system's mailbox works, and the sign-up page is open to anyone.
    cfg = {'enabled':body.get('enabled') is True,'signup_enabled':body.get('signup_enabled') is True}
    for key in ('smtp_host','username','address','public_base_url'):
        value = body.get(key,'')
        require(isinstance(value,str) and len(value)<=500 and not any(ord(c)<32 for c in value), 'ข้อมูลการส่งอีเมลไม่ถูกต้อง')
        cfg[key] = value.strip()
    port = body.get('smtp_port',465)
    require(type(port) is int and port in (465,587), 'SMTP รองรับพอร์ต 465 หรือ 587')
    cfg['smtp_port'] = port
    password = body.get('password','')
    require(isinstance(password,str) and len(password)<=2000, 'รหัสผ่าน SMTP ไม่ถูกต้อง')
    return cfg,password


def check_enabled_registration_mail(cfg, secret):
    """Everything needed to send verification mail must be present; normalizes the site URL."""
    require(re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?',cfg['smtp_host']), 'กรุณาระบุชื่อเซิร์ฟเวอร์ SMTP')
    require(cfg['username'] and secret.get('password'), 'กรุณาระบุชื่อผู้ใช้และรหัสผ่าน SMTP / App Password')
    require(re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+',cfg['address']), 'กรุณาระบุอีเมลผู้ส่งให้ถูกต้อง')
    try:
        url = urlsplit(cfg['public_base_url'])
        url.port
    except ValueError:
        raise APIError(400,'โดเมนเว็บไซต์ไม่ถูกต้อง') from None
    local = url.hostname in ('localhost','127.0.0.1')
    require(url.hostname and (url.scheme=='https' or (local and url.scheme=='http'))
            and not url.username and not url.password and not url.query and not url.fragment
            and url.path in ('','/') and not any(c in cfg['public_base_url'] for c in '\\<> "'),
            'ใช้โดเมน HTTPS โดยไม่มี path เช่น https://support.example.com (localhost ใช้ HTTP ได้)')
    cfg['public_base_url'] = cfg['public_base_url'].rstrip('/')
