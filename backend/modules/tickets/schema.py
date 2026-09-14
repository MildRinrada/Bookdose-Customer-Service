"""Case form validation and the CSV export format."""
import csv
import io

from backend.modules.tickets.model import PRIORITIES, STATUSES
from backend.utils.validation import require, field

EXCEL_UTF8_BOM = '\ufeff'
CSV_HEADER = ['Case','Subject','Customer','Status','Priority','Category','Created at','First response at','Resolved at']


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


def tickets_csv(records):
    """UTF-8 CSV with a BOM for Excel. Cells a spreadsheet would run as formulas are prefixed with '."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(CSV_HEADER)
    for record in records:
        values = [str(v) if v is not None else '' for v in record.values()]
        writer.writerow(["'"+v if v.lstrip().startswith(('=','+','-','@')) or v.startswith(('\t','\r','\n')) else v for v in values])
    return (EXCEL_UTF8_BOM+output.getvalue()).encode()
