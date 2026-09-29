"""ไม่รีบ: a customer waiting for the team - signed in or not - says a reply tomorrow is fine. Their wait goes behind the
customers who did not say so (the queue on the chat pages, รับงานถัดไป, แชทรอตอบ), and the promise moves with it: the
case's first-reply deadline becomes the end of the next working day - the closing time of the organization's next open
day when it set its hours (organization/hours.py), else 18:00 Thai time tomorrow - never earlier than it was, so the
team is not late for taking the customer at their word. The resolution deadline is never left before it.

- It holds for the wait it was said in: from the customer's first unanswered message until a member replies
  (conversations/queue.py), and while its deadline is ahead. Writing more in the same wait keeps it.
- The customer may take it back while it holds: a deadline it moved goes back, unless something changed it since.
- A case opened later in the same wait keeps the promise (tickets.service.open_ticket), and so does a change of
  priority (tickets/sla.follow_priority).

  conversation_no_rush  (each organization's database) one row per chat: the wait it is for (the rowid of its first
                        message), the reply promised by, and the case deadlines it replaced."""
import datetime as dt

from backend.database import audit, db as D
from backend.database.db import one, rows
from backend.modules.organization import hours
from backend.utils.dates import iso, now, utc_now
from backend.utils.validation import require

END_OF_DAY = dt.time(18,0)
DONE = ('resolved','closed')

TABLE = '''
CREATE TABLE IF NOT EXISTS conversation_no_rush (
    conversation_id TEXT PRIMARY KEY, since_rowid INTEGER NOT NULL, until TEXT NOT NULL, ticket_id TEXT,
    first_due_before TEXT, resolution_due_before TEXT, created_at TEXT NOT NULL
);
'''


def _active_clause():
    """The row still holds: its deadline ahead, and no member has replied since its wait began."""
    from backend.modules.conversations.queue import HUMAN_REPLY
    return f'''n.until>? AND NOT EXISTS (SELECT 1 FROM messages r WHERE r.conversation_id=n.conversation_id
               AND r.rowid>=n.since_rowid AND {HUMAN_REPLY})'''


def active_map(db):
    """{conversation_id: reply promised by} of the chats whose wait is ไม่รีบ now."""
    return {r['conversation_id']:r['until'] for r in rows(db,f'SELECT n.conversation_id,n.until FROM conversation_no_rush n WHERE {_active_clause()}',(now(),))}


def _active(db, conversation_id):
    return one(db,f'SELECT n.* FROM conversation_no_rush n WHERE n.conversation_id=? AND {_active_clause()}',(conversation_id,now()))


def ticket_order():
    """SQL (one parameter: now) that is 1 for a case whose chat is waiting ไม่รีบ, for ordering cases (tickets
    repository; the case table as `tickets`)."""
    return f'''EXISTS (SELECT 1 FROM ticket_conversations tc JOIN conversation_no_rush n ON n.conversation_id=tc.conversation_id
               WHERE tc.ticket_id=tickets.id AND {_active_clause()})'''


def deadline(db, moment=None):
    """The reply promised to a customer who says ไม่รีบ at `moment` (UTC)."""
    moment = moment or utc_now()
    cfg = hours.config(db)
    if (cfg.get('enabled') or cfg.get('sla')) and any(cfg['days']):
        closing = hours.next_day_close(cfg,moment)
        if closing:
            return closing.astimezone(dt.timezone.utc)
    tomorrow = moment.astimezone(hours.TZ).date()+dt.timedelta(days=1)
    return dt.datetime.combine(tomorrow,END_OF_DAY,hours.TZ).astimezone(dt.timezone.utc)


def text(until):
    """"พรุ่งนี้ 18:00 น.", "วันจันทร์ 17:30 น." (Thai time)."""
    return hours.when_text(dt.datetime.fromisoformat(until),utc_now())+' น.'


def state(db, conversation_id):
    """{'until', 'text'} while this chat's wait is ไม่รีบ, else None."""
    row = _active(db,conversation_id)
    return {'until':row['until'],'text':text(row['until'])} if row else None


def _set(first_before, resolution_before, until):
    """(first reply due, resolution due) of a case once the promise is kept."""
    first = max(first_before,until)
    return first,max(resolution_before,first)


