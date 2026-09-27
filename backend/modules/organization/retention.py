"""ระยะเวลาเก็บข้อมูล: an organization can choose to keep conversations only so long. A conversation quiet for longer
than `months` - no message since, and no case of it still being worked on - has what it said taken out: every
message's text (notes too), its attachments and their files, the AI's summary, mood reading and translations of it,
survey comments, its subject, and the subject of a finished case that has nothing else left. The rows stay, as the
PDPA tool leaves them (pdpa/service._erase_contact): case numbers, times and every report keep adding up, and a
cleared message shows as deleted "by the system". The customer record itself stays; the customer may still be one.

Nothing is taken out until WAIT_DAYS after it was turned on (and the owner sees what the first round would clear),
so a click aimed elsewhere can be taken back. A round clears at most BATCH conversations and runs at most once an
hour per organization (the automation worker)."""
import datetime as dt
import json
import threading
import time

from backend.database import audit, db as D
from backend.utils.dates import iso, now, utc_now
from backend.utils.validation import require

KEY = 'data_retention'
MONTHS = (6,12,24,36,60)
WAIT_DAYS = 7
BATCH = 200
ROUND_SECONDS = 3600
ACTOR = 'ระบบ (ครบระยะเวลาเก็บข้อมูล)'
CLEARED_SUBJECT = 'ลบเนื้อหาแล้วตามระยะเวลาเก็บข้อมูล'
DEFAULT = {'enabled':False,'months':24,'enabled_at':None}

TABLE = '''
CREATE TABLE IF NOT EXISTS retention_cleared (conversation_id TEXT PRIMARY KEY, cleared_at TEXT NOT NULL, files INTEGER NOT NULL DEFAULT 0);
'''

_last_round = {}
_lock = threading.Lock()


def config(db):
    row = db.execute('SELECT value FROM settings WHERE key=?',(KEY,)).fetchone()
    try:
        value = json.loads(row[0]) if row and row[0] else None
    except ValueError:
        value = None
    return {**DEFAULT,**value} if isinstance(value,dict) else dict(DEFAULT)


def starts_at(cfg):
    """When the first round may clear anything (ISO), or None while it is off."""
    if not cfg['enabled'] or not cfg['enabled_at']:
        return None
    return iso(dt.datetime.fromisoformat(cfg['enabled_at'])+dt.timedelta(days=WAIT_DAYS))


def _cutoff(months, moment):
    return iso(moment-dt.timedelta(days=round(months*365/12)))


def _due(db, months, moment, limit=None):
    """Conversations quiet since before the cutoff, not cleared yet, with no case of theirs still open."""
    sql = '''SELECT c.id FROM conversations c
             WHERE c.id NOT IN (SELECT conversation_id FROM retention_cleared)
               AND COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id=c.id),c.created_at)<?
               AND NOT EXISTS (SELECT 1 FROM ticket_conversations tc JOIN tickets t ON t.id=tc.ticket_id
                               WHERE tc.conversation_id=c.id AND t.status NOT IN ('resolved','closed'))
             ORDER BY c.created_at'''
    params = [_cutoff(months,moment)]
    if limit:
        sql += ' LIMIT ?'
        params.append(limit)
    return [r[0] for r in db.execute(sql,params).fetchall()]


def preview(db, months, moment=None):
    """What a round would clear now with `months`: conversations, files and their bytes."""
    ids = _due(db,months,moment or utc_now())
    if not ids:
        return {'conversations':0,'files':0,'bytes':0}
    marks = ','.join('?'*len(ids))
    files,size = db.execute(f'''SELECT COUNT(*),COALESCE(SUM(a.size),0) FROM attachments a JOIN messages m ON m.id=a.message_id
                                WHERE m.conversation_id IN ({marks})''',ids).fetchone()
    return {'conversations':len(ids),'files':files,'bytes':size}


def overview(db):
    cfg = config(db)
    cleared = db.execute('SELECT COUNT(*),COALESCE(SUM(files),0),MAX(cleared_at) FROM retention_cleared').fetchone()
    return {**cfg,'months_choices':list(MONTHS),'wait_days':WAIT_DAYS,'starts_at':starts_at(cfg),
            'preview':{str(m):preview(db,m) for m in MONTHS},
            'cleared':{'conversations':cleared[0],'files':cleared[1],'last_at':cleared[2]}}


