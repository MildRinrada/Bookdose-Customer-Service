"""What the services call where they change data. Each function works out, inside the caller's transaction, who may
know about the change, and queues the events on the connection: they are sent only after that transaction commits
(backend/database/db.py Connection.after_commit), and a rolled-back change sends nothing.

Who receives what (docs/REALTIME-DESIGN.md section 3):
  staff              members of the organization who may see the conversation or case: its team for agents, every
                     team for admins and managers (backend/middleware/access.py visible_team)
  customer accounts  the accounts owning the contact of a web conversation (customer_contacts), and for a case also
                     the owners of its web conversations (the same rules as customers/repository.py OWNED_CASE)
  guests             the guest who started a web conversation, until its history moved into an account
Internal notes, delivery states and staff-only case fields (priority, team, assignee, escalations) are published with
public=False and reach staff only.

Every function returns at once when no socket is open (and always under the legacy http.server), so nothing is
queried for nobody."""
import threading
import time
from pathlib import Path

from backend.database import db as D
from backend.realtime.hub import hub
from backend.utils.dates import now

TYPING_TTL_MS = 6000
SLUG_SECONDS = 60
_slugs = {}
_slugs_lock = threading.Lock()


# Building blocks
def changed(scope, org=None, entity_id=None):
    event = {'type':'changed','scope':scope}
    if entity_id is not None:
        event['id'] = entity_id
    if org is not None:
        event['org'] = org
    return event


def tenant_of(db):
    """The organization a tenant database connection belongs to (its file name)."""
    return Path(db.execute('PRAGMA database_list').fetchone()[2]).stem


def slug_of(tenant_id):
    """The organization's code (cached for a minute)."""
    moment = time.monotonic()
    with _slugs_lock:
        cached = _slugs.get(tenant_id)
        if cached and cached[1]>moment:
            return cached[0]
    with D.control() as cd:
        row = D.one(cd,'SELECT slug FROM tenants WHERE id=?',(tenant_id,))
    slug = row['slug'] if row else ''
    with _slugs_lock:
        _slugs[tenant_id] = (slug,moment+SLUG_SECONDS)
    return slug


def staff(tenant_id, *teams):
    return ('staff',tenant_id,frozenset(team for team in teams if team))


def queue(db, deliveries):
    """Send deliveries [(audience, payload)] once db's transaction commits; the same event twice is sent once."""
    for audience,payload in deliveries:
        key = ('realtime',audience,tuple(sorted((k,str(v)) for k,v in payload.items())))
        D.after_commit(db,key,lambda item=(audience,payload):hub.send([item]))


def owners(db, tenant_id, conv):
    """Audiences of the customer accounts and the guest owning a web conversation."""
    if not conv or conv['channel']!='web':
        return []
    from backend.modules.customers import repository as accounts
    from backend.modules.guest import repository as guests
    found = [('account',account_id) for account_id in accounts.owners_of_contact(db,conv['contact_id'])]
    visitor = guests.visitor_of_conversation(db,conv['id'])
    if visitor:
        found.append(('guest',tenant_id,visitor['id']))
    return found


# Changes
def conversation(db, conversation_id, public=True, listed=True, teams=()):
    """A conversation changed (a message, its status, CSAT, AI state, delivery). Staff who may see it get the
    conversation, the inbox list and its case; with public=True its customer accounts and guest get the conversation,
    their list, its case and (accounts) their alerts. teams: other teams that saw it until now (a move)."""
    if not hub.listening():
        return
    from backend.modules.conversations import repository as conversations
    from backend.modules.tickets import repository as tickets
    conv = conversations.find(db,conversation_id)
    if not conv:
        return
    tenant_id = tenant_of(db)
    org = slug_of(tenant_id)
    team = staff(tenant_id,conv['team_id'],*teams)
    ticket = tickets.for_conversation(db,conv['id'])
    out = [(team,changed('conversation',org,conv['id']))]
    if listed:
        out.append((team,changed('conversations',org)))
    if ticket:
        out += [(team,changed('ticket',org,ticket['id'])),(team,changed('tickets',org))]
    if public:
        for audience in owners(db,tenant_id,conv):
            out += [(audience,changed('conversation',org,conv['id'])),(audience,changed('conversations',org))]
            if ticket:
                out.append((audience,changed('ticket',org,ticket['id'])))
            if audience[0]=='account':
                out.append((audience,changed('alerts')))
    queue(db,out)