def _extend(db, row, ticket_id):
    """The case keeps the promise: its deadlines move to it (never earlier), and the ones they replace are kept."""
    ticket = one(db,'SELECT * FROM tickets WHERE id=?',(ticket_id,)) if ticket_id else None
    if not ticket or ticket['first_response_at'] or ticket['status'] in DONE:
        return
    first,resolution = _set(ticket['first_response_due_at'],ticket['resolution_due_at'],row['until'])
    db.execute('UPDATE tickets SET first_response_due_at=?,resolution_due_at=? WHERE id=?',(first,resolution,ticket['id']))
    db.execute('UPDATE conversation_no_rush SET ticket_id=?,first_due_before=?,resolution_due_before=? WHERE conversation_id=?',
               (ticket['id'],ticket['first_response_due_at'],ticket['resolution_due_at'],row['conversation_id']))


def _restore(db, row):
    """Taken back: the deadlines it moved go back, when nothing changed them since."""
    ticket = one(db,'SELECT * FROM tickets WHERE id=?',(row['ticket_id'],)) if row['ticket_id'] else None
    if not ticket or not row['first_due_before'] or ticket['first_response_at']:
        return
    if (ticket['first_response_due_at'],ticket['resolution_due_at'])==_set(row['first_due_before'],row['resolution_due_before'],row['until']):
        db.execute('UPDATE tickets SET first_response_due_at=?,resolution_due_at=? WHERE id=?',
                   (row['first_due_before'],row['resolution_due_before'],ticket['id']))


def apply_to_ticket(db, ticket_id, conversation_id):
    """A case was just opened from this chat (inside the caller's transaction): a promise the customer holds is kept."""
    row = _active(db,conversation_id)
    if row:
        _extend(db,row,ticket_id)


def floor(db, ticket_id):
    """After the case's deadlines were worked out again (a change of priority): a promise its chats hold still stands."""
    for row in rows(db,f'''SELECT n.* FROM conversation_no_rush n JOIN ticket_conversations tc ON tc.conversation_id=n.conversation_id
                          WHERE tc.ticket_id=? AND {_active_clause()}''',(ticket_id,now())):
        _extend(db,row,ticket_id)


def of_ticket(db, ticket_id):
    """{'until', 'text'} when one of the case's chats is waiting ไม่รีบ, else None (the case page says why its deadline moved)."""
    row = one(db,f'''SELECT n.until FROM conversation_no_rush n JOIN ticket_conversations tc ON tc.conversation_id=n.conversation_id
                    WHERE tc.ticket_id=? AND {_active_clause()} ORDER BY n.until DESC LIMIT 1''',(ticket_id,now()))
    return {'until':row['until'],'text':text(row['until'])} if row else None


def request(db, conv, author, body):
    """POST …/no-rush {on: true} while the customer waits for the team, {on: false} to take it back."""
    from backend.modules.conversations import queue
    from backend.modules.tickets import repository as tickets
    from backend.realtime import events as realtime
    body = body if isinstance(body,dict) else {}
    on = body.get('on')
    require(isinstance(on,bool),'ข้อมูลไม่ถูกต้อง')
    D.begin(db)
    current = _active(db,conv['id'])
    ticket = tickets.for_conversation(db,conv['id'])
    subject = ticket['id'] if ticket else conv['id']
    if on and not current:
        wait = queue._waiting(db,conv['id'])
        require(wait,'ตอนนี้ไม่ได้รอทีมงานอยู่',409)
        until = iso(deadline(db))
        db.execute('''INSERT OR REPLACE INTO conversation_no_rush(conversation_id,since_rowid,until,ticket_id,first_due_before,
                      resolution_due_before,created_at) VALUES(?,?,?,NULL,NULL,NULL,?)''',(conv['id'],wait[0]['n'],until,now()))
        _extend(db,_active(db,conv['id']),ticket['id'] if ticket else None)
        audit.record(db,author,'ticket.no_rush',subject,f'ตอบได้ถึง {text(until)}')
    elif not on and current:
        _restore(db,current)
        db.execute('DELETE FROM conversation_no_rush WHERE conversation_id=?',(conv['id'],))
        audit.record(db,author,'ticket.no_rush_off',subject,'')
    realtime.conversation(db,conv['id'])
    if ticket:
        realtime.ticket(db,ticket['id'])
    db.commit()
    return {'no_rush':state(db,conv['id'])}
