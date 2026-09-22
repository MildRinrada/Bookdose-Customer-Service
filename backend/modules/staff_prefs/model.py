"""A staff member's own working preferences (ตั้งค่าบัญชี): whether they take new cases now, their hours and leave,
how they hear about work, what the customer sees of them, and their own quick replies. One account works in every
organization it belongs to, so the preferences live in the control database with the account.

  staff_preferences  one row per account: the preferences as JSON (schema.py says what is allowed), and when the
                     work status last changed.
  staff_notices      (each organization's database) an email a member asked for - a case assigned to them, a
                     customer answering on their case, a case of theirs close to or past its SLA - queued inside the
                     transaction that caused it and sent by the automation worker (service.send_notices).

Availability decides who gets new cases automatically: a routing rule does not give a case to a member who is on a
break, busy, away, outside their hours or on leave (the case waits for the team instead), and an SLA escalation goes
to a lead who is available when there is one. Choosing an owner by hand still works: the picker shows the status.

Working hours and leave dates are Thai time (UTC+7, no daylight saving)."""
import datetime as dt

WORK_TZ = dt.timezone(dt.timedelta(hours=7))

STATUSES = {'online':'พร้อมรับเรื่อง','break':'พักเบรก / ทานข้าว','busy':'ยุ่งอยู่','offline':'ไม่อยู่'}
EVENTS = {'assigned':'มีเคสมอบหมายให้ฉัน','customer_reply':'ลูกค้าตอบกลับในเคสของฉัน','sla':'เคสของฉันใกล้หรือเกินกำหนด SLA',
          'snoozed':'เคสที่ฉันพักไว้ครบเวลาแล้ว'}
DAYS = ('จ.','อ.','พ.','พฤ.','ศ.','ส.','อา.')            # Monday first, as datetime.weekday()

MAX_LEAVE = 20
MAX_SNIPPETS = 50
SIGNATURE_MAX = 500
ALIAS_MAX = 60
SNIPPET_MAX = 2000
NOTICE_ATTEMPTS = 3
NOTICE_KEEP_DAYS = 14

DEFAULTS = {
    'status':'online',
    'hours':{'enabled':False,'days':[0,1,2,3,4],'start':'09:00','end':'18:00'},
    'leave':[],
    # celebrate: confetti and a card when the member closes a case or a customer gives their case 5 stars.
    'notify':{'desktop':False,'sound':False,'email':False,'celebrate':True,'events':{key:True for key in EVENTS}},
    'signature':{'enabled':False,'text':''},
    'alias':'',
    'snippets':[],
}

CONTROL_TABLES = '''
CREATE TABLE IF NOT EXISTS staff_preferences (
    user_id TEXT PRIMARY KEY, prefs TEXT NOT NULL DEFAULT '{}', status_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
'''

TENANT_TABLES = '''
CREATE TABLE IF NOT EXISTS staff_notices (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, event TEXT NOT NULL, subject TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, sent_at TEXT, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS staff_notices_waiting ON staff_notices(sent_at,created_at);
'''
