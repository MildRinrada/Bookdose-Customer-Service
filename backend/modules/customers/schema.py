"""Customer account forms (sign-up, sign-in, email-link tokens, password reset and change, profile, a new request)
and what the customer is shown of their account and cases."""
import re

from backend.utils.files import PICTURE_FIELD_MAX, png_data_url
from backend.utils.validation import require, field, email_field, person_name, new_password, existing_password

TOKEN = re.compile(r'[A-Za-z0-9_-]{43}')
PHONE = re.compile(r'[0-9+()\- ]{6,20}')
ID = re.compile(r'[a-f0-9]{32}')
SLUG = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*')


def signup_form(body):
    """{'name','email','phone','password' (hash)}. Consent to the privacy notice is required; the phone is optional.
    The password is hashed last, after the cheap checks."""
    name,email,phone = person_name(body),email_field(body),_phone(body)
    require(body.get('consent') is True,'กรุณายอมรับประกาศความเป็นส่วนตัวก่อนสมัคร')
    return {'name':name,'email':email,'phone':phone,'password':new_password(body)}


def login_form(body):
    return email_field(body),existing_password(body)


def email_only(body):
    return email_field(body)


def verify_form(body):
    """(link token, the password chosen at sign-up)"""
    return link_token(body),existing_password(body)


def reset_form(body):
    """(link token, new password hash)"""
    return link_token(body),new_password(body)


def link_token(body):
    token = body.get('token','')
    require(isinstance(token,str) and TOKEN.fullmatch(token),'ลิงก์ไม่ถูกต้อง กรุณาเปิดจากอีเมลอีกครั้ง')
    return token


def conversation_id(value):
    require(isinstance(value,str) and ID.fullmatch(value),'ไม่พบเรื่องนี้ในบัญชีของคุณ',404)
    return value


def case_id(value):
    require(isinstance(value,str) and ID.fullmatch(value),'ไม่พบเคสนี้ในบัญชีของคุณ',404)
    return value


def _phone(body):
    phone = field(body,'phone',20,False)
    require(not phone or (PHONE.fullmatch(phone) and sum(c.isdigit() for c in phone)>=6),'กรุณาระบุเบอร์โทรศัพท์เป็นตัวเลข เช่น 081-234-5678 หรือเว้นว่างไว้')
    return phone


def profile_form(body):
    """(name, phone, avatar) the customer edits in their account settings; the email stays as signed up. The avatar
    is None when left out (kept as it is), '' to remove it, or a PNG data URL up to 512 × 512 and 128 KB."""
    avatar = None
    if 'avatar' in body:
        avatar = field(body,'avatar',PICTURE_FIELD_MAX,False)
        ok,problem = png_data_url(avatar,'รูปโปรไฟล์')
        require(ok,problem)
    return person_name(body),_phone(body),avatar


def notifications_form(body):
    """Whether to email the customer when the team replies."""
    value = body.get('email')
    require(isinstance(value,bool),'ข้อมูลการแจ้งเตือนไม่ถูกต้อง')
    return value


def notify_prefs_form(body, events):
    """{event: {'email': bool, 'line': bool}} from {events: {...}}: known events only, either channel may be left out."""
    chosen = body.get('events')
    require(isinstance(chosen,dict) and chosen,'ข้อมูลการแจ้งเตือนไม่ถูกต้อง')
    found = {}
    for event,channels in chosen.items():
        require(event in events and isinstance(channels,dict) and channels,'ข้อมูลการแจ้งเตือนไม่ถูกต้อง')
        require(all(k in ('email','line') and isinstance(v,bool) for k,v in channels.items()),'ข้อมูลการแจ้งเตือนไม่ถูกต้อง')
        found[event] = dict(channels)
    return found


def quiet_form(value):
    """{enabled, start, end} of ช่วงเวลาห้ามรบกวน (Thai time, HH:MM; start and end differ, e.g. 21:00 and 08:00)."""
    require(isinstance(value,dict),'ข้อมูลช่วงเวลาห้ามรบกวนไม่ถูกต้อง')
    enabled,start,end = value.get('enabled'),value.get('start'),value.get('end')
    require(type(enabled) is bool,'ข้อมูลช่วงเวลาห้ามรบกวนไม่ถูกต้อง')
    require(all(isinstance(t,str) and re.fullmatch(r'([01][0-9]|2[0-3]):[0-5][0-9]',t) for t in (start,end)),'เวลาเริ่มและเวลาสิ้นสุดต้องเป็นแบบ 21:00')
    require(start!=end,'เวลาเริ่มและเวลาสิ้นสุดต้องไม่ใช่เวลาเดียวกัน')
    return {'enabled':enabled,'start':start,'end':end}


def page_form(value):
    """{popup, sound} of the alerts on the page itself."""
    require(isinstance(value,dict) and all(type(value.get(key)) is bool for key in ('popup','sound')),'ข้อมูลการแจ้งเตือนบนหน้าเว็บไม่ถูกต้อง')
    return {'popup':value['popup'],'sound':value['sound']}


def password_change_form(body):
    """(current password, new password hash)"""
    return existing_password(body,'current_password'),new_password(body)


def new_request(body, category_names):
    """(subject, category) of a new chat; the category is one of the organization's, or none."""
    category = body.get('category','')
    require(isinstance(category,str),'หมวดเรื่องไม่ถูกต้อง')
    category = category.strip()
    require(not category or category in category_names,'กรุณาเลือกหมวดเรื่องจากรายการขององค์กร')
    return field(body,'subject',300),category


def org_code(value):
    """An organization code as it appears in its link, e.g. my-company."""
    require(isinstance(value,str) and SLUG.fullmatch(value.strip().lower()),'กรุณาระบุรหัสองค์กร เช่น my-company',400)
    return value.strip().lower()


def account_view(session):
    if not session:
        return {'signed_in':False}
    return {'signed_in':True,'name':session['name'],'email':session['email'],'phone':session['phone'],'csrf':session['csrf'],
            'email_verified':bool(session['email_verified']),'notify_email':bool(session['notify_email']),'consent_version':session['consent_version'],
            'consent_at':session['consent_at'],'created_at':session['created_at'],'avatar':session.get('avatar') or ''}


CASE_FIELDS = ('id','number','subject','category','status','created_at','updated_at','first_response_due_at','first_response_at',
               'resolution_due_at','resolved_at','next_followup_at')


def case_row(ticket):
    return {key:ticket[key] for key in CASE_FIELDS}


def case_view(ticket, conversations, followups, rating, journey):
    """One case for its customer; `journey` is where it has been and when (tickets/journey.py)."""
    return {'case':case_row(ticket),'conversations':[dict(c) for c in conversations],'followups':followups,'rating':rating,
            'journey':journey}
