"""What may be written on the board."""
import datetime as dt

from backend.modules.board.model import BODY_MAX, KINDS
from backend.utils.dates import iso
from backend.utils.validation import require


def note_form(body):
    """(kind, text, due_at or None) of a new note. A to-do's time is an ISO timestamp within a year from now."""
    kind,text,due = body.get('kind'),body.get('body',''),body.get('due_at')
    require(kind in KINDS,'ประเภทโน้ตไม่ถูกต้อง')
    require(isinstance(text,str),'ข้อความไม่ถูกต้อง')
    text = text.replace('\r\n','\n').strip()
    require(text,'กรุณาพิมพ์ข้อความก่อน')
    require(len(text)<=BODY_MAX,f'ข้อความยาวได้ไม่เกิน {BODY_MAX} ตัวอักษร')
    require(not any(ord(c)<32 and c not in '\n\t' for c in text),'ข้อความมีอักขระที่ใช้ไม่ได้')
    if due is None or kind=='handover':
        return kind,text,None
    require(isinstance(due,str) and len(due)<=40,'เวลาไม่ถูกต้อง')
    try:
        moment = dt.datetime.fromisoformat(due.replace('Z','+00:00'))
    except ValueError:
        require(False,'เวลาไม่ถูกต้อง')
    require(moment.tzinfo is not None,'เวลาต้องระบุเขตเวลา')
    moment = moment.astimezone(dt.timezone.utc)
    current = dt.datetime.now(dt.timezone.utc)
    require(current-dt.timedelta(days=1)<=moment<=current+dt.timedelta(days=366),'เวลาต้องอยู่ภายใน 1 ปีข้างหน้า')
    return kind,text,iso(moment.replace(microsecond=0))


def done_form(body):
    done = body.get('done')
    require(type(done) is bool,'สถานะงานไม่ถูกต้อง')
    return done
