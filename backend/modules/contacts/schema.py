"""Contact form validation."""
import re

from backend.utils.validation import require, field, email_field, person_name


def contact_values(body):
    """Validated (name, email, phone, company, notes) plus (first name, last name). Accepts split or single-field names."""
    split = 'first_name' in body or 'last_name' in body
    first = person_name(body,'first_name') if split else person_name(body)
    last = person_name(body,'last_name',False) if split else ''
    name = (first+' '+last).strip()
    require(len(name)<=100,'ชื่อและนามสกุลรวมต้องไม่เกิน 100 ตัวอักษร')
    email = email_field(body) if field(body,'email',254,False) else ''
    phone = field(body,'phone',40,False)
    require(not phone or re.fullmatch(r'[0-9+() .-]{3,40}',phone),'โทรศัพท์ใช้ตัวเลข + ( ) จุด เว้นวรรค และขีด เช่น 081-234-5678')
    return (name,email,phone,field(body,'company',150,False),field(body,'notes',3000,False)),(first,last)


def merge_sources(body, target_id):
    """Ids of the contacts to merge into target_id: 1-20 distinct ids, not including the target."""
    ids = body.get('contact_ids')
    require(isinstance(ids,list) and 0<len(ids)<=20 and all(isinstance(i,str) and 0<len(i)<=32 for i in ids),'กรุณาเลือกข้อมูลลูกค้าที่จะรวม')
    require(target_id not in ids,'รายชื่อที่เก็บไว้ต้องไม่อยู่ในรายชื่อที่จะรวม')
    return list(dict.fromkeys(ids))
