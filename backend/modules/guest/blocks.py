"""บล็อกผู้ก่อกวน: an organization's owner stops a guest of guest web chat who keeps opening chats to make trouble.

A guest is known only by a cookie, and a cookie costs nothing to throw away, so a block holds two things:
- the guest (guest_blocks), with every browser and follow link of it: it can still read its chats, but it can no
  longer write, start a chat, rename itself, or ask for a follow link or a LINE code, until an owner lifts the block;
- the addresses it came from (guest_block_ips): nobody starts a new guest chat from them for IP_BLOCK_DAYS. An address
  is shared by a household, an office or a mobile network and changes hands, so it is held for days, not for ever,
  and whoever else it catches can still sign in and chat (a block never touches customer accounts).
Blocking closes the guest's open chats, so they leave the queue and the open list of the inbox. A loopback address is
never held: it is the server itself, or every browser at once behind a proxy that does not pass the real one on.

The address each guest chat was started from (guest_conversations.ip) is where the addresses come from. It also counts
the new chats of one address over a day (START_PER_IP_DAY, or START_PER_HOSTING_IP_DAY for an address of a cloud or a
VPN when the IP database is on, security/ip_intel.py), which a restart does not reset the way it resets the hourly
count kept in memory, and it is forgotten after IP_KEEP_DAYS."""
import ipaddress

from backend.database import audit, db as D
from backend.database.db import one, rows
from backend.modules.guest import repository
from backend.modules.guest.model import GUEST_NAME, IP_BLOCK_DAYS, IP_KEEP_DAYS, START_PER_HOSTING_IP_DAY, START_PER_IP_DAY
from backend.utils.dates import after, now
from backend.utils.security import uid
from backend.utils.validation import require

BLOCKED = 'ทีมงานปิดการแชทจากเบราว์เซอร์นี้แล้ว ส่งข้อความหรือเริ่มแชทใหม่ไม่ได้'
NETWORK_BLOCKED = 'ตอนนี้เริ่มแชทใหม่จากเครือข่ายนี้ไม่ได้ หากต้องการติดต่อทีมงาน กรุณาเข้าสู่ระบบด้วยบัญชีลูกค้า'
TOO_MANY_TODAY = 'มีการเริ่มแชทใหม่จากเครือข่ายนี้มากเกินไปในวันนี้ กรุณาคุยต่อในแชทเดิม หรือลองใหม่ภายหลัง'
NOT_GUEST = 'บล็อกได้เฉพาะแชทของลูกค้าที่ไม่ได้เข้าสู่ระบบ'
NOT_FOUND = 'ไม่พบรายการบล็อกนี้'
MAX_IPS = 20
# What a blocked guest may still do: let this browser forget it.
STILL_ALLOWED = ('/forget',)

TABLE = '''
CREATE TABLE IF NOT EXISTS guest_blocks (
    id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
    conversation_id TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '', blocked_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, ips_until TEXT
);
CREATE TABLE IF NOT EXISTS guest_block_ips (
    block_id TEXT NOT NULL, ip TEXT NOT NULL, until TEXT NOT NULL, PRIMARY KEY(block_id,ip)
);
CREATE INDEX IF NOT EXISTS guest_block_ips_ip ON guest_block_ips(ip,until);
'''


def upgrade(db):
    """The block tables, and the address on each guest chat (chats started before it have none)."""
    if 'ip' not in {row[1] for row in db.execute('PRAGMA table_info(guest_conversations)')}:
        db.execute("ALTER TABLE guest_conversations ADD COLUMN ip TEXT NOT NULL DEFAULT ''")
    db.execute('CREATE INDEX IF NOT EXISTS guest_conversations_ip ON guest_conversations(ip,created_at)')
    db.executescript(TABLE)


def held(ip):
    """The address in its canonical form when it may be held, else None (unknown, unspecified or loopback)."""
    try:
        found = ipaddress.ip_address(str(ip or '').strip())
    except ValueError:
        return None
    return None if found.is_loopback or found.is_unspecified else str(found)


def address(ip):
    """The address in its canonical form ('' when it is not one), as guest_conversations keeps it."""
    try:
        return str(ipaddress.ip_address(str(ip or '').strip()))
    except ValueError:
        return ''


# The guest's side
def visitor_blocked(db, visitor_id):
    return bool(one(db,'SELECT 1 FROM guest_blocks WHERE visitor_id=?',(visitor_id,)))


def check_start(db, guest, ip):
    """Before a new guest chat: the guest is not blocked, its address is not held, and the address has not started
    START_PER_IP_DAY chats in the last day."""
    if guest:
        require(not visitor_blocked(db,guest['visitor']['id']),BLOCKED,403)
    found = address(ip)
    if not found:
        return
    require(not one(db,'SELECT 1 FROM guest_block_ips WHERE ip=? AND until>?',(found,now())),NETWORK_BLOCKED,403)
    started = db.execute('SELECT COUNT(*) FROM guest_conversations WHERE ip=? AND created_at>=?',(found,after(days=-1))).fetchone()[0]
    # An address of a cloud or a VPN (the IP database, when on) has few real people behind it: a smaller day.
    from backend.modules.security import ip_intel
    info = ip_intel.lookup(found) if started>=START_PER_HOSTING_IP_DAY else None
    require(started<(START_PER_HOSTING_IP_DAY if info and info['hosting'] else START_PER_IP_DAY),TOO_MANY_TODAY,429)


def refuse(req, path):
    """A blocked guest's change (anything but a read, or letting this browser forget it) answers 403."""
    if req.command!='GET' and not path.endswith(STILL_ALLOWED) and visitor_blocked(req.db,req.guest['visitor']['id']):
        require(False,BLOCKED,403)


