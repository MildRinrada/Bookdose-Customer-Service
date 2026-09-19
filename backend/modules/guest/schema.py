"""Guest web chat forms (start a chat, a name, a follow link, a resume token, settings) and what is shown back."""
import re
import time
from urllib.parse import urlsplit

from backend.modules.guest.model import GUEST_NAME, MAX_ORIGINS, MIN_FORM_MS, POSITIONS, THEMES
from backend.utils.validation import email_field, field, person_name, require

TOKEN = re.compile(r'[A-Za-z0-9_-]{43}')
HOST = re.compile(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*')
SPAM = 'ส่งข้อความไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
LINK_GONE = 'ลิงก์หมดอายุ ขอลิงก์ใหม่จากแชทเดิม หรือเริ่มแชทใหม่'


def start_form(body):
    """(name, remember) of a new chat, after the spam checks: the hidden 'website' field (or 'company_website') must stay empty and the form
    must have been open at least 2 seconds (started_ms: when it was shown, in milliseconds since 1970). A clock
    clearly ahead of the server's cannot be judged and passes."""
    hidden = (body.get('website',''),body.get('company_website',''))
    started = body.get('started_ms')
    require(all(value in ('',None) for value in hidden) and type(started) in (int,float),SPAM)
    elapsed = time.time()*1000-started
    require(elapsed>=MIN_FORM_MS or elapsed<-60000,SPAM)
    remember = body.get('remember',True)
    require(isinstance(remember,bool),'ข้อมูลการจำแชทไม่ถูกต้อง')
    return person_name(body,'name',False),remember


def reach_form(body, email_ready, sms_ready):
    """(email, phone, reference) of a new chat, each optional: where to send the follow link (the email address, the
    phone number as E.164; only the ways the platform can send) and a reference the customer gives the team."""
    email = body.get('email') or ''
    phone = body.get('phone') or ''
    require(isinstance(email,str) and isinstance(phone,str),'ข้อมูลช่องทางติดต่อไม่ถูกต้อง')
    if email.strip():
        require(email_ready,'ยังส่งลิงก์ทางอีเมลไม่ได้ กรุณาเว้นช่องอีเมลไว้',409)
        email = email_field({'email':email})
    if phone.strip():
        require(sms_ready,'ยังส่งลิงก์ทาง SMS ไม่ได้ กรุณาเว้นช่องเบอร์โทรไว้',409)
        phone = phone_e164(phone)
    reference = field(body,'reference',60,False) if body.get('reference') else ''
    require(not reference or reference.isprintable(),'เลขอ้างอิงมีตัวอักษรที่ใช้ไม่ได้')
    return email.strip() and email,phone.strip() and phone,reference


def request_body(body, text):
    """The body for the shared start of a chat: a guest may leave the subject out, it then comes from the message."""
    subject = body.get('subject')
    if subject is None or (isinstance(subject,str) and not subject.strip()):
        first = ' '.join(text.split())[:80] if isinstance(text,str) else ''
        return {**body,'subject':first or 'แชทจากเว็บไซต์'}
    return body


def name_form(body):
    name = person_name(body,'name',False)
    return name


def remember_form(body):
    value = body.get('remember')
    require(isinstance(value,bool),'ข้อมูลการจำแชทไม่ถูกต้อง')
    return value


def phone_e164(value):
    """A phone number as E.164: Thai numbers written 08x-xxx-xxxx / 02-xxx-xxxx / 66... become +66...; others must
    start with + and their country code."""
    require(isinstance(value,str) and len(value)<=30,'กรุณาระบุเบอร์โทรศัพท์ เช่น 081-234-5678')
    compact = re.sub(r'[\s().-]','',value.strip())
    if compact.startswith('+'):
        digits = compact[1:]
    elif compact.startswith('00'):
        digits = compact[2:]
    elif compact.startswith('0'):
        digits = '66'+compact[1:]
    elif compact.startswith('66'):
        digits = compact
    else:
        digits = ''
    require(digits.isdigit() and 8<=len(digits)<=15 and digits[0]!='0','กรุณาระบุเบอร์โทรศัพท์ เช่น 081-234-5678')
    if digits.startswith('66'):
        require(len(digits) in (10,11) and digits[2]!='0','กรุณาระบุเบอร์โทรศัพท์ในประเทศไทยให้ถูกต้อง เช่น 081-234-5678')
    return '+'+digits


def link_form(body):
    """(via, target): an email address, or a phone number as E.164."""
    via = body.get('via')
    require(via in ('email','sms'),'เลือกส่งลิงก์ทางอีเมลหรือ SMS')
    if via=='email':
        return via,email_field({'email':body.get('to','')})
    return via,phone_e164(body.get('to',''))


def token(body):
    value = body.get('token','')
    require(isinstance(value,str) and TOKEN.fullmatch(value),LINK_GONE)
    return value


def claim_org(body):
    value = body.get('org','')
    require(isinstance(value,str) and re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*',value.strip().lower()),'ไม่พบองค์กรนี้',404)
    return value.strip().lower()


def mask_email(email):
    if not email or '@' not in email:
        return ''
    local,domain = email.split('@',1)
    return f'{local[0]}***@{domain}'


def mask_phone(phone):
    if not phone:
        return ''
    return phone[:3]+'*'*max(len(phone)-7,2)+phone[-4:]


def mask(via, target):
    return mask_email(target) if via=='email' else mask_phone(target) if via=='sms' else ''


def display_name(visitor):
    return (visitor or {}).get('name') or GUEST_NAME


# Settings
def origin(value):
    """https://host[:port] (or http://localhost / 127.0.0.1 for testing), lowercase and without a trailing slash."""
    require(isinstance(value,str) and len(value)<=200,'เว็บไซต์ที่อนุญาตต้องเป็น https://โดเมน เช่น https://www.example.com')
    text = value.strip().rstrip('/').lower()
    try:
        parsed = urlsplit(text)
        port = parsed.port
    except ValueError:
        parsed,port = None,None
    local = bool(parsed) and parsed.hostname in ('localhost','127.0.0.1')
    require(parsed and (parsed.scheme=='https' or (parsed.scheme=='http' and local)) and parsed.hostname and HOST.fullmatch(parsed.hostname)
            and not parsed.username and not parsed.password and parsed.path=='' and not parsed.query and not parsed.fragment
            and '@' not in text and (port is None or 0<port<65536),
            'เว็บไซต์ที่อนุญาตต้องเป็น https://โดเมน เช่น https://www.example.com (ทดสอบบน http://localhost ได้)')
    return f'{parsed.scheme}://{parsed.hostname}'+(f':{port}' if port else '')


def settings_form(body, current_guest, current_widget):
    """(guest_chat, widget) merged from {guest_chat: {enabled}, widget: {enabled, origins, position, theme, title}};
    a part left out stays as it is."""
    guest_chat,widget = dict(current_guest),dict(current_widget)
    given = body.get('guest_chat',{})
    require(isinstance(given,dict),'ข้อมูลแชทบนเว็บไซต์ไม่ถูกต้อง')
    if 'enabled' in given:
        require(isinstance(given['enabled'],bool),'ข้อมูลแชทบนเว็บไซต์ไม่ถูกต้อง')
        guest_chat['enabled'] = given['enabled']
    given = body.get('widget',{})
    require(isinstance(given,dict),'ข้อมูลปุ่มแชทบนเว็บไซต์ไม่ถูกต้อง')
    if 'enabled' in given:
        require(isinstance(given['enabled'],bool),'ข้อมูลปุ่มแชทบนเว็บไซต์ไม่ถูกต้อง')
        widget['enabled'] = given['enabled']
    if 'origins' in given:
        require(isinstance(given['origins'],list),'รายการเว็บไซต์ที่อนุญาตไม่ถูกต้อง')
        origins = []
        for item in given['origins']:
            value = origin(item)
            if value not in origins:
                origins.append(value)
        require(len(origins)<=MAX_ORIGINS,f'ใส่เว็บไซต์ที่อนุญาตได้ไม่เกิน {MAX_ORIGINS} รายการ')
        widget['origins'] = origins
    if 'position' in given:
        require(given['position'] in POSITIONS,'ตำแหน่งปุ่มแชทต้องเป็นขวาหรือซ้าย')
        widget['position'] = given['position']
    if 'theme' in given:
        require(given['theme'] in THEMES,'กรุณาเลือกสีจากรายการ')
        widget['theme'] = given['theme']
    if 'title' in given:
        widget['title'] = field(given,'title',60,False)
    return guest_chat,widget
