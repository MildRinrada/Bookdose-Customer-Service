"""สรุปรายงานผลการให้บริการลูกค้าประจำสัปดาห์: every Monday from 08:00 Thai time, the organization's owners get last
week's headline figures against the week before and their goals, by email, written as a formal memo - numbers only, no
AI (so no quota), and a link to the report.

It goes the way the other emails about work go (staff_prefs: queued here, sent by the automation worker, which wraps it
in the formal greeting and closing, staff_prefs.model.FORMAL_EVENTS), so an owner gets it when they turned email on and
kept this event (ตั้งค่าบัญชี → การแจ้งเตือน). One per week per organization: the Monday it went out is kept in the
settings. A week in which nothing happened, after one in which nothing happened either, is not worth an email."""
import datetime as dt

from backend.database.db import one
from backend.modules.reports import goals, stats
from backend.modules.staff_prefs.model import WORK_TZ
from backend.utils.dates import iso

KEY = 'weekly_report_sent'
SEND_HOUR = 8
MONTHS = ('มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม')


def duration(minutes):
    """"25 นาที", "3 ชั่วโมง 10 นาที", "2 วัน 4 ชั่วโมง"."""
    if minutes is None:
        return None
    n = round(minutes)
    if n>=1440:
        return f'{n//1440} วัน'+(f' {n%1440//60} ชั่วโมง' if n%1440//60 else '')
    return f'{n//60} ชั่วโมง'+(f' {n%60} นาที' if n%60 else '') if n>=60 else f'{n} นาที'


def _day(day):
    return f'{day.day} {MONTHS[day.month-1]} {day.year+543}'


def _figure(metric, value):
    """A figure in words, or ไม่มีข้อมูล."""
    if value is None:
        return 'ไม่มีข้อมูล'
    if metric in ('first_response','next_reply'):
        return duration(value)
    if metric=='csat':
        return f'{value:.2f} จากคะแนนเต็ม 5'
    return f'ร้อยละ {value:.1f}'


def _target(metric, target):
    better = goals.METRICS[metric][1]
    value = duration(target) if metric in ('first_response','next_reply') else f'{target:g}' if metric=='csat' else f'ร้อยละ {target:g}'
    return ('ไม่น้อยกว่า ' if better=='high' else 'ไม่เกิน ')+value


LINES = (('response_sla','การตอบกลับครั้งแรกทันกำหนด'),('first_response','เวลาตอบกลับครั้งแรก ค่ามัธยฐาน'),
         ('next_reply','เวลารอคำตอบถัดไป ค่ามัธยฐาน'),('fcr','การแก้ไขแล้วเสร็จด้วยการตอบครั้งเดียว'),
         ('csat','คะแนนความพึงพอใจเฉลี่ย'),('reopen','การเปิดเคสซ้ำ'),('upset','เคสที่ลูกค้าไม่พอใจ'))


def subject(organization, start):
    end = start+dt.timedelta(days=6)
    return f'สรุปรายงานผลการให้บริการลูกค้าประจำสัปดาห์ {organization} ระหว่างวันที่ {_day(start)} ถึงวันที่ {_day(end)}'


def text(week, before, targets, start, organization):
    """The memo's body: the week's figures, the week before in brackets, each goal met or not, and the cases open now."""
    end = start+dt.timedelta(days=6)
    lines = [f'ขอนำส่งสรุปรายงานผลการให้บริการลูกค้าประจำสัปดาห์ของ{organization} ระหว่างวันที่ {_day(start)} ถึงวันที่ {_day(end)} '
             'โดยตัวเลขในวงเล็บเป็นผลของสัปดาห์ก่อนหน้า มีรายละเอียดดังนี้','',
             f"1. จำนวนเคสที่เปิดใหม่ {week['opened']} เคส ({before['opened']} เคส)"]
    for number,(metric,label) in enumerate(LINES,2):
        line = f'{number}. {label} {_figure(metric,week[metric])} ({_figure(metric,before[metric])})'
        if metric=='csat' and week['csat_count']:
            line += f" จากแบบประเมิน {week['csat_count']} ฉบับ"
        if metric in targets:
            reached = goals.met(metric,week[metric],targets[metric])
            result = 'เป็นไปตามเป้าหมาย' if reached else 'ไม่เป็นไปตามเป้าหมาย' if reached is False else 'ยังไม่มีข้อมูลเทียบเป้าหมาย'
            line += f' เป้าหมาย{_target(metric,targets[metric])} {result}'
        lines.append(line)
    lines += ['',f"ณ วันที่จัดส่งรายงานนี้ มีเคสที่อยู่ระหว่างดำเนินการ {week['open_now']} เคส และเกินกำหนดเวลา {week['late_now']} เคส"]
    return '\n'.join(lines)


def run(cd, db, tenant_id, moment=None):
    """On Monday from SEND_HOUR, once: last week's summary to each active owner. Returns how many were queued."""
    from backend.modules.organization import repository as organization
    from backend.modules.staff_prefs import service as staff_prefs
    local = (moment or dt.datetime.now(dt.timezone.utc)).astimezone(WORK_TZ)
    if local.weekday()!=0 or local.hour<SEND_HOUR:
        return 0
    monday = local.date()
    row = db.execute('SELECT value FROM settings WHERE key=?',(KEY,)).fetchone()
    if row and row[0]==monday.isoformat():
        return 0
    bound = lambda day:iso(dt.datetime.combine(day,dt.time(),WORK_TZ).astimezone(dt.timezone.utc))
    start,previous = monday-dt.timedelta(days=7),monday-dt.timedelta(days=14)
    week,before = stats.summary(db,bound(start),bound(monday)),stats.summary(db,bound(previous),bound(start))
    db.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(KEY,monday.isoformat()))
    queued = 0
    if week['opened'] or before['opened'] or week['open_now']:
        name = (one(cd,'SELECT name FROM tenants WHERE id=?',(tenant_id,)) or {}).get('name','')
        detail = text(week,before,goals.saved(db)['org'],start,name)
        for member in organization.tenant_members(cd,tenant_id):
            if member['active'] and member['role']=='admin':
                staff_prefs.queue(db,member['id'],'weekly_report',subject(name,start),detail,'/reports',limit=3000)
                queued += 1
    db.commit()
    return queued
