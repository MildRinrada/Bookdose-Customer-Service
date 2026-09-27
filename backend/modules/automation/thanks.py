"""การ์ดขอบคุณหลังปิดเคส: when a case is finished, the customer who chatted on the web (the support page, the guest
chat, the customer page) finds a small card in the conversation - the name of the team member who looked after them,
their photo, and a thank-you - so they know a real person was on the other side.

Whether there is a card at all is the organization's choice (ระบบอัตโนมัติ → การ์ดขอบคุณ, off until an owner turns it
on): not every team wants its people shown. Within it, each member decides for themselves (ตั้งค่าบัญชี → ข้อมูลส่วนตัว):
whether customers see their photo - a person's photo is theirs, so the card shows their initials until they say so -
and a thank-you in their own words in place of the organization's. The name is the one the customer already sees on
their replies (the alias, when they chose one).

The card belongs to the case, not to a moment: it is worked out each time the customer's page asks, so a member who
takes their photo back, or an organization that turns the card off, is obeyed on every card already given. It shows
while the case stays finished and the customer has not written again since; LINE, email and Facebook get nothing
more than they did.

  thanks_cards  (each organization's database) one per case: its web conversation, the member it thanks (the case's
                owner, else whoever finished it) and when."""
import base64
import binascii

from backend.database import audit
from backend.database.db import one
from backend.exceptions.errors import APIError
from backend.modules.organization import repository as organization
from backend.utils.dates import now
from backend.utils.security import uid
from backend.utils.validation import require

DONE = ('resolved','closed')
MESSAGE_MAX = 200
DEFAULT_MESSAGE = 'ขอบคุณที่ให้เราได้ดูแลเรื่องนี้ ถ้ามีอะไรเพิ่มเติม ทักมาได้เสมอ'

TABLE = '''
CREATE TABLE IF NOT EXISTS thanks_cards (
    id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL UNIQUE, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS thanks_cards_conversation ON thanks_cards(conversation_id,created_at);
'''


def config(db):
    values = organization.settings(db)
    return {'enabled':values.get('thanks_enabled','0')=='1','message':values.get('thanks_message','') or DEFAULT_MESSAGE}


def on_close(db, ctx, ticket):
    """A case was just finished (automation.after_status_change, inside its transaction): its web conversation gets
    the card, for the case's owner or else the member who finished it. Finished again later, it moves to then."""
    if not config(db)['enabled']:
        return
    user_id = ticket['assignee_id'] or ctx.get('id')
    web = one(db,'''SELECT c.id FROM ticket_conversations tc JOIN conversations c ON c.id=tc.conversation_id
                    WHERE tc.ticket_id=? AND c.channel='web' ORDER BY c.updated_at DESC LIMIT 1''',(ticket['id'],))
    if not user_id or not web:
        return
    db.execute('''INSERT INTO thanks_cards(id,ticket_id,conversation_id,user_id,created_at) VALUES(?,?,?,?,?)
                  ON CONFLICT(ticket_id) DO UPDATE SET conversation_id=excluded.conversation_id,user_id=excluded.user_id,
                  created_at=excluded.created_at''',(uid(),ticket['id'],web['id'],user_id,now()))
    audit.record(db,ctx['name'],'ticket.thanks_card',ticket['id'],'')


def _person(cd, user_id):
    """(name the customer sees, whether they show their photo, their own thank-you) of a team member."""
    from backend.modules.staff_prefs import service as staff_prefs
    user = one(cd,'SELECT name FROM users WHERE id=?',(user_id,))
    prefs = staff_prefs.prefs_of(cd,user_id)
    photo = prefs['thanks']['photo'] and bool(one(cd,"SELECT 1 FROM user_profiles WHERE user_id=? AND avatar LIKE 'data:image/png;base64,%'",(user_id,)))
    return (prefs['alias'] or (user['name'] if user else 'ทีมงาน')),photo,prefs['thanks']['message']


def card_for(cd, db, conversation_id):
    """The card the customer sees at the end of this conversation now, or None."""
    cfg = config(db)
    if cd is None or not cfg['enabled']:
        return None
    card = one(db,'''SELECT k.id,k.user_id,k.created_at,t.number,t.status FROM thanks_cards k JOIN tickets t ON t.id=k.ticket_id
                     WHERE k.conversation_id=? ORDER BY k.created_at DESC LIMIT 1''',(conversation_id,))
    if not card or card['status'] not in DONE:
        return None
    if one(db,"SELECT 1 FROM messages WHERE conversation_id=? AND kind='customer' AND created_at>? LIMIT 1",(conversation_id,card['created_at'])):
        return None
    name,photo,message = _person(cd,card['user_id'])
    return {'id':card['id'],'name':name,'photo':photo,'message':message or cfg['message'],'case':card['number'],'created_at':card['created_at']}


def photo(cd, db, viewer, card_id):
    """The PNG of the member a card thanks: only for the customer whose conversation it is, only while the organization
    has cards and the member lets customers see their photo."""
    from backend.modules.auth import repository as users
    from backend.modules.portal import service as portal
    card = one(db,'SELECT conversation_id,user_id FROM thanks_cards WHERE id=?',(card_id,))
    require(card,'ไม่พบรูป',404)
    portal.owned_conversation(db,viewer,card['conversation_id'])
    require(config(db)['enabled'] and _person(cd,card['user_id'])[1],'ไม่พบรูป',404)
    stored = users.avatar_of(cd,card['user_id'])
    try:
        return base64.b64decode(stored.split(',',1)[1],validate=True)
    except (ValueError,IndexError,binascii.Error):
        raise APIError(404,'ไม่พบรูป') from None
