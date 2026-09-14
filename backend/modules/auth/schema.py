"""Sign-in, first-run setup, self-registration and account form validation, and the bootstrap response."""
import base64
import re
import struct

from backend.exceptions.errors import APIError
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
    return {'name':name,'email':email,'password':password,'organization':organization,'slug':slug}


def registration_email(body):
    return email_field(body)


def verification_token(token):
    require(isinstance(token,str) and re.fullmatch(r'[A-Za-z0-9_-]{43}',token), 'ลิงก์ยืนยันไม่ถูกต้องหรือหมดอายุ กรุณาขอลิงก์ใหม่')
    return token


def tenant_choice(body):
    return field(body,'tenant_id',32)


def password_change_form(body):
    """(new password hash, current password)"""
    return new_password(body),existing_password(body,'current_password')


def profile_form(body):
    """(display name, avatar): the avatar is empty or a PNG data URL up to 512 × 512 and 128 KB."""
    name = person_name(body)
    avatar = field(body,'avatar',180000,False)
    if avatar:
        require(avatar.startswith('data:image/png;base64,'),'รูปโปรไฟล์ต้องเป็น PNG')
        try:
            raw = base64.b64decode(avatar.split(',',1)[1],validate=True)
            require(len(raw)>=33 and raw.startswith(b'\x89PNG\r\n\x1a\n') and raw[12:16]==b'IHDR','รูปโปรไฟล์ไม่ถูกต้อง')
            width,height=struct.unpack('>II',raw[16:24])
            require(0<width<=512 and 0<height<=512 and len(raw)<=128*1024,'รูปโปรไฟล์ต้องไม่เกิน 512 × 512 และ 128 KB')
        except (ValueError,struct.error):
            raise APIError(400,'รูปโปรไฟล์ไม่ถูกต้อง')
    return name,avatar


def bootstrap(session, setup_required, setup_token_required, registration_available, avatar, memberships):
    """What the browser needs before showing any screen; the user fields are empty when signed out."""
    return {'setup_required':setup_required,
            'setup_token_required':setup_token_required,
            'registration_available':registration_available,
            'user':{'id':session['user_id'],'name':session['name'],'email':session['email'],'platform_admin':bool(session['platform_admin'])} if session else None,
            'avatar':avatar,
            'csrf':session['csrf'] if session else None,'tenant_id':session['tenant_id'] if session else None,
            'memberships':memberships}
