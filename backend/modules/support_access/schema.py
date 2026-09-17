"""Forms and views of support access."""
from backend.modules.support_access.model import DEFAULT_HOURS, HOURS
from backend.utils.validation import field, require

ID_CHARS = set('0123456789abcdef')


def request_form(body):
    """(reason, hours) of a platform admin's request."""
    reason = field(body,'reason',300)
    require(len(reason.strip())>=5,'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร')
    hours = body.get('hours',DEFAULT_HOURS)
    require(type(hours) is int and hours in HOURS,'กรุณาเลือกระยะเวลา 1, 4, 8, 24 หรือ 72 ชั่วโมง')
    return reason.strip(),hours


def approved_hours(body, asked):
    """The time the admin grants: what was asked, or less."""
    hours = body.get('hours',asked)
    require(type(hours) is int and hours in HOURS and hours<=asked,'ระยะเวลาที่อนุมัติต้องไม่เกินที่ขอไว้')
    return hours


def note(body):
    return field(body,'note',300,False).strip()


def request_id(value):
    require(isinstance(value,str) and len(value)==32 and set(value)<=ID_CHARS,'ไม่พบคำขอนี้',404)
    return value


def admin_view(row):
    return {'id':row['id'],'status':row['status'],'reason':row['reason'],'hours':row['hours'],
            'requester':{'name':row['user_name'],'email':row['user_email']},'created_at':row['created_at'],
            'decided_at':row['decided_at'],'decided_by':row.get('decided_by_name'),'note':row['note'],
            'expires_at':row['expires_at'],'ended_at':row['ended_at'],'ended_by':row.get('ended_by_name')}


def platform_view(row):
    return {'id':row['id'],'status':row['status'],'hours':row['hours'],'reason':row['reason'],'created_at':row['created_at'],
            'expires_at':row['expires_at']}
