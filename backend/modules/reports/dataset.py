"""ชุดข้อมูลสำหรับวิเคราะห์: the report's period as tidy tables in one ZIP, for Python, R, Excel, Power BI or Looker
Studio - one CSV per kind of thing, joined by their ids, with a data dictionary beside them.

What goes: the cases opened in the period with their times and SLA outcome, the conversations started in it, their
messages as events (when, who kind of author, how long, files) - never the text -, satisfaction ratings (never the
comment), reopens, escalations, and the teams and members they point at. Customers appear only as their random
record id: no name, email, phone or message leaves. Times are UTC ISO 8601. Leads only; a lead of one team gets
that team's."""
import csv
import datetime as dt
import io
import zipfile

from backend.database import audit
from backend.database.db import rows
from backend.middleware.access import visible_team
from backend.modules.reports.service import LEADS, _arg, period
from backend.utils.dates import now
from backend.utils.validation import require

BOM = '﻿'

# (file, [(column, meaning)]) - the data dictionary, and the order of every file's columns.
TABLES = {
    'tickets.csv':[
        ('ticket_id','รหัสเคส (ใช้เชื่อมกับตารางอื่น)'),('number','เลขเคสที่เห็นในระบบ (BD-<number>)'),
        ('created_at','เวลาเปิดเคส (UTC)'),('status','สถานะตอนส่งออก: new, open, pending_customer, pending_internal, resolved, closed'),
        ('priority','ความเร่งด่วน: low, normal, high, urgent'),('category','หมวดเรื่อง'),
        ('team_id','รหัสทีม (teams.csv)'),('assignee_id','รหัสผู้รับผิดชอบ (members.csv) ว่าง = ยังไม่มอบหมาย'),
        ('contact_id','รหัสลูกค้าแบบสุ่ม ไม่มีชื่อหรือช่องทางติดต่อ'),('channel','ช่องทางของบทสนทนาแรกของเคส: web, line, email, facebook, manual'),
        ('first_response_due_at','กำหนดตอบครั้งแรกตาม SLA (UTC)'),('first_response_at','เวลาที่ทีมตอบครั้งแรก (UTC) ว่าง = ยังไม่ตอบ'),
        ('first_response_minutes','นาทีจากเปิดเคสถึงตอบครั้งแรก'),('first_response_met','ตอบครั้งแรกทันกำหนด 1 = ทัน 0 = ไม่ทัน ว่าง = ยังไม่ตอบและยังไม่เลยกำหนด'),
        ('resolution_due_at','กำหนดแก้ไขเสร็จตาม SLA (UTC)'),('resolved_at','เวลาที่แก้ไขเสร็จหรือปิด (UTC)'),
        ('resolution_minutes','นาทีจากเปิดเคสถึงแก้ไขเสร็จ'),('resolution_met','แก้ไขเสร็จทันกำหนด 1/0 ว่าง = ยังไม่เสร็จและยังไม่เลยกำหนด'),
        ('reopen_count','จำนวนครั้งที่เคสกลับมาเปิดใหม่ (reopens.csv)'),('csat_rating','คะแนนความพึงพอใจล่าสุด 1-5 ว่าง = ไม่มีคำตอบ'),
        ('escalated','ถูกยกระดับอัตโนมัติ 1/0 (escalations.csv)')],
    'conversations.csv':[
        ('conversation_id','รหัสบทสนทนา'),('created_at','เวลาเริ่ม (UTC)'),('updated_at','เวลาเคลื่อนไหวล่าสุด (UTC)'),
        ('channel','ช่องทาง: web, line, email, facebook, manual'),('status','สถานะ: open, closed'),
        ('team_id','รหัสทีม'),('contact_id','รหัสลูกค้าแบบสุ่ม'),('ticket_id','รหัสเคสที่เชื่อมอยู่ ว่าง = ไม่มีเคส'),
        ('messages','จำนวนข้อความทั้งหมด'),('customer_messages','จำนวนข้อความจากลูกค้า')],
    'messages.csv':[
        ('message_id','รหัสข้อความ'),('conversation_id','รหัสบทสนทนา'),('created_at','เวลาส่ง (UTC)'),
        ('author_type','ผู้เขียน: customer, staff, ai, system'),('author_id','รหัสเจ้าหน้าที่ (members.csv) เมื่อผู้เขียนเป็น staff'),
        ('kind','ชนิด: customer, reply (ตอบลูกค้า), note (บันทึกภายใน)'),('length','จำนวนตัวอักษรของข้อความ (ไม่ส่งออกเนื้อความ)'),
        ('attachments','จำนวนไฟล์แนบ'),('deleted','ถูกลบแล้ว 1/0')],
    'csat.csv':[
        ('survey_id','รหัสแบบสอบถาม'),('ticket_id','รหัสเคส'),('conversation_id','รหัสบทสนทนา'),('sent_at','เวลาส่งแบบสอบถาม (UTC)'),
        ('answered_at','เวลาที่ลูกค้าตอบ (UTC) ว่าง = ไม่ตอบ'),('rating','คะแนน 1-5'),('has_comment','ลูกค้าเขียนความเห็นด้วย 1/0 (ไม่ส่งออกข้อความ)')],
    'reopens.csv':[('ticket_id','รหัสเคส'),('reopened_at','เวลาที่กลับมาเปิด (UTC)'),('cause','สาเหตุ: customer, staff, handoff')],
    'escalations.csv':[('ticket_id','รหัสเคส'),('escalated_at','เวลายกระดับ (UTC)'),('reason','เหตุผล: unclaimed (ไม่มีคนรับ), sla_risk (ใกล้เกิน SLA)'),
                       ('from_user_id','ผู้รับผิดชอบเดิม'),('to_user_id','ผู้ที่ได้รับแจ้งหรือได้รับเคส')],
    'teams.csv':[('team_id','รหัสทีม'),('name','ชื่อทีม')],
    'members.csv':[('member_id','รหัสเจ้าหน้าที่'),('name','ชื่อ'),('role','สิทธิ์: admin, agent'),('team_id','รหัสทีมหลัก'),('active','ใช้งานอยู่ 1/0')],
}


