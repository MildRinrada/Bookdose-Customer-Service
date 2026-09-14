"""Organization settings, team and member form validation."""
from backend.exceptions.errors import APIError
from backend.modules.organization.model import ROLES
from backend.utils.validation import require, field, email_field, new_password


def settings_form(body):
    """[(setting key, value)] for the SLA hours and the support-page texts."""
    values = []
    for key in ('response_hours','resolution_hours'):
        try:
            value = float(body.get(key,''))
        except (TypeError,ValueError):
            raise APIError(400,'กรุณาระบุชั่วโมง SLA เป็นตัวเลข')
        require(0.25<=value<=8760,'SLA ต้องอยู่ระหว่าง 0.25-8,760 ชั่วโมง')
        values.append((key,str(value)))
    for key,maximum in [('welcome',500),('canned_reply',3000)]:
        values.append((key,field(body,key,maximum)))
    return values


def team_name(body):
    return field(body,'name',100)


def role_and_team(body):
    role,team_id = body.get('role','agent'),field(body,'team_id',32)
    require(role in ROLES,'สิทธิ์ไม่ถูกต้อง')
    return role,team_id


def new_member_email(body):
    return email_field(body)


def new_member_account(body):
    """(name, password hash)"""
    return field(body,'name',100),new_password(body)


def member_active(body):
    active = body.get('active',True)
    require(isinstance(active,bool),'สถานะไม่ถูกต้อง')
    return active
