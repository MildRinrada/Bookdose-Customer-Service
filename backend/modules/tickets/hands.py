"""ยกมือขอช่วย: a member stuck on a case raises their hand on it, and the people who can help see it at once - the
case's team and the organization's owners - on the case, in the case lists, in the bell and, when they asked for it,
as a desktop notification and a sound. Nobody has to go and ask in another chat, and the question stays with the case.

One hand per case at a time. Somebody who comes to help says so (เข้าไปช่วย), and the one who asked sees who is on the
way. The hand comes down when the one who raised it, the helper, the case's owner or an owner of the organization
lowers it, or by itself when the case is finished.

  help_requests  (each organization's database) one row per hand: who raised it and why, who came, when it came down.
                 Kept after it is lowered: เหรียญ มือช่วยของทีม counts the times a member came to help."""
import json

from backend.database import audit
from backend.database.db import begin, one, rows
from backend.exceptions.errors import APIError
from backend.middleware.access import get_scoped
from backend.realtime import events as realtime
from backend.utils.dates import now
from backend.utils.security import uid
from backend.utils.validation import require

NOTE_MAX = 200
DONE = ('resolved','closed')

TABLE = '''
CREATE TABLE IF NOT EXISTS help_requests (
    id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, raised_by TEXT NOT NULL, raised_name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '', raised_at TEXT NOT NULL, helper_id TEXT, helper_name TEXT NOT NULL DEFAULT '',
    helped_at TEXT, lowered_at TEXT, lowered_by TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS help_requests_open ON help_requests(ticket_id) WHERE lowered_at IS NULL;
CREATE INDEX IF NOT EXISTS help_requests_helper ON help_requests(helper_id);
'''

# The open hand of each case in the case list (repository.list_with_contacts), as JSON.
COLUMN = '''(SELECT json_object('id',h.id,'raised_by',h.raised_by,'raised_name',h.raised_name,'note',h.note,'raised_at',h.raised_at,
             'helper_id',h.helper_id,'helper_name',h.helper_name) FROM help_requests h
             WHERE h.ticket_id=t.id AND h.lowered_at IS NULL) AS hand'''

FIELDS = 'id,ticket_id,raised_by,raised_name,note,raised_at,helper_id,helper_name,helped_at'


def parse(value):
    """The list column as a dict, or None."""
    return json.loads(value) if value else None


def open_for(db, ticket_id):
    return one(db,f'SELECT {FIELDS} FROM help_requests WHERE ticket_id=? AND lowered_at IS NULL',(ticket_id,))


def _note(body):
    note = body.get('note','')
    require(isinstance(note,str),'ข้อความไม่ถูกต้อง')
    note = ' '.join(note.split())
    require(len(note)<=NOTE_MAX,f'บอกเรื่องที่ติดได้ไม่เกิน {NOTE_MAX} ตัวอักษร')
    return note


def _changed(db, ticket):
    realtime.ticket(db,ticket['id'],teams=(ticket['team_id'],),conversations_listed=True)


def raise_hand(db, ctx, ticket_id, body):
    note = _note(body)
    begin(db)
    ticket = get_scoped(db,'tickets',ticket_id,ctx)
    require(ticket['status'] not in DONE,'เคสนี้จบแล้ว ไม่ต้องขอความช่วยเหลือ')
    found = open_for(db,ticket['id'])
    require(not found,f"{found['raised_name'] if found else ''} ยกมือขอช่วยในเคสนี้อยู่แล้ว",409)
    db.execute('INSERT INTO help_requests(id,ticket_id,raised_by,raised_name,note,raised_at) VALUES(?,?,?,?,?,?)',
               (uid(),ticket['id'],ctx['id'],ctx['name'],note,now()))
    audit.record(db,ctx['name'],'ticket.hand_raised',ticket['id'],note)
    _changed(db,ticket)
    db.commit()
    return open_for(db,ticket['id'])


def _open(db, ctx, ticket_id):
    ticket = get_scoped(db,'tickets',ticket_id,ctx)
    found = open_for(db,ticket['id'])
    if not found:
        raise APIError(404,'ไม่มีใครยกมือขอช่วยในเคสนี้แล้ว')
    return ticket,found


def come_help(db, ctx, ticket_id):
    """เข้าไปช่วย: the one who asked sees who is coming."""
    begin(db)
    ticket,found = _open(db,ctx,ticket_id)
    require(found['raised_by']!=ctx['id'],'คุณเป็นคนยกมือเอง รอเพื่อนเข้ามาช่วยนะ')
    if found['helper_id']!=ctx['id']:
        db.execute('UPDATE help_requests SET helper_id=?,helper_name=?,helped_at=? WHERE id=?',(ctx['id'],ctx['name'],now(),found['id']))
        audit.record(db,ctx['name'],'ticket.hand_helped',ticket['id'],found['raised_name'])
        _changed(db,ticket)
    db.commit()
    return open_for(db,ticket['id'])


def lower(db, ctx, ticket_id):
    """เอามือลง: the one who raised it, the helper, the case's owner, or an owner of the organization."""
    begin(db)
    ticket,found = _open(db,ctx,ticket_id)
    require(ctx['id'] in (found['raised_by'],found['helper_id'],ticket['assignee_id']) or ctx['role']=='admin',
            'เอามือลงได้เฉพาะคนที่ยกมือ คนที่เข้าไปช่วย หรือผู้รับผิดชอบเคส',403)
    db.execute('UPDATE help_requests SET lowered_at=?,lowered_by=? WHERE id=?',(now(),ctx['name'],found['id']))
    audit.record(db,ctx['name'],'ticket.hand_lowered',ticket['id'],found['raised_name'])
    _changed(db,ticket)
    db.commit()


def lower_on_close(db, ticket_id, actor):
    """A finished case needs no help: its hand comes down with it (inside the caller's transaction)."""
    db.execute('UPDATE help_requests SET lowered_at=?,lowered_by=? WHERE ticket_id=? AND lowered_at IS NULL',(now(),actor,ticket_id))


def alerts(db, ctx, team_id=None):
    """For the bell: hands raised on the cases this member can see by somebody else ('ask'), and their own hand that
    somebody is coming to help with ('coming')."""
    where,params = ('AND t.team_id=?',[team_id]) if team_id is not None else ('',[])
    found = rows(db,f'''SELECT h.id,h.ticket_id,h.raised_by,h.raised_name,h.note,h.raised_at,h.helper_id,h.helper_name,h.helped_at,
                           t.number,t.subject FROM help_requests h JOIN tickets t ON t.id=h.ticket_id
                        WHERE h.lowered_at IS NULL AND t.status NOT IN {DONE} {where} ORDER BY h.raised_at DESC LIMIT 20''',params)
    for hand in found:
        hand['kind'] = 'coming' if hand['raised_by']==ctx['id'] else 'ask'
    return [h for h in found if h['kind']=='ask' or h['helper_id']]


def helped_count(db, user_id):
    return db.execute('SELECT COUNT(*) FROM help_requests WHERE helper_id=? AND raised_by!=?',(user_id,user_id)).fetchone()[0]
