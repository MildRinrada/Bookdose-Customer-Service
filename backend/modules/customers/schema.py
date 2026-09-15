"""Customer account forms (sign-up, sign-in, email-link tokens, password reset and change, profile, a new request)
and what the customer is shown of their account and cases."""
import re

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
    """(name, phone) the customer edits in their account settings; the email stays as signed up."""
    return person_name(body),_phone(body)


def notifications_form(body):
    """Whether to email the customer when the team replies."""
    value = body.get('email')
    require(isinstance(value,bool),'ข้อมูลการแจ้งเตือนไม่ถูกต้อง')
    return value


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
            'consent_at':session['consent_at'],'created_at':session['created_at']}


CASE_FIELDS = ('id','number','subject','category','status','created_at','updated_at','first_response_due_at','first_response_at',
               'resolution_due_at','resolved_at','next_followup_at')


def case_row(ticket):
    return {key:ticket[key] for key in CASE_FIELDS}


def case_view(ticket, conversations, followups, rating):
    return {'case':case_row(ticket),'conversations':[dict(c) for c in conversations],'followups':followups,'rating':rating}
