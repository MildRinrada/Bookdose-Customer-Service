"""ขอคนเดิม: a customer - signed in or not - starting a new chat within DAYS of a finished case may ask for the member
who looked after them then. That member is the one on the case's thank-you card (automation/thanks.py: its owner,
else whoever finished it; the case's owner when the organization gives no cards), named as the card names them (their
alias when they chose one), and only while they are still an active member.

When that member is available now (their status, working hours and leave, and the app open within the last few
minutes, as the handing out of cases reads it: automation/distribution.py) the chat goes to them: into their team, the chatbot stands aside, and a case is opened owned by them - so they are told as for any case
given to them, and everyone sees whose it is. When they are not, the chat goes to the team as usual, and the customer is
told why. Either way the team sees the request on the chat.

  conversation_asked_member  (each organization's database) the member a chat asked for, their name as shown, and
                             whether it went to them ('given') or to the team ('away', with the reason)."""
from backend.database import audit, db as D
from backend.database.db import one
from backend.utils.dates import after, now

DAYS = 30

TABLE = '''
CREATE TABLE IF NOT EXISTS conversation_asked_member (
    conversation_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK(outcome IN ('given','away')), reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
'''


def account_contacts(db, account_id):
    """The contacts whose chats a signed-in customer reads in this organization."""
    return [row[0] for row in db.execute('SELECT contact_id FROM customer_contacts WHERE account_id=?',(account_id,))]


def _last_helper(cd, db, contact_ids):
    """(user_id, finished at) of the member who looked after these contacts' latest case finished within DAYS, while
    they are still an active member of the organization; else None."""
    from backend.modules.organization import repository as organization
    if not contact_ids:
        return None
    marks = ','.join('?'*len(contact_ids))
    row = one(db,f'''SELECT COALESCE((SELECT k.user_id FROM thanks_cards k WHERE k.ticket_id=t.id),t.assignee_id) AS user_id,t.resolved_at
                    FROM tickets t WHERE t.contact_id IN ({marks}) AND t.status IN ('resolved','closed') AND t.resolved_at>=?
                    AND (t.assignee_id IS NOT NULL OR EXISTS (SELECT 1 FROM thanks_cards k WHERE k.ticket_id=t.id))
                    ORDER BY t.resolved_at DESC LIMIT 1''',(*contact_ids,after(days=-DAYS)))
    if not row or not organization.find_active_membership(cd,D.tenant_id_of(db),row['user_id']):
        return None
    return row['user_id'],row['resolved_at']


def offer(cd, db, contact_ids):
    """What the start form offers: {'name', 'finished_at'} of the member the customer may ask for, or None."""
    from backend.modules.automation import thanks
    found = _last_helper(cd,db,contact_ids)
    return {'name':thanks.member_name(cd,found[0]),'finished_at':found[1]} if found else None


def ask(cd, db, conv_id, contact_ids, author):
    """The customer asked for the member of their last case, inside the transaction that just started the chat.
    Returns {'name', 'given'} for the customer's page (why a member is away is the team's business: a leave note is
    not the customer's to read), or None when there is nobody to ask for any more."""
    from backend.modules.ai import service as ai
    from backend.modules.automation import distribution, repository as automation, thanks
    from backend.modules.conversations import repository as conversations
    from backend.modules.customers import repository as customers
    from backend.modules.organization import repository as organization
    from backend.modules.staff_prefs import service as staff_prefs
    from backend.modules.tickets import repository as tickets, service as ticket_service
    from backend.realtime import events as realtime
    found = _last_helper(cd,db,contact_ids)
    if not found:
        return None
    user_id,name = found[0],thanks.member_name(cd,found[0])
    # Here means able to take it now and at work: as the handing out of cases reads it (automation/distribution.py).
    state = staff_prefs.availability_of(cd,[user_id])[user_id]
    seen = automation.last_seen(db).get(user_id) or ''
    reason = state['reason'] if not state['available'] else 'ไม่ได้เปิดโปรแกรมอยู่' if seen<after(minutes=-distribution.ACTIVE_MINUTES) else ''
    conv = conversations.find(db,conv_id)
    if not reason:
        membership = organization.find_active_membership(cd,D.tenant_id_of(db),user_id)
        # An owner answers every team; anyone else is given the chat in their own team, where they can see it.
        team = membership['team_id'] if membership['role']!='admin' and membership['team_id'] else conv['team_id']
        if team!=conv['team_id']:
            db.execute('UPDATE conversations SET team_id=? WHERE id=?',(team,conv_id))
        if ai.conversation_state(db,conv_id)['mode']=='bot':
            ai.stop_bot(db,conv_id,'member_asked')
        # A routing rule may have opened the case already, or given it elsewhere while opening it: the customer asked
        # for this member by name, and that is who it goes to.
        ticket = tickets.for_conversation(db,conv_id)
        if not ticket:
            ticket_id = ticket_service.open_ticket(db,conv['contact_id'],team,conv['subject'],'normal',assignee_id=user_id,
                                                   category=customers.category_of(db,conv_id) or 'ทั่วไป',conversation_id=conv_id)
            ticket = one(db,'SELECT * FROM tickets WHERE id=?',(ticket_id,))
        if (ticket['assignee_id'],ticket['team_id'])!=(user_id,team):
            tickets.update(db,ticket['id'],ticket['status'],ticket['priority'],team,user_id,ticket['resolved_at'])
            conversations.set_team_for_ticket(db,ticket['id'],team)
            realtime.ticket(db,ticket['id'],public=True,teams=(ticket['team_id'],),conversations_listed=True)
        ticket_service.notify_assigned(db,ticket,user_id)
    outcome = 'away' if reason else 'given'
    db.execute('INSERT OR REPLACE INTO conversation_asked_member VALUES(?,?,?,?,?,?)',(conv_id,user_id,name,outcome,reason,now()))
    # In the case's history when it went to them, else in the chat's.
    audit.record(db,author,'customer.asked_member',ticket['id'] if not reason else conv_id,
                 name+('' if not reason else f' ไม่อยู่ ({reason}) จึงส่งเข้าทีมตามปกติ'))
    return {'name':name,'given':outcome=='given'}


def of_conversation(db, conversation_id):
    """{'name', 'given', 'reason'} of the member this chat asked for, for the team's header; None when it did not."""
    row = one(db,'SELECT name,outcome,reason FROM conversation_asked_member WHERE conversation_id=?',(conversation_id,))
    return {'name':row['name'],'given':row['outcome']=='given','reason':row['reason']} if row else None
