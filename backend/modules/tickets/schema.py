"""Case form validation and the CSV export format."""
import csv
import datetime as dt
import io

from backend.modules.tickets.model import PRIORITIES, SNOOZE_MAX_DAYS, SNOOZE_NOTE_MAX, STATUSES
from backend.utils.dates import iso, utc_now
from backend.utils.validation import require, field

EXCEL_UTF8_BOM = '\ufeff'
CSV_HEADER = ['Case','Subject','Customer','Status','Priority','Category','Created at','First response at','Resolved at','Tags']


def new_ticket(body):
    """(subject, contact id)"""
    return field(body,'subject',300),field(body,'contact_id',32)


def priority(body):
    value = body.get('priority','normal')
    require(value in PRIORITIES,'ความเร่งด่วนไม่ถูกต้อง')
    return value


def category(body):
    return field(body,'category',80,False) or 'ทั่วไป'


def ticket_update(body, ticket):
    """(status, priority, team id, assignee id); fields left out keep the case's current value."""
    status = body.get('status',ticket['status'])
    priority_value = body.get('priority',ticket['priority'])
    team_id = body.get('team_id',ticket['team_id'])
    assignee = body.get('assignee_id',ticket['assignee_id']) or None
    require(status in STATUSES and priority_value in PRIORITIES,'สถานะหรือความเร่งด่วนไม่ถูกต้อง')
    return status,priority_value,team_id,assignee


def snooze_form(body):
    """(when it comes back as a UTC timestamp, why). The browser sends the moment it worked out from the member's own
    clock - "พรุ่งนี้ 9 โมง" is nine in the morning where they are, and only their browser knows where that is."""
    text = field(body,'until',40)
    try:
        moment = dt.datetime.fromisoformat(text.replace('Z','+00:00'))
    except ValueError:
        moment = None
    require(moment is not None and moment.tzinfo is not None,'เวลาที่เลือกไม่ถูกต้อง')
    moment = moment.astimezone(dt.timezone.utc)
    now = utc_now()
    require(moment>now,'เวลาที่เลือกผ่านไปแล้ว กรุณาเลือกเวลาข้างหน้า')
    require(moment<=now+dt.timedelta(days=SNOOZE_MAX_DAYS),f'พักเคสได้ไม่เกิน {SNOOZE_MAX_DAYS} วัน')
    return iso(moment),field(body,'note',SNOOZE_NOTE_MAX,False)


def tickets_csv(records):
    """UTF-8 CSV with a BOM for Excel. Cells a spreadsheet would run as formulas are prefixed with '."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(CSV_HEADER)
    for record in records:
        values = [str(v) if v is not None else '' for v in record.values()]
        writer.writerow(["'"+v if v.lstrip().startswith(('=','+','-','@')) or v.startswith(('\t','\r','\n')) else v for v in values])
    return (EXCEL_UTF8_BOM+output.getvalue()).encode()
