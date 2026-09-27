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
          'snoozed':'เคสที่ฉันพักไว้ครบเวลาแล้ว','help':'เพื่อนยกมือขอช่วยในเคสที่ฉันเห็น (บนหน้าจอและเสียงเท่านั้น)',
          'weekly_report':'สรุปรายงานประจำสัปดาห์ ทุกวันจันทร์ (เฉพาะเจ้าขององค์กร)'}
# Emails written as a formal memo: the subject is the notice's own (it names the organization), and the body opens
# with เรียน and closes with จึงเรียนมาเพื่อโปรดทราบ (reports/weekly.py).
FORMAL_EVENTS = ('weekly_report',)
DAYS = ('จ.','อ.','พ.','พฤ.','ศ.','ส.','อา.')            # Monday first, as datetime.weekday()

# หน้าภาพรวมของฉัน: which cards a member keeps on their overview, in what order and how wide.
#
# A support overview has to hold everything somebody might need, and nobody needs all of it: an agent works from the
# chats waiting and what is about to break its SLA, an owner from the team's load and the figures. One fixed page can
# only be a compromise between them, so the page is fixed and the arrangement is the member's.
#
# What a card is called belongs to the screen, not here. The server keeps the names that were chosen and the page
# decides what they mean, so a card added, renamed or dropped in a release needs no migration: the page shows what it
# knows and ignores the rest, and a name the member never touched simply keeps its own place.
#
# The page is a board of squares and each card holds a rectangle of it: where it starts (x, y) and how many columns
# and rows it covers (w, h). Nothing flows, so the member can leave a gap where they want one. The bounds are here
# because a rectangle off the board, or one square wide, is a card nobody can read - not because the server has any
# opinion about where a card belongs.
DASHBOARD_COLUMNS = 12
DASHBOARD_MAX_ROWS = 400
DASHBOARD_MIN_W = 3
DASHBOARD_MIN_H = 3
DASHBOARD_MAX_CARDS = 40
EMPTY_DASHBOARD = {'hidden':[],'box':{}}

MAX_LEAVE = 20
MAX_SNIPPETS = 50
SIGNATURE_MAX = 500
PERSONAS = ('formal','friendly','custom')
PERSONA_MAX = 300
ALIAS_MAX = 60
SNIPPET_MAX = 2000
NOTICE_ATTEMPTS = 3
NOTICE_KEEP_DAYS = 14

DEFAULTS = {
    'status':'online',
    'hours':{'enabled':False,'days':[0,1,2,3,4],'start':'09:00','end':'18:00'},
    'leave':[],
    # celebrate: confetti and a card when the member closes a case, a customer gives their case 5 stars or praises
    # them, or they earn a badge. recap: last month's summary pops up the first time they open the app in a month.
    'notify':{'desktop':False,'sound':False,'email':False,'celebrate':True,'recap':True,'events':{key:True for key in EVENTS}},
    'signature':{'enabled':False,'text':''},
    'alias':'',
    'snippets':[],
    # Empty means "as the organization arranged it", which in turn means "as the screen ships".
    'dashboard':{'hidden':[],'box':{}},
    # The personality of the member's own AI assistant (ai/assistant.py): '' until they choose (it speaks formally
    # meanwhile), 'formal', 'friendly', or 'custom' with the character they described.
    'assistant':{'persona':'','custom':''},
    # เริ่มต้นใช้งาน closed for good (automation/setup.py): the organizations where this owner said they do not want
    # the steps. Per organization, because a new one they join or open still needs its own.
    'setup_hidden':[],
}
SETUP_HIDDEN_MAX = 200

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
