"""Sample customers, cases and articles for a new organization when "demo data" is chosen at first-run setup."""
import datetime as dt

from backend.modules.automation import repository as automation
from backend.modules.contacts import repository as contacts
from backend.modules.conversations import repository as conversations
from backend.modules.knowledge import repository as knowledge
from backend.modules.tickets import repository as tickets
from backend.utils.dates import iso, now, utc_now
from backend.utils.security import uid

SAMPLE_CASES = [
    ('พิมพ์ชนก วัฒนากุล','pim@example.com','มหาวิทยาลัยศรีนครินทร์','เข้าใช้งานห้องสมุดออนไลน์ไม่ได้','high','open','การเข้าใช้งาน', 'สวัสดีค่ะ เข้าระบบห้องสมุดแล้วขึ้นว่าบัญชีหมดอายุ รบกวนช่วยตรวจสอบให้หน่อยค่ะ'),
    ('ธนพล สุขใจ','thanapon@example.com','โรงเรียนปัญญาวิทย์','ต้องการเพิ่มจำนวนผู้ใช้งาน e-Library','normal','new','บริการและแพ็กเกจ','สนใจเพิ่มจำนวนผู้ใช้สำหรับภาคเรียนใหม่ครับ ขอรายละเอียดด้วยครับ'),
    ('ณัฐชยา ใจดี','natchaya@example.com','บริษัท อ่านดี จำกัด','เปิดหนังสือแล้วหน้าจอแสดงผลไม่ครบ','urgent','pending_internal','ปัญหาทางเทคนิค','อ่านบนแท็บเล็ตแล้วตัวหนังสือด้านขวาถูกตัดค่ะ'),
    ('กิตติพงษ์ แสงทอง','kitti@example.com','สถาบันการเรียนรู้','สอบถามการออกรายงานการอ่าน','low','pending_customer','การใช้งาน','อยากทราบวิธีดาวน์โหลดรายงานการอ่านประจำเดือนครับ'),
    ('ศิริพร มั่นคง','siri@example.com','โรงเรียนต้นกล้า','ขอคู่มือการตั้งค่าระบบสำหรับครู','normal','resolved','การใช้งาน','รบกวนส่งคู่มือเริ่มต้นใช้งานให้หน่อยค่ะ'),
]
SAMPLE_ARTICLES = [
    ('เริ่มต้นใช้งาน Bookdose e-Library','เริ่มต้นใช้งาน','บทความตัวอย่างสำหรับทีมงาน\n\n1. เปิดเว็บไซต์ห้องสมุดที่องค์กรของคุณแจ้งไว้\n2. เข้าสู่ระบบด้วยบัญชีที่ได้รับจากผู้ดูแล\n3. เลือกหนังสือที่ต้องการและกดอ่าน\n\nหากไม่สามารถเข้าสู่ระบบได้ กรุณาติดต่อผู้ดูแลองค์กรเพื่อยืนยันสิทธิ์การใช้งาน'),
    ('รับเรื่องอย่างไรให้ช่วยเหลือลูกค้าได้เร็วขึ้น','แนวทางบริการ','ขอข้อมูลจากลูกค้าให้ครบก่อนส่งต่อทีมเทคนิค\n\n• อุปกรณ์และเบราว์เซอร์ที่ใช้\n• ขั้นตอนที่พบปัญหา\n• เวลาที่เกิดปัญหา\n• ภาพหน้าจอที่ไม่มีข้อมูลรหัสผ่าน\n\nบันทึกข้อมูลการวิเคราะห์ในบันทึกภายในเคส'),
]


SAMPLE_MACRO = {'name':'ขอข้อมูลเพิ่มเติม','set_status':'pending_customer','followup_hours':24,
                'reply':'สวัสดีค่ะคุณ{customer} เพื่อให้ทีมตรวจสอบเคส {case} ได้เร็วขึ้น รบกวนส่งภาพหน้าจอ อุปกรณ์ที่ใช้ และเวลาที่พบปัญหาเพิ่มเติมนะคะ ขอบคุณค่ะ'}


def seed_demo(db, user_id, team_id):
    from backend.modules.tickets.service import open_ticket
    for index, (name,email,company,subject,priority,status,category,body) in enumerate(SAMPLE_CASES):
        cid, conv_id = uid(), uid()
        timestamp = iso(utc_now()-dt.timedelta(hours=index+1))
        contacts.insert(db,cid,name,email,'',company,'ข้อมูลตัวอย่าง',user_id,timestamp)
        conversations.insert(db,conv_id,cid,subject,'web',team_id,None,timestamp)
        conversations.insert_message(db,uid(),conv_id,None,name,'customer',body,timestamp)
        tid = open_ticket(db,cid,team_id,subject,priority,user_id if index != 1 else None,category,conv_id)
        tickets.backdate(db,tid,status,timestamp)
        if index in (0,3,4):
            reply = 'สวัสดีค่ะ ทีมงานรับเรื่องแล้ว กำลังตรวจสอบให้นะคะ' if index != 4 else 'เปิดเมนูตั้งค่า แล้วเลือกผู้ใช้งานเพื่อเพิ่มบัญชีครูได้เลยค่ะ หากต้องการความช่วยเหลือเพิ่มเติมติดต่อเราได้เสมอนะคะ'
            conversations.insert_message(db,uid(),conv_id,user_id,'ทีม Bookdose','reply',reply)
            tickets.set_first_response(db,tid,now())
        if index == 4:
            tickets.set_resolved_at(db,tid,now())
        if index == 2:
            tickets.set_first_response_due(db,tid,iso(utc_now()-dt.timedelta(minutes=35)))
    for title,category,body in SAMPLE_ARTICLES:
        knowledge.insert(db,uid(),title,category,body,'internal','ทีม Bookdose')
    automation.insert_macro(db,uid(),SAMPLE_MACRO,user_id)