def _minutes(start, end):
    if not start or not end:
        return ''
    return round((dt.datetime.fromisoformat(end)-dt.datetime.fromisoformat(start)).total_seconds()/60,1)


def _met(done_at, due_at, moment):
    if done_at:
        return 1 if done_at<=due_at else 0
    return 0 if due_at and due_at<moment else ''


def _csv(name, records):
    output = io.StringIO()
    writer = csv.writer(output)
    columns = [c for c,_ in TABLES[name]]
    writer.writerow(columns)
    for record in records:
        values = ['' if record.get(c) is None else str(record.get(c)) for c in columns]
        # A cell a spreadsheet would run as a formula is kept as text.
        writer.writerow(["'"+v if v[:1] in ('=','+','-','@') and not v.lstrip('-').replace('.','',1).isdigit() else v for v in values])
    return BOM+output.getvalue()


def build(cd, db, ctx, query):
    """(ZIP bytes, file name) of the period's tables. Recorded in the activity log."""
    require(ctx['role'] in LEADS,'เฉพาะเจ้าขององค์กรส่งออกชุดข้อมูลได้',403)
    since,until,_,first = period(query)
    team = visible_team(ctx) or _arg(query,'team') or None
    moment = now()
    in_team = '(? IS NULL OR t.team_id=?)'
    tickets = rows(db,f'''SELECT t.id AS ticket_id,t.number,t.created_at,t.status,t.priority,t.category,t.team_id,t.assignee_id,t.contact_id,
                          t.first_response_due_at,t.first_response_at,t.resolution_due_at,t.resolved_at,
                          (SELECT c.channel FROM ticket_conversations tc JOIN conversations c ON c.id=tc.conversation_id
                            WHERE tc.ticket_id=t.id ORDER BY c.created_at LIMIT 1) AS channel,
                          (SELECT COUNT(*) FROM ticket_reopens r WHERE r.ticket_id=t.id) AS reopen_count,
                          (SELECT s.rating FROM csat_surveys s WHERE s.ticket_id=t.id AND s.rating IS NOT NULL ORDER BY s.answered_at DESC LIMIT 1) AS csat_rating,
                          EXISTS(SELECT 1 FROM escalations e WHERE e.ticket_id=t.id) AS escalated
                          FROM tickets t WHERE t.created_at>=? AND t.created_at<? AND {in_team} ORDER BY t.created_at''',(since,until,team,team))
    for t in tickets:
        t['first_response_minutes'] = _minutes(t['created_at'],t['first_response_at'])
        t['first_response_met'] = _met(t['first_response_at'],t['first_response_due_at'],moment)
        t['resolution_minutes'] = _minutes(t['created_at'],t['resolved_at'])
        t['resolution_met'] = _met(t['resolved_at'],t['resolution_due_at'],moment)
    conversations = rows(db,'''SELECT c.id AS conversation_id,c.created_at,c.updated_at,c.channel,c.status,c.team_id,c.contact_id,
                               (SELECT tc.ticket_id FROM ticket_conversations tc WHERE tc.conversation_id=c.id) AS ticket_id,
                               (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id) AS messages,
                               (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.kind='customer') AS customer_messages
                               FROM conversations c WHERE c.created_at>=? AND c.created_at<? AND (? IS NULL OR c.team_id=?)
                               ORDER BY c.created_at''',(since,until,team,team))
    messages = rows(db,'''SELECT m.id AS message_id,m.conversation_id,m.created_at,m.kind,
                          CASE WHEN m.kind='customer' THEN 'customer' WHEN a.source IS NOT NULL THEN a.source ELSE 'staff' END AS author_type,
                          CASE WHEN m.kind!='customer' AND a.source IS NULL THEN m.author_id END AS author_id,
                          LENGTH(m.body) AS length,(SELECT COUNT(*) FROM attachments f WHERE f.message_id=m.id) AS attachments,
                          m.deleted_at IS NOT NULL AS deleted
                          FROM messages m JOIN conversations c ON c.id=m.conversation_id LEFT JOIN ai_message_meta a ON a.message_id=m.id
                          WHERE c.created_at>=? AND c.created_at<? AND (? IS NULL OR c.team_id=?)
                          ORDER BY m.created_at,m.rowid''',(since,until,team,team))
    ids = tuple(t['ticket_id'] for t in tickets)
    marks = ','.join('?'*len(ids)) or "''"
    csat = rows(db,f'''SELECT id AS survey_id,ticket_id,conversation_id,sent_at,answered_at,rating,comment!='' AS has_comment
                       FROM csat_surveys WHERE ticket_id IN ({marks}) ORDER BY sent_at''',ids)
    reopens = rows(db,f'SELECT ticket_id,reopened_at,cause FROM ticket_reopens WHERE ticket_id IN ({marks}) ORDER BY reopened_at',ids)
    escalations = rows(db,f'''SELECT ticket_id,escalated_at,reason,from_user_id,to_user_id FROM escalations
                              WHERE ticket_id IN ({marks}) ORDER BY escalated_at''',ids)
    teams = rows(db,'SELECT id AS team_id,name FROM teams ORDER BY name')
    from backend.modules.organization import repository as organization
    members = [{'member_id':m['id'],'name':m['name'],'role':m['role'],'team_id':m['team_id'],'active':int(bool(m['active']))}
               for m in organization.tenant_members(cd,ctx['tenant_id'])]
    tables = {'tickets.csv':tickets,'conversations.csv':conversations,'messages.csv':messages,'csat.csv':csat,'reopens.csv':reopens,
              'escalations.csv':escalations,'teams.csv':teams,'members.csv':members}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as archive:
        for name,records in tables.items():
            archive.writestr(name,_csv(name,records))
        dictionary = io.StringIO()
        writer = csv.writer(dictionary)
        writer.writerow(['file','column','meaning'])
        for name,columns in TABLES.items():
            for column,meaning in columns:
                writer.writerow([name,column,meaning])
        archive.writestr('data_dictionary.csv',BOM+dictionary.getvalue())
        last = dt.date.fromisoformat(_arg(query,'to'))
        archive.writestr('README.txt',README.format(org=ctx.get('tenant_name',''),first=first.isoformat(),last=last.isoformat(),at=moment,
                                                    counts='\n'.join(f'  {name:<20}{len(records):>8} แถว' for name,records in tables.items())))
    audit.record(db,ctx['name'],'reports.dataset_exported',ctx['tenant_id'],f'{first.isoformat()} ถึง {_arg(query,"to")} · เคส {len(tickets)} รายการ')
    db.commit()
    return buffer.getvalue(),f'bookdose-dataset-{first.isoformat()}-{_arg(query,"to")}.zip'


README = """ชุดข้อมูลสำหรับวิเคราะห์ · {org}
ช่วงวันที่ {first} ถึง {last} (ตามเวลาของผู้ส่งออก) · ส่งออกเมื่อ {at} (UTC)

{counts}

- ทุกไฟล์เป็น CSV แบบ UTF-8 เปิดใน Excel ได้ทันที เวลาทั้งหมดเป็น UTC รูปแบบ ISO 8601
- เชื่อมตารางด้วยคอลัมน์ที่ลงท้ายด้วย _id เช่น tickets.ticket_id = csat.ticket_id
- tickets.csv คือเคสที่เปิดในช่วงนี้ conversations.csv และ messages.csv คือบทสนทนาที่เริ่มในช่วงนี้
- ไม่มีชื่อ อีเมล เบอร์โทร หรือเนื้อความของลูกค้า ลูกค้าแต่ละคนเป็นรหัสสุ่ม (contact_id)
- ความหมายของทุกคอลัมน์อยู่ใน data_dictionary.csv
"""