def ticket(db, ticket_id, public=False, teams=(), conversations_listed=False):
    """A case changed. Staff who may see it get the case and the case list (and the inbox list when its conversations
    moved team: conversations_listed); with public=True (a change the customer sees: opened, status, follow-up
    dates, deleted) the customer accounts and guests owning it get the case, their list and (accounts) alerts.
    Call it before deleting the case."""
    if not hub.listening():
        return
    from backend.modules.conversations import repository as conversations
    from backend.modules.customers import repository as accounts
    row = D.find_in_team(db,'tickets',ticket_id)
    if not row:
        return
    tenant_id = tenant_of(db)
    org = slug_of(tenant_id)
    team = staff(tenant_id,row['team_id'],*teams)
    out = [(team,changed('ticket',org,row['id'])),(team,changed('tickets',org))]
    if conversations_listed:
        out.append((team,changed('conversations',org)))
    if public:
        audiences = [('account',account_id) for account_id in accounts.owners_of_contact(db,row['contact_id'])]
        for conv in conversations.for_ticket(db,row['id']):
            audiences += [a for a in owners(db,tenant_id,conv) if a not in audiences]
        for audience in audiences:
            out += [(audience,changed('ticket',org,row['id'])),(audience,changed('conversations',org))]
            if audience[0]=='account':
                out.append((audience,changed('alerts')))
    queue(db,out)


def delivery(db, message_id):
    """The delivery state of a message on LINE / Email / Facebook changed: staff only."""
    if not hub.listening():
        return
    row = D.one(db,'SELECT conversation_id FROM messages WHERE id=?',(message_id,))
    if row:
        conversation(db,row['conversation_id'],public=False,listed=False)


# Read receipts
def customer_read(db, conversation_id, account_id=None, visitor_id=None):
    """A customer account (account_id) or guest (visitor_id) opens a web conversation: when that reads a team reply
    it had not read yet, staff who may see the conversation get {"type":"read","by":"customer"}. Call it before the
    new seen time is written."""
    if not hub.listening():
        return
    from backend.modules.conversations import repository as conversations
    if account_id:
        seen = D.one(db,'SELECT seen_at FROM customer_seen WHERE account_id=? AND conversation_id=?',(account_id,conversation_id))
    else:
        seen = D.one(db,'SELECT seen_at FROM guest_seen WHERE visitor_id=? AND conversation_id=?',(visitor_id,conversation_id))
    latest = conversations.last_message_at(db,conversation_id,'reply')
    # Timestamps have one-second precision: a reply and a read in the same second count as not read yet.
    if not latest or (seen and seen['seen_at']>latest):
        return
    conv = conversations.find(db,conversation_id)
    tenant_id = tenant_of(db)
    queue(db,[(staff(tenant_id,conv['team_id']),{'type':'read','conversation_id':conv['id'],'org':slug_of(tenant_id),
                                               'by':'customer','at':now()})])


def staff_read(db, conv, at):
    """A staff member opened a web conversation after the customer's last message (conversations/service.py
    mark_read): its customer accounts and guest get {"type":"read","by":"staff"}."""
    if not hub.listening():
        return
    tenant_id = tenant_of(db)
    event = {'type':'read','conversation_id':conv['id'],'org':slug_of(tenant_id),'by':'staff','at':at}
    queue(db,[(audience,event) for audience in owners(db,tenant_id,conv)])


# Typing (socket.py checks who may type in the conversation first)
def typing(conv, org, who, name):
    return {'type':'typing','conversation_id':conv['id'],'org':org,'who':who,'name':name,'ttl_ms':TYPING_TTL_MS}


def staff_typing(db, conv, name):
    """Deliveries of a staff member's typing: the conversation's customer accounts and guest."""
    tenant_id = tenant_of(db)
    event = typing(conv,slug_of(tenant_id),'staff',name)
    return [(audience,event) for audience in owners(db,tenant_id,conv)]


def customer_typing(db, conv, name):
    """Deliveries of a customer's or guest's typing: staff who may see the conversation."""
    tenant_id = tenant_of(db)
    return [(staff(tenant_id,conv['team_id']),typing(conv,slug_of(tenant_id),'customer',name))]


# Who on the team has the conversation open (socket.py checks that the sender may reply in it first)
#
# Two members answering the same customer at the same time is not a data problem - both replies are valid and both
# are sent - so nothing here blocks anything. It is a knowing problem: the second member never learns that the first
# one is already on it. The page that has the conversation open says so every 15 seconds, and writing in it says so
# at once, so the other side of the room can see it before typing the same answer.
#
# The sender's own socket hears its own event: the hub delivers to an audience, not to particular sockets. The page
# leaves itself out by user_id, which is also what makes one member with two browsers open count as one person.
PRESENCE_TTL_MS = 25000


def staff_here(db, conv, user_id, name, writing):
    """A member has this conversation open (writing: and is writing in it). Every member who may see it hears."""
    tenant_id = tenant_of(db)
    return [(staff(tenant_id,conv['team_id']),
             {'type':'here','conversation_id':conv['id'],'org':slug_of(tenant_id),'user_id':user_id,'name':name,
              'typing':bool(writing),'ttl_ms':PRESENCE_TTL_MS,'typing_ms':TYPING_TTL_MS})]
