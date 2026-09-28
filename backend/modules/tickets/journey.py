"""เส้นทางเคส: where a case has been and when, for the customer's case page - รับเรื่อง → กำลังดูแล → รอคุณ → เสร็จ, like
tracking a parcel, with the time of each step - so a customer sees that their case is moving without asking.

A status changes in many places (a member, the team's first reply, the customer writing again, the quiet close, a
macro, the assistant, a late LINE event put back), so the database logs every change itself (a trigger on tickets)
rather than each of them remembering to. The customer reads the log in their own words (lib/labels caseState): a case
waiting on a colleague is still being looked after, so only changes they would see make a step.

  ticket_status_log  each change of a case's status and when it happened (the case's updated_at when the change set
                     it, else the moment of the change)."""
import json

from backend.database.db import rows

# The customer's four steps (frontend lib/labels caseState): what each status reads as to them.
STATES = {'new':'received','open':'working','pending_internal':'working','pending_customer':'waiting',
          'resolved':'done','closed':'done'}

TABLE = '''
CREATE TABLE IF NOT EXISTS ticket_status_log (
    id INTEGER PRIMARY KEY, ticket_id TEXT NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ticket_status_log_ticket ON ticket_status_log(ticket_id,at);
CREATE TRIGGER IF NOT EXISTS ticket_status_logged AFTER UPDATE OF status ON tickets WHEN NEW.status IS NOT OLD.status
BEGIN
    INSERT INTO ticket_status_log(ticket_id,status,at) VALUES(NEW.id,NEW.status,
        CASE WHEN NEW.updated_at IS NOT OLD.updated_at THEN NEW.updated_at
             ELSE strftime('%Y-%m-%dT%H:%M:%S+00:00','now') END);
END;
'''


def forget_after(db, ticket_id, since):
    """Changes put back in the same transaction (a late LINE event, channels/service.py) never happened: the entries
    after `since` (tickets.repository.states_for_conversation's log_mark) go."""
    db.execute('DELETE FROM ticket_status_log WHERE ticket_id=? AND id>?',(ticket_id,since))


def of(db, ticket):
    """[{'state', 'at'}] of the case as its customer reads it, oldest first: รับเรื่อง when it was opened, then each
    change of what the customer sees (the first time of each). A case from before the log, or one the log missed,
    ends at where it stands now."""
    found = [{'state':'received','at':ticket['created_at']}]
    for r in rows(db,'SELECT status,at FROM ticket_status_log WHERE ticket_id=? ORDER BY at,id',(ticket['id'],)):
        state = STATES.get(r['status'],'working')
        if state!=found[-1]['state']:
            found.append({'state':state,'at':max(r['at'],found[-1]['at'])})
    current = STATES.get(ticket['status'],'working')
    if current!=found[-1]['state']:
        at = ticket['resolved_at'] if current=='done' and ticket.get('resolved_at') else ticket['updated_at']
        found.append({'state':current,'at':max(at,found[-1]['at'])})
    return found


def backfill(db):
    """Once, when the log is new: what the cases already say about their past - the team's first reply (the work
    began), the members' status changes in the activity log, the customers' replies that reopened a case, and when a
    finished case was finished. A wait for the customer set by anything but a member was not recorded anywhere, so
    older cases may show fewer steps than they had."""
    if db.execute("SELECT 1 FROM settings WHERE key='status_log_backfilled'").fetchone():
        return
    cases = {r[0]:r for r in db.execute('SELECT id,status,first_response_at,resolved_at,created_at FROM tickets')}
    logged = {r[0] for r in db.execute('SELECT DISTINCT ticket_id FROM ticket_status_log')}
    events = {}
    for case_id,status,first,resolved,_ in cases.values():
        # A case still new was answered before the first reply started work (tickets.repository STARTED): not begun.
        if first and status!='new':
            events.setdefault(case_id,[]).append((first,'open'))
        if resolved and status in ('resolved','closed'):
            events.setdefault(case_id,[]).append((resolved,status))
    for entity,detail,at in db.execute("SELECT entity,detail,created_at FROM audit_logs WHERE action='ticket.updated'"):
        try:
            change = json.loads(detail or '{}').get('status') or {}
        except (ValueError,AttributeError):
            continue
        if entity in cases and isinstance(change,dict) and change.get('after') in STATES:
            events.setdefault(entity,[]).append((at,change['after']))
    for case_id,at in db.execute("SELECT ticket_id,reopened_at FROM ticket_reopens WHERE cause<>'staff'"):
        if case_id in cases:
            events.setdefault(case_id,[]).append((at,'open'))
    for case_id,found in events.items():
        if case_id in logged:
            continue
        db.executemany('INSERT INTO ticket_status_log(ticket_id,status,at) VALUES(?,?,?)',
                       [(case_id,status,max(at,cases[case_id][4])) for at,status in sorted(found)])
    db.execute("INSERT OR IGNORE INTO settings VALUES('status_log_backfilled','1')")
