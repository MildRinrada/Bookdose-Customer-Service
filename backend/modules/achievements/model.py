"""ผลงานของฉัน: a member's own record of their work in an organization, for them alone - nobody else, owners included,
can open it, and nothing here ranks anybody against anybody. Two parts:

  สรุปผลงานประจำเดือน  last month in a card (recap.py): cases closed, replies, the busiest day, the fastest reply, the
                       stars and the praise, and a title in fun that says what kind of month it was ("นักดับไฟยามดึก").
                       It pops up once the first time the member opens the app in a new month (they can switch that
                       off in ตั้งค่าบัญชี → การแจ้งเตือน), and any month since can be opened again.
  เหรียญความสำเร็จ      milestones of their own (badges.py): the first case closed, a hundred, ten work days in a row
                       with every first reply on time, ten times five stars. A badge is earned once, kept, and
                       celebrated in the staff frame when it arrives.

Months and hours are Thai time (UTC+7, no daylight saving), as the working hours are.

  staff_badges       (each organization's database) the badges each member earned, when, and when they saw it.
  staff_recaps_seen  the months whose card already popped up for the member."""
import datetime as dt

WORK_TZ = dt.timezone(dt.timedelta(hours=7))
THAI_MONTHS = ('มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม',
               'พฤศจิกายน','ธันวาคม')
# Badges are worked out again at most this often per member (the alerts that carry new ones refresh every minute).
CHECK_SECONDS = 300
# Months that can be opened again, counting back from last month.
RECAP_MONTHS = 12
# Hours (Thai time) that make a reply a late-night one, and an early one.
NIGHT_FROM, NIGHT_UNTIL = 22, 6
EARLY_UNTIL = 8

TENANT_TABLES = '''
CREATE TABLE IF NOT EXISTS staff_badges (
    user_id TEXT NOT NULL, badge TEXT NOT NULL, earned_at TEXT NOT NULL, seen_at TEXT, PRIMARY KEY(user_id,badge)
);
CREATE TABLE IF NOT EXISTS staff_recaps_seen (
    user_id TEXT NOT NULL, month TEXT NOT NULL, seen_at TEXT NOT NULL, PRIMARY KEY(user_id,month)
);
'''
