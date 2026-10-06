"""Sign-in, first-run setup, self-registration and account form validation, and the bootstrap response."""
import re

from backend.utils.files import PICTURE_FIELD_MAX, png_data_url
from backend.utils.validation import require, field, email_field, person_name, slug_field, new_password, existing_password


def login_form(body):
    """(email, password)"""
    return email_field(body),existing_password(body)


def setup_form(body):
    """The platform owner and the first organization."""
    name, email, password = field(body,'name',100),email_field(body),new_password(body)
    organization, slug = field(body,'organization',100),slug_field(body)
    return {'name':name,'email':email,'password':password,'organization':organization,'slug':slug}


def registration_form(body):
    """A new organization admin; the password is returned hashed."""
    name, email = field(body,'name',100),email_field(body)
    organization, slug = field(body,'organization',100),slug_field(body)
    password = new_password(body)
    require(body.get('password_confirm')==body.get('password'),'รหัสผ่านยืนยันไม่ตรงกัน')
    # ข้อตกลงการใช้บริการ (modules/legal): an organization is not made for somebody who did not agree to them.
    require(body.get('terms') is True,'กรุณาอ่านและยอมรับข้อตกลงการใช้บริการก่อนสมัคร')
    require(body.get('privacy') is True,'กรุณาอ่านและรับทราบประกาศความเป็นส่วนตัวก่อนสมัคร')
    return {'name':name,'email':email,'password':password,'organization':organization,'slug':slug}


def registration_email(body):
    return email_field(body)


def reset_form(body):
    """(link token, new password hash) of "ลืมรหัสผ่าน" for a staff account."""
    return verification_token(body.get('token')),new_password(body)


def verification_token(token):
    require(isinstance(token,str) and re.fullmatch(r'[A-Za-z0-9_-]{43}',token), 'ลิงก์ยืนยันไม่ถูกต้องหรือหมดอายุ กรุณาขอลิงก์ใหม่')
    return token


def tenant_choice(body):
    return field(body,'tenant_id',32)


def account_choice(body):
    """The session id of the account to switch to (the account switcher)."""
    value = body.get('id')
    require(isinstance(value,str) and re.fullmatch(r'[0-9a-f]{32}',value),'กรุณาเลือกบัญชี')
    return value


def password_change_form(body):
    """(new password hash, current password)"""
    return new_password(body),existing_password(body,'current_password')


def profile_form(body):
    """(display name, avatar): the avatar is empty or a PNG data URL up to 512 × 512 and 128 KB."""
    name = person_name(body)
    avatar = field(body,'avatar',PICTURE_FIELD_MAX,False)
    ok,problem = png_data_url(avatar,'รูปโปรไฟล์')
    require(ok,problem)
    return name,avatar


def bootstrap(session, setup_required, setup_token_required, registration_available, avatar, memberships, home=None):
    """What the browser needs before showing any screen; the user fields are empty when signed out.
    home ({'slug','name'} of the platform's own organization) is where customers sign up and sign in on the main page."""
    return {'setup_required':setup_required,
            'setup_token_required':setup_token_required,
            'registration_available':registration_available,
            'home':{'slug':home['slug'],'name':home['name']} if home else None,
            'user':{'id':session['user_id'],'name':session['name'],'email':session['email'],'platform_admin':bool(session['platform_admin']),
                     'platform_owner':bool(session.get('platform_owner')),'console_locked':bool(session.get('console_locked'))} if session else None,
            'avatar':avatar,
            'csrf':session['csrf'] if session else None,'tenant_id':session['tenant_id'] if session else None,
            'memberships':memberships}
