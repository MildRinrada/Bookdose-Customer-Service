"""Organization and registration-email form validation."""
import re
from urllib.parse import urlsplit

from backend.exceptions.errors import APIError
from backend.modules.platform.model import GLOBAL_AUDIENCES, REPORT_MAX, REPORT_STATUSES, TENANT_STATUSES
from backend.utils.validation import require, field, email_field, slug_field, new_password


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


def tenant_quota(body):
    """How many MB of the shared disk this organization may take; 0 removes the ceiling."""
    from backend.modules.platform.model import NO_QUOTA, QUOTA_BOUNDS
    value = body.get('quota_mb')
    low,high = QUOTA_BOUNDS
    require(type(value) is int and (value==NO_QUOTA or low<=value<=high),
            f'โควตาต้องอยู่ระหว่าง {low} MB ถึง {high//1024} GB หรือ 0 เพื่อไม่จำกัด')
    return value


def problem_report(body):
    """(message, page) of a report sent from the ? in the top bar. The page is whatever address the reporter was on,
    kept short and free of control characters; it is a hint for reproducing, not something to trust."""
    page = body.get('page','')
    require(isinstance(page,str) and len(page)<=300 and not any(ord(c)<32 for c in page),'หน้าที่แจ้งไม่ถูกต้อง')
    return field(body,'message',REPORT_MAX),page.strip()


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