# The owner's side
def _view(row):
    if not row:
        return None
    moment = now()
    return {'id':row['id'],'name':row['name'] or GUEST_NAME,'subject':row['subject'],'blocked_by':row['blocked_by'],
            'created_at':row['created_at'],'network_until':row['ips_until'] if row['ips_until'] and row['ips_until']>moment else None,
            'conversation_id':row['live_conversation'] if 'live_conversation' in row.keys() else row['conversation_id']}


def state(db, conversation_id):
    """{'block': the block or None} when a guest (not merged into an account) started this conversation, else None."""
    visitor = repository.visitor_of_conversation(db,conversation_id)
    if not visitor:
        return None
    return {'block':_view(one(db,'SELECT * FROM guest_blocks WHERE visitor_id=?',(visitor['id'],)))}


def listing(db):
    """The organization's blocks, newest first; conversation_id is empty once that chat is gone."""
    return [_view(row) for row in rows(db,'''SELECT b.*,COALESCE(c.id,'') AS live_conversation FROM guest_blocks b
        LEFT JOIN conversations c ON c.id=b.conversation_id ORDER BY b.created_at DESC,b.rowid DESC LIMIT 200''')]


def _addresses(db, visitor_id):
    found = []
    for (ip,) in db.execute('''SELECT ip FROM guest_conversations WHERE visitor_id=? AND ip<>''
                               UNION SELECT ip FROM guest_devices WHERE visitor_id=? AND ip<>'' ''',(visitor_id,visitor_id)):
        kept = held(ip)
        if kept and kept not in found:
            found.append(kept)
    return found[:MAX_IPS]


def block(db, ctx, conv):
    """Block the guest who started this conversation: its open chats close and its addresses are held. Blocking a
    guest already blocked changes nothing. Returns {'block', 'closed'}."""
    from backend.modules.ai import service as ai
    from backend.modules.conversations import repository as conversations
    from backend.modules.guest import schema
    from backend.realtime import events as realtime
    visitor = repository.visitor_of_conversation(db,conv['id'])
    require(visitor,NOT_GUEST,409)
    D.begin(db)
    if visitor_blocked(db,visitor['id']):
        db.rollback()
        return {'block':state(db,conv['id'])['block'],'closed':0}
    block_id,addresses = uid(),_addresses(db,visitor['id'])
    until = after(days=IP_BLOCK_DAYS) if addresses else None
    db.execute('INSERT INTO guest_blocks(id,visitor_id,name,conversation_id,subject,blocked_by,created_at,ips_until) VALUES(?,?,?,?,?,?,?,?)',
               (block_id,visitor['id'],visitor['name'],conv['id'],conv['subject'],ctx['name'],now(),until))
    db.executemany('INSERT INTO guest_block_ips VALUES(?,?,?)',[(block_id,ip,until) for ip in addresses])
    open_ids = [row[0] for row in db.execute('''SELECT c.id FROM conversations c JOIN guest_conversations g ON g.conversation_id=c.id
                                                 WHERE g.visitor_id=? AND c.status='open' ''',(visitor['id'],))]
    for conversation_id in open_ids:
        conversations.set_status(db,conversation_id,'closed')
        ai.stop_bot(db,conversation_id)
        realtime.conversation(db,conversation_id)
    # Nothing more is sent to a guest the team no longer talks to.
    db.execute("UPDATE guest_notifications SET sent_at=?,error='off' WHERE visitor_id=? AND sent_at IS NULL",(now(),visitor['id']))
    audit.record(db,ctx['name'],'guest.blocked',conv['id'],
                 f"{schema.display_name(visitor)} ปิด {len(open_ids)} แชท กันเครือข่าย {len(addresses)} แห่งถึง {until[:10]}" if until
                 else f"{schema.display_name(visitor)} ปิด {len(open_ids)} แชท")
    db.commit()
    return {'block':state(db,conv['id'])['block'],'closed':len(open_ids)}


def _lift(db, ctx, row):
    db.execute('DELETE FROM guest_block_ips WHERE block_id=?',(row['id'],))
    db.execute('DELETE FROM guest_blocks WHERE id=?',(row['id'],))
    audit.record(db,ctx['name'],'guest.unblocked',row['conversation_id'] or row['visitor_id'],row['name'] or GUEST_NAME)


def unblock_conversation(db, ctx, conv):
    """Lift the block on the guest who started this conversation (its chats stay closed until the team opens one)."""
    visitor = repository.visitor_of_conversation(db,conv['id'])
    require(visitor,NOT_GUEST,409)
    D.begin(db)
    row = one(db,'SELECT * FROM guest_blocks WHERE visitor_id=?',(visitor['id'],))
    require(row,NOT_FOUND,404)
    _lift(db,ctx,row)
    db.commit()


def unblock(db, ctx, block_id):
    D.begin(db)
    row = one(db,'SELECT * FROM guest_blocks WHERE id=?',(block_id,))
    require(row,NOT_FOUND,404)
    _lift(db,ctx,row)
    db.commit()


def forget_visitor(db, visitor_id):
    """Staff deleted or erased the guest (its contact): the name and chat subject kept on its block go, as they may
    say who it was; the block stays until it is lifted."""
    db.execute("UPDATE guest_blocks SET name='',subject='' WHERE visitor_id=?",(visitor_id,))


def cleanup(db):
    """Held addresses whose days are over, and the addresses of chats started longer ago than IP_KEEP_DAYS, go."""
    db.execute('DELETE FROM guest_block_ips WHERE until<=?',(now(),))
    db.execute("UPDATE guest_conversations SET ip='' WHERE ip<>'' AND created_at<?",(after(days=-IP_KEEP_DAYS),))
