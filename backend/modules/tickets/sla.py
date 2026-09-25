"""SLA targets by priority: an urgent case can be promised a faster reply than a question that can wait. ปกติ is the
organization's SLA hours (response_hours / resolution_hours); เร่งด่วน, สูง and ต่ำ may each have their own, and one
left empty follows ปกติ. The clock itself is organization/hours.sla_due (straight through, or opening time only).

A case whose priority changes - by a routing rule the moment it opens, or by a member later - is measured again from
when it was opened, under the new priority's targets. A first response already given keeps the deadline it was met
or missed against."""
import datetime as dt
import json

from backend.modules.organization import hours
from backend.modules.tickets.model import PRIORITIES
from backend.utils.dates import iso
from backend.utils.validation import require

KEY = 'sla_by_priority'
OWN = ('urgent','high','low')          # the priorities that may have targets of their own; normal is the base
HOURS_MIN,HOURS_MAX = 0.25,8760


def _hours(value):
    try:
        number = float(value)
    except (TypeError,ValueError):
        return None
    return number if HOURS_MIN<=number<=HOURS_MAX else None


def saved(db):
    """{priority: {'response': hours or None, 'resolution': hours or None}} as the owner set them (None: as ปกติ)."""
    row = db.execute('SELECT value FROM settings WHERE key=?',(KEY,)).fetchone()
    try:
        value = json.loads(row[0]) if row and row[0] else {}
    except ValueError:
        value = {}
    value = value if isinstance(value,dict) else {}
    return {p:{k:_hours((value.get(p) or {}).get(k)) if isinstance(value.get(p),dict) else None for k in ('response','resolution')}
            for p in OWN}


def form(body):
    """The owner's targets per priority from the SLA form: an empty field follows ปกติ."""
    items = body.get(KEY) or {}
    require(isinstance(items,dict),'ข้อมูล SLA ตามความเร่งด่วนไม่ถูกต้อง')
    found = {}
    for priority in OWN:
        item = items.get(priority) or {}
        require(isinstance(item,dict),'ข้อมูล SLA ตามความเร่งด่วนไม่ถูกต้อง')
        found[priority] = {}
        for key in ('response','resolution'):
            raw = item.get(key)
            if raw in (None,''):
                found[priority][key] = None
                continue
            number = _hours(raw)
            require(number is not None,f'SLA ต้องอยู่ระหว่าง {HOURS_MIN}-{HOURS_MAX:,} ชั่วโมง')
            found[priority][key] = number
    return found


def targets(db, priority):
    """(first response hours, resolution hours) of a case of this priority."""
    settings = dict(db.execute("SELECT key,value FROM settings WHERE key IN ('response_hours','resolution_hours')").fetchall())
    base = (float(settings['response_hours']),float(settings['resolution_hours']))
    own = saved(db).get(priority) if priority in PRIORITIES else None
    if not own:
        return base
    return (own['response'] or base[0],own['resolution'] or base[1])


def deadlines(db, priority, start):
    """(first response due, resolution due) as ISO timestamps for a case of `priority` opened at `start`."""
    response,resolution = targets(db,priority)
    return iso(hours.sla_due(db,start,response)),iso(hours.sla_due(db,start,resolution))


def follow_priority(db, ticket_id):
    """After a priority change: the deadlines again from when the case was opened, under the new targets."""
    case = db.execute('SELECT priority,created_at,first_response_at FROM tickets WHERE id=?',(ticket_id,)).fetchone()
    if not case:
        return
    response,resolution = deadlines(db,case['priority'],dt.datetime.fromisoformat(case['created_at']))
    if case['first_response_at']:
        db.execute('UPDATE tickets SET resolution_due_at=? WHERE id=?',(resolution,ticket_id))
    else:
        db.execute('UPDATE tickets SET first_response_due_at=?,resolution_due_at=? WHERE id=?',(response,resolution,ticket_id))
