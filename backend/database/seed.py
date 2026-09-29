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
    """Sample cases, articles and a macro. `user_id` (None at first-run setup: the platform's owner is never one of
    the organization's members) owns the sample cases and wrote the sample replies."""
    from backend.modules.tickets.service import open_ticket
    author = user_id or 'ระบบ'
    for index, (name,email,company,subject,priority,status,category,body) in enumerate(SAMPLE_CASES):
        cid, conv_id = uid(), uid()
        timestamp = iso(utc_now()-dt.timedelta(hours=index+1))
        contacts.insert(db,cid,name,email,'',company,'ข้อมูลตัวอย่าง',author,timestamp)
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
    automation.insert_macro(db,uid(),SAMPLE_MACRO,author)


# Starter articles for the platform's global FAQ. They are added once, to a new or an upgraded installation; the
# platform admin edits or deletes them like any other article. (title, category, audience, body)
GLOBAL_ARTICLES = [
    ('ตั้งค่าเซิร์ฟเวอร์และ Environment','เซิร์ฟเวอร์','platform',
     'โปรแกรมเริ่มด้วยคำสั่ง `python app.py` และเปิดที่ `127.0.0.1:8787` ใช้ได้เฉพาะเครื่องนี้\n\n'
     '## ค่าที่ปรับได้\n'
     '- `--host` และ `--port` เปลี่ยนที่อยู่และพอร์ต ใช้ `--host 0.0.0.0` เฉพาะเครือข่ายที่ตั้งใจเปิดรับ\n'
     '- `--secure-cookies` ใช้เมื่อมี HTTPS reverse proxy อยู่ด้านหน้าแล้ว\n'
     '- `BOOKDOSE_DATA` กำหนดโฟลเดอร์ข้อมูล (ค่าเริ่มต้นคือ `data/`) ตั้งได้ใน environment หรือไฟล์ `.env` ดูตัวอย่างใน `.env.example`\n\n'
     '## เปิดให้คนภายนอกใช้\n'
     'ติดตั้งบนโดเมน HTTPS แล้วตั้ง **โดเมนเว็บไซต์** ในอีเมลยืนยันการสมัครองค์กรให้ตรงกัน ขั้นตอนบน Render อยู่ใน `docs/deployment.md`'),
    ('เมื่อระบบล่มหรือฐานข้อมูลมีปัญหา','แก้ปัญหาระบบ','platform',
     '1. เปิด **ภาพรวมระบบ** ในคอนโซลระบบกลาง ดูว่างานเบื้องหลังตัวไหนหยุด และมีข้อผิดพลาดล่าสุดอะไรบ้าง\n'
     '2. ตรวจพื้นที่ดิสก์คงเหลือในหน้าเดียวกัน ฐานข้อมูล SQLite เขียนไม่ได้เมื่อดิสก์เต็ม\n'
     '3. ปิดโปรแกรมแล้วเปิดใหม่ งานที่ค้างในคิว (ข้อความรอส่ง งาน AI) ทำต่อเองหลังเปิด\n'
     '4. ถ้าฐานข้อมูลเสีย ให้กู้จากไฟล์สำรองลงโฟลเดอร์ใหม่ที่ว่าง แล้วชี้ `BOOKDOSE_DATA` ไปที่โฟลเดอร์นั้น\n\n'
     '## คำสั่งสำรองและกู้คืน\n'
     '- สำรอง: `python app.py --backup backups/bookdose-วันที่.zip`\n'
     '- กู้คืน: ตั้ง `BOOKDOSE_DATA` เป็นโฟลเดอร์ใหม่ แล้วรัน `python app.py --restore backups/ไฟล์.zip`\n\n'
     'ฐานข้อมูลอยู่ที่ `data/control.sqlite3` (บัญชีและองค์กร) และ `data/tenants/` (ไฟล์ละองค์กร) อย่าแก้ไฟล์เหล่านี้ขณะโปรแกรมเปิดอยู่'),
    ('เงื่อนไขการอัปเกรด License และ SLA ของ Bookdose','License และ SLA','platform',
     '**บทความตัวอย่าง: ใส่เงื่อนไขจริงของ Bookdose ก่อนใช้งาน**\n\n'
     '- แพ็กเกจที่มีและสิ่งที่แต่ละแพ็กเกจได้\n'
     '- ขั้นตอนอัปเกรดหรือดาวน์เกรดขององค์กร\n'
     '- ระยะเวลาตอบกลับและแก้ไขปัญหา (SLA) ที่ Bookdose ให้กับองค์กร\n'
     '- ช่องทางติดต่อฝ่ายขายและฝ่ายเทคนิค'),
    ('ตั้งค่าการกระจายเคสให้เจ้าหน้าที่ในทีม','การจัดการงาน','staff',
     '1. **ตั้งค่าองค์กร → ทีมและสมาชิก** สร้างทีม แล้วเพิ่มเจ้าหน้าที่เข้าแต่ละทีม เจ้าหน้าที่เห็นเฉพาะงานของทีมตัวเอง\n'
     '2. **ระบบอัตโนมัติ → กฎรับเรื่องและส่งต่อ** เลือกช่องทางและคำค้น แล้วกำหนดทีม ผู้รับผิดชอบ และความเร่งด่วน เช่น เรื่องจาก Facebook ที่มีคำว่า “ระบบล่ม” ส่งให้ทีมเทคนิค\n'
     '3. เปิด **ยกระดับ SLA อัตโนมัติ** เพื่อส่งเคสที่ยังไม่มีคนรับให้เจ้าขององค์กรเมื่อเกินเวลาที่ตั้ง\n\n'
     'เคสที่ไม่ตรงกฎใดจะเข้าทีมแรกขององค์กร เจ้าขององค์กรมอบหมายต่อได้จากหน้าเคส'),
    ('เชื่อมต่อช่องทาง LINE, Facebook และ Email','ช่องทางติดต่อ','staff',
     'ผู้ดูแลองค์กรตั้งค่าได้ที่ **ตั้งค่าองค์กร → LINE / อีเมล / Facebook / Instagram**\n\n'
     '- **LINE Official Account:** กรอกแชนแนล ID และความลับแชนแนลจาก LINE Developers แล้วคัดลอก Webhook URL ไปใส่ในหน้า Messaging API\n'
     '- **Facebook Messenger:** กรอก Page access token, App secret และ Verify token แล้วตั้ง Webhook ของแอปให้ชี้มาที่ URL ที่ระบบแสดง\n'
     '- **Email:** กรอก IMAP สำหรับรับและ SMTP สำหรับส่ง หรือเชื่อมบัญชีด้วย OAuth\n\n'
     'LINE และ Facebook ต้องใช้โดเมน HTTPS ที่เข้าถึงจากอินเทอร์เน็ตได้ กด **ทดสอบการเชื่อมต่อ** หลังบันทึกทุกครั้ง'),
    ('อ่านรายงานสถิติการให้บริการประจำเดือน','รายงาน','staff',
     '1. เปิดเมนู **รายงาน** แล้วเลือกช่วงวันที่เป็นเดือนที่ต้องการ เลือกทีมหรือผู้รับผิดชอบได้\n'
     '2. อ่านจำนวนเคสตามสถานะ เวลาตอบกลับครั้งแรกเฉลี่ย และตัวเลขเทียบกับช่วงก่อนหน้าที่ยาวเท่ากัน\n'
     '3. หน้า **ภาพรวม** ของเจ้าขององค์กรแสดงคะแนนความพึงพอใจ (CSAT) และช่วงเวลาที่เรื่องเข้ามามากที่สุด\n'
     '4. กด **ดาวน์โหลด CSV** เพื่อนำไปทำรายงานต่อ ข้อมูลที่ได้เป็นไปตามสิทธิ์ของผู้ดาวน์โหลด'),
    ('สมัครสมาชิกและเข้าสู่ระบบ','บัญชีของฉัน','customer',
     '1. เปิดหน้าแรกของเว็บไซต์ แล้วกดแท็บ **สมัครสมาชิก**\n'
     '2. กรอกชื่อ อีเมล และรหัสผ่านอย่างน้อย 10 ตัวอักษร เบอร์โทรศัพท์ใส่หรือไม่ก็ได้\n'
     '3. อ่านและยอมรับประกาศความเป็นส่วนตัว แล้วกด **สมัครสมาชิก**\n'
     '4. ถ้าระบบส่งอีเมลยืนยัน ให้เปิดลิงก์ในอีเมลแล้วกรอกรหัสผ่านที่เพิ่งตั้ง\n\n'
     'ครั้งต่อไปเข้าสู่ระบบด้วยอีเมลและรหัสผ่านที่หน้าแรกได้เลย ไม่ต้องจำลิงก์อื่น'),
    ('เปลี่ยนรหัสผ่านหรือลืมรหัสผ่าน','บัญชีของฉัน','customer',
     '- **เปลี่ยนรหัสผ่าน:** เปิด **ตั้งค่าบัญชี** กรอกรหัสผ่านปัจจุบันและรหัสผ่านใหม่ อุปกรณ์อื่นที่เข้าสู่ระบบไว้จะออกจากระบบ\n'
     '- **ลืมรหัสผ่าน:** ที่หน้าเข้าสู่ระบบ กด **ลืมรหัสผ่าน?** แล้วขอลิงก์ทางอีเมล ลิงก์ใช้ได้ครั้งเดียวภายใน 1 ชั่วโมง\n\n'
     'ทีมงานไม่ขอรหัสผ่านของคุณในแชทหรือทางโทรศัพท์'),
    ('ส่งเรื่องขอความช่วยเหลือและติดตามสถานะ','การติดต่อทีมงาน','customer',
     '1. กด **เริ่มแชทใหม่** เขียนหัวเรื่องและรายละเอียด แนบภาพหน้าจอได้สูงสุด 3 ไฟล์\n'
     '2. คำตอบของทีมงานแสดงใน **แชทของฉัน** และมีตัวเลขบนกระดิ่งเมื่อมีคำตอบใหม่\n'
     '3. ถ้าทีมงานรับเรื่องเป็นเคส ดูสถานะและกำหนดเวลาได้ที่ **เคสของฉัน**\n\n'
     '## ความหมายของสถานะ\n'
     '- **ทีมงานได้รับเรื่องแล้ว:** รอเจ้าหน้าที่รับดูแล\n'
     '- **กำลังดำเนินการ:** เจ้าหน้าที่ดูแลอยู่\n'
     '- **รอข้อมูลจากคุณ:** ทีมงานขอข้อมูลเพิ่ม ตอบกลับในแชทได้เลย\n'
     '- **ดำเนินการเรียบร้อยแล้ว:** ถ้ายังไม่เรียบร้อย ตอบกลับในแชทเดิมเพื่อให้ทีมดูแลต่อ'),
]


def seed_global_faq(cd):
    """Add the starter global articles once (a later deletion by the platform admin is not undone)."""
    from backend.modules.platform import repository as platform
    if platform.setting(cd,'global_faq_seeded'):
        return
    for title,category,audience,body in GLOBAL_ARTICLES:
        platform.insert_global_article(cd,uid(),title,category,body,audience,'Bookdose',published=True)
    platform.save_setting(cd,'global_faq_seeded','1')
