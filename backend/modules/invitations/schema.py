"""Invitation form validation and the shapes the API answers with."""
import re

from backend.modules.organization.model import ROLES
from backend.utils.dates import now
from backend.utils.validation import require, field, email_field, new_password

BAD_LINK = 'ลิงก์คำเชิญไม่ถูกต้อง หมดอายุ หรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่จากผู้ดูแลองค์กร'


def invite_form(body):
    """(email, role, team_id) of a colleague to invite."""
    role,team_id = body.get('role','agent'),field(body,'team_id',32)
    require(role in ROLES,'สิทธิ์ไม่ถูกต้อง')
    return email_field(body),role,team_id


def token(value):
    require(isinstance(value,str) and re.fullmatch(r'[A-Za-z0-9_-]{43}',value),BAD_LINK)
    return value


def accept_form(body):
    """(display name, password hash) chosen by someone who has no account yet."""
    return field(body,'name',100),new_password(body)


def invite_id(value):
    return field({'id':value},'id',32)


def state_of(row):
    if row['accepted_at']:
        return 'accepted'
    if row['cancelled_at']:
        return 'cancelled'
    return 'pending' if row['expires_at']>now() else 'expired'


def admin_view(row):
    """One row of ตั้งค่าองค์กร → ทีมและสมาชิก → คำเชิญ."""
    return {'id':row['id'],'email':row['email'],'role':row['role'],'team_id':row['team_id'],
            'invited_by':row['invited_by_name'] or '','created_at':row['created_at'],
            'last_sent_at':row['last_sent_at'],'expires_at':row['expires_at'],'state':state_of(row)}
