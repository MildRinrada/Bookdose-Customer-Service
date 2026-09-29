"""คุยต่อบนมือถือ: a guest chatting on a computer shows a QR code and scans it with their phone; the same chat opens on
the phone at once, without an account, so a photo taken there goes straight into it.

The QR holds a follow link like the ones sent by email or SMS (/support/<org>/resume#t=<token>, service.resume), but
of its own kind: it opens the chat that was on screen, works once and for MINUTES only (it is on a screen, where
somebody else may see it), and a newer one replaces it. Opening it proves nothing about the guest's email or phone.
Only the token's hash is kept."""
import secrets

from backend.database import audit, db as D
from backend.database.db import one
from backend.utils.dates import after, now
from backend.utils.security import token_hash
from backend.utils.validation import require

MINUTES = 10
PER_VISITOR_15_MIN = 10

TABLE = '''
CREATE TABLE IF NOT EXISTS guest_handoffs (
    token_hash TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
);
CREATE INDEX IF NOT EXISTS guest_handoffs_visitor ON guest_handoffs(visitor_id);
'''


def create(db, org, guest, conv, base):
    """POST /guest/handoff (X-Conversation-ID): a QR link for this chat. Returns {url, qr, expires_at}."""
    from backend.modules.guest import schema, service
    from backend.utils import qrcode
    require(conv,'เปิดแชทก่อน',404)
    token = secrets.token_urlsafe(32)
    expires_at = after(minutes=MINUTES)
    visitor = guest['visitor']
    D.begin(db)
    # Only the newest QR works: one left on a screen stops working when another is shown.
    db.execute('DELETE FROM guest_handoffs WHERE visitor_id=? OR expires_at<=?',(visitor['id'],now()))
    db.execute('INSERT INTO guest_handoffs VALUES(?,?,?,?,?,NULL)',(token_hash(token),visitor['id'],conv['id'],now(),expires_at))
    audit.record(db,schema.display_name(visitor),'guest.handoff_shown',visitor['contact_id'])
    db.commit()
    url = service._follow_url(base,org['slug'],token)
    return {'url':url,'qr':qrcode.data_url(url,'QR คุยต่อบนมือถือ'),'expires_at':expires_at}


def take(db, hashed):
    """The QR link behind this token, used up now (inside the caller's transaction), shaped like a follow link; None when
    it is not one, was used, or has run out."""
    row = one(db,'SELECT * FROM guest_handoffs WHERE token_hash=? AND used_at IS NULL AND expires_at>?',(hashed,now()))
    if not row:
        return None
    db.execute('UPDATE guest_handoffs SET used_at=? WHERE token_hash=?',(now(),hashed))
    return {'token_hash':hashed,'visitor_id':row['visitor_id'],'via':'qr','target':'','conversation_id':row['conversation_id']}
