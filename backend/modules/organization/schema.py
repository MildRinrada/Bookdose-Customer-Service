"""Organization settings, team and member form validation."""
import re

from backend.exceptions.errors import APIError
from backend.modules.organization.model import MAX_TEAM_SNIPPETS, ORG_NAME_MAX, ROLES, TEAM_SNIPPET_MAX
from backend.utils.files import PICTURE_FIELD_MAX, png_data_url
from backend.utils.security import uid
from backend.utils.validation import require, field, email_field, new_password

# The same shape as a member's own quick reply (staff_prefs/schema.py): Thai or Latin letters, digits, _ and -.
SHORTCUT = re.compile(r'[a-z0-9ก-๙][a-z0-9ก-๙_-]{0,29}')
ID = re.compile(r'[a-f0-9]{32}')


def customer_categories(body, team_ids):
    """[{'name','team_id'}] customers choose from when starting a chat; team_id '' leaves the chat with the first team."""
    items = body.get('categories')
    require(isinstance(items,list) and 1<=len(items)<=12,'ตั้งหมวดเรื่องได้ 1-12 หมวด')
    found,names = [],set()
    for item in items:
        require(isinstance(item,dict),'ข้อมูลหมวดเรื่องไม่ถูกต้อง')
        name,team = item.get('name',''),item.get('team_id','') or ''
        require(isinstance(name,str) and 1<=len(name.strip())<=60,'ชื่อหมวดเรื่องต้องมี 1-60 ตัวอักษร')
        name = name.strip()
        require(name not in names,f'มีหมวด “{name}” ซ้ำกัน')
        require(team=='' or team in team_ids,'ไม่พบทีมที่เลือกให้หมวดเรื่อง')
        names.add(name)
        found.append({'name':name,'team_id':team})
    return found


def profile_form(body):
    """(name, logo) of the organization itself. The logo is empty or a square PNG from the picture cropper."""
    name = field(body,'name',ORG_NAME_MAX)
    logo = field(body,'logo',PICTURE_FIELD_MAX,False)
    ok,problem = png_data_url(logo,'โลโก้องค์กร')
    require(ok,problem)
    return name,logo


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
    values.append(('welcome',field(body,'welcome',500)))
    return values


def team_snippets(body):
    """[{'id','shortcut','text'}] the whole organization can put into a reply, in the order given."""
    items = body.get('snippets')
    require(isinstance(items,list) and len(items)<=MAX_TEAM_SNIPPETS,f'บันทึกคำตอบสำเร็จรูปของทีมได้ไม่เกิน {MAX_TEAM_SNIPPETS} รายการ')
    found,seen = [],set()
    for item in items:
        require(isinstance(item,dict),'ข้อมูลคำตอบสำเร็จรูปไม่ถูกต้อง')
        shortcut = item.get('shortcut','')
        require(isinstance(shortcut,str),'คีย์ลัดไม่ถูกต้อง')
        shortcut = shortcut.strip().lstrip('/').lower()
        require(SHORTCUT.fullmatch(shortcut),'คีย์ลัดใช้ตัวอักษร ตัวเลข _ และ - ไม่เกิน 30 ตัว เช่น ขอบคุณ หรือ thanks')
        require(shortcut not in seen,f'คีย์ลัด /{shortcut} ซ้ำกัน')
        seen.add(shortcut)
        text = item.get('text','')
        require(isinstance(text,str),'ข้อความคำตอบสำเร็จรูปไม่ถูกต้อง')
        text = text.strip()
        require(text,f'กรุณาพิมพ์ข้อความของ /{shortcut}')
        require(len(text)<=TEAM_SNIPPET_MAX,f'ข้อความคำตอบสำเร็จรูปยาวได้ไม่เกิน {TEAM_SNIPPET_MAX} ตัวอักษร')
        given = item.get('id')
        found.append({'id':given if isinstance(given,str) and ID.fullmatch(given) else uid(),'shortcut':shortcut,'text':text})
    return found


def team_form(body):
    """(name, description) of a team. The description says what the team is for, and may be left out."""
    text = body.get('description','') or ''
    require(isinstance(text,str) and len(text)<=300,'รายละเอียดทีมยาวเกินไป')
    return field(body,'name',100),text.strip()


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
