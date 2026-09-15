"""Client team forms (an invitation, a member's role and projects) and what is shown of a member and of the roles."""
import json
import re

from backend.modules.client_team.access import CAPABILITIES, ROLE_LABELS, ROLES, can_list
from backend.utils.validation import email_field, require

ID = re.compile(r'[a-f0-9]{32}')


def member_id(value):
    require(isinstance(value,str) and ID.fullmatch(value),'ไม่พบสมาชิกหรือคำเชิญนี้',404)
    return value


def role(body):
    value = body.get('role')
    require(value in ROLES,'กรุณาเลือกบทบาทของสมาชิก')
    return value


def scope(body, project_ids):
    """(all projects as 0/1, the listed contract ids as JSON). The listed ones must be the owner's projects, and a
    member who does not get every project gets at least one."""
    everything = body.get('all_projects',True)
    require(isinstance(everything,bool),'ขอบเขตโครงการไม่ถูกต้อง')
    listed = [] if everything else body.get('projects',[])
    require(isinstance(listed,list) and all(isinstance(p,str) for p in listed),'รายการโครงการไม่ถูกต้อง')
    listed = list(dict.fromkeys(listed))
    require(all(p in project_ids for p in listed),'เลือกได้เฉพาะโครงการของคุณเอง')
    require(everything or listed,'กรุณาเลือกโครงการอย่างน้อย 1 โครงการ หรือเลือกทุกโครงการ')
    return int(everything),json.dumps(listed)


def invite_form(body, project_ids):
    """(email lower-cased, role, all projects, projects JSON)"""
    return (email_field(body),role(body),*scope(body,project_ids))


def update_form(body, project_ids):
    """(role, all projects, projects JSON)"""
    return (role(body),*scope(body,project_ids))


def member_view(row, name):
    return {**{k:row[k] for k in ('id','email','role','status','invited_at','accepted_at')},'name':name,
            'role_label':ROLE_LABELS[row['role']],'all_projects':bool(row['all_projects']),'projects':json.loads(row['projects'])}


FLOW_KINDS = ('delivery','contract')
DECISIONS = ('approved','returned')
MAX_STEPS = 10


def flow_kind(value):
    require(value in FLOW_KINDS,'ชนิดขั้นตอนอนุมัติไม่ถูกต้อง')
    return value


def steps(value, allowed):
    """An approval flow as JSON: account ids in order, each once, only people who may review (`allowed`)."""
    require(isinstance(value,list) and all(isinstance(a,str) for a in value),'ขั้นตอนอนุมัติไม่ถูกต้อง')
    require(len(value)<=MAX_STEPS,f'ขั้นตอนอนุมัติมีได้ไม่เกิน {MAX_STEPS} ขั้น')
    require(len(set(value))==len(value),'ผู้ตรวจแต่ละคนอยู่ในขั้นตอนอนุมัติได้ครั้งเดียว')
    require(all(a in allowed for a in value),'เลือกผู้ตรวจได้เฉพาะคุณเองและสมาชิกทีมที่มีสิทธิ์ตรวจงานในโครงการนี้')
    return json.dumps(value)


def review(body):
    """(decision, remark): a remark is optional when approving and required when sending back."""
    decision = body.get('decision')
    require(decision in DECISIONS,'กรุณาเลือกผลการตรวจ')
    remark = body.get('remark','')
    require(isinstance(remark,str),'หมายเหตุไม่ถูกต้อง')
    remark = remark.strip()
    require(len(remark)<=2000,'หมายเหตุยาวเกิน 2000 ตัวอักษร')
    require(decision=='approved' or remark,'กรุณาระบุสิ่งที่ต้องแก้เมื่อส่งกลับแก้ไข')
    return decision,remark


def roles():
    """The roles an owner can give, with what each may do."""
    return [{'key':r,'label':ROLE_LABELS[r],'can':can_list(CAPABILITIES[r])} for r in ROLES]