def save(db, ctx, body):
    enabled,months = body.get('enabled'),body.get('months')
    require(type(enabled) is bool,'สถานะไม่ถูกต้อง')
    require(type(months) is int and months in MONTHS,'ระยะเวลาเก็บข้อมูลไม่ถูกต้อง')
    before = config(db)
    # The wait starts again when it is turned on, or made shorter (more would go).
    restart = enabled and (not before['enabled'] or months<before['months'])
    value = {'enabled':enabled,'months':months,'enabled_at':(now() if restart else before['enabled_at']) if enabled else None}
    db.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(KEY,json.dumps(value)))
    audit.record(db,ctx['name'],'settings.updated',ctx['tenant_id'],
                 f'เก็บบทสนทนา {months} เดือน แล้วลบเนื้อหา' if enabled else 'ปิดการลบเนื้อหาตามระยะเวลาเก็บข้อมูล')
    db.commit()
    return overview(db)


def due(tenant_id):
    """At most one round an hour per organization."""
    with _lock:
        moment = time.monotonic()
        if moment-_last_round.get(tenant_id,-ROUND_SECONDS)<ROUND_SECONDS:
            return False
        _last_round[tenant_id] = moment
        return True


def run(db, tenant_id, moment=None):
    """One round: clear up to BATCH conversations due. Returns how many were cleared."""
    cfg = config(db)
    moment = moment or utc_now()
    start = starts_at(cfg)
    if not start or iso(moment)<start:
        return 0
    D.begin(db)
    ids = _due(db,cfg['months'],moment,BATCH)
    files = []
    for conv in ids:
        files += _clear(db,conv,moment)
    if ids:
        audit.record(db,ACTOR,'retention.cleared',tenant_id,f"{len(ids)} บทสนทนา · ไฟล์แนบ {len(files)} ไฟล์ · เงียบเกิน {cfg['months']} เดือน")
    db.commit()
    # The files go once nothing points at them any more.
    for key in files:
        try:
            (D.DATA/'files'/tenant_id/key).unlink(missing_ok=True)
        except OSError:
            pass
    return len(ids)


def _clear(db, conv, moment):
    """Take the content out of one conversation (inside the round's transaction); returns its files' storage keys."""
    stamp = iso(moment)
    keys = []
    for message_id in [r[0] for r in db.execute('SELECT id FROM messages WHERE conversation_id=?',(conv,))]:
        keys += [r[0] for r in db.execute('SELECT storage_key FROM attachments WHERE message_id=?',(message_id,))]
        for table in ('channel_file_links','attachments','message_translations','mentions','channel_ai_guard'):
            db.execute(f'DELETE FROM {table} WHERE message_id=?',(message_id,))
        db.execute("UPDATE channel_outbox SET status='failed',error='changed' WHERE message_id=? AND status IN ('queued','sending')",(message_id,))
    db.execute("UPDATE messages SET body='',deleted_at=COALESCE(deleted_at,?),deleted_by=? WHERE conversation_id=?",(stamp,ACTOR,conv))
    db.execute('UPDATE conversations SET subject=? WHERE id=?',(CLEARED_SUBJECT,conv))
    for table in ('conversation_summaries','conversation_moods','conversation_languages','ai_jobs'):
        db.execute(f'DELETE FROM {table} WHERE conversation_id=?',(conv,))
    db.execute("UPDATE csat_surveys SET comment='' WHERE conversation_id=?",(conv,))
    # The customer's words on กำแพงคำชม are content of the conversation too.
    from backend.modules.kudos import service as kudos
    kudos.forget_conversations(db,[conv])
    db.execute('INSERT INTO retention_cleared VALUES(?,?,?)',(conv,stamp,len(keys)))
    # A finished case whose conversations are all cleared keeps its number and times, not its words.
    for ticket in [r[0] for r in db.execute('SELECT ticket_id FROM ticket_conversations WHERE conversation_id=?',(conv,))]:
        left = db.execute('''SELECT COUNT(*) FROM ticket_conversations WHERE ticket_id=?
                             AND conversation_id NOT IN (SELECT conversation_id FROM retention_cleared)''',(ticket,)).fetchone()[0]
        if not left:
            db.execute("UPDATE tickets SET subject=?,snooze_note='' WHERE id=?",(CLEARED_SUBJECT,ticket))
            db.execute('UPDATE followups SET note=? WHERE ticket_id=?',(CLEARED_SUBJECT,ticket))
            db.execute("UPDATE help_requests SET note='' WHERE ticket_id=?",(ticket,))
    return keys
