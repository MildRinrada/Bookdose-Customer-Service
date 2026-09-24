"""สรุปบทสนทนา: what a member taking a conversation over needs instead of reading all of it - what the customer wants,
what has been tried, and what is still open - written by the AI as a few short points each.

Reading a long conversation to an AI costs tokens and time, so the whole of it is never sent twice:

- The summary is kept. Asked again with nothing new written, the kept one is the answer: no call at all.
- Asked again after new messages, the AI gets the kept summary and only the messages since, and brings it up to date.
- What is sent is capped: the newest MAX_MESSAGES messages since the last summary, each cut at MAX_MESSAGE_CHARS (a
  pasted log or a forwarded email is mostly noise), and all of them at MAX_TOTAL_CHARS, dropping the oldest first.
  The AI is told how many were left out, and says so rather than guessing at them.
- The answer is short by design (a few points of a line each), so it comes back in seconds.

And so a member does not wait at the moment they need it, the summary is written ahead at the moments a conversation
changes hands - the chatbot handing it to a person, a case given to someone else - when the conversation is long
enough to need one. While an update is on its way the kept summary stays on screen.

Only for an organization that has connected an AI and switched on "AI ช่วยเจ้าหน้าที่" (the same switch as reply
drafts): it is staff help of the same kind. Internal notes are included - they are what a colleague tried - and the
summary is shown to staff only; names, contact details and attachments are never sent. """
import json

from backend.database.db import one, rows
from backend.exceptions.errors import AI_ERRORS, AIError
from backend.utils.dates import now
from backend.utils.validation import require

MAX_MESSAGES = 40
MAX_MESSAGE_CHARS = 600
MAX_TOTAL_CHARS = 12000
# Shorter than this and it reads faster than a summary does: nothing is written ahead for it.
AHEAD_MIN_MESSAGES = 6
# Written ahead again only once this many messages have come since the last summary.
AHEAD_MIN_NEW = 3
MAX_POINTS, MAX_POINT_CHARS = 5, 200
PARTS = ('wants','tried','pending')

_KINDS = "('customer','reply','note')"


def _new_messages(db, conversation_id, after_rowid):
    return rows(db,f'''SELECT m.rowid AS n,m.kind,m.body,COALESCE(meta.source,'') AS source FROM messages m
                       LEFT JOIN ai_message_meta meta ON meta.message_id=m.id
                       WHERE m.conversation_id=? AND m.rowid>? AND m.kind IN {_KINDS} ORDER BY m.rowid''',(conversation_id,after_rowid))


def _kept(db, conversation_id):
    row = one(db,'SELECT * FROM conversation_summaries WHERE conversation_id=?',(conversation_id,))
    if not row:
        return None
    return {**{part:json.loads(row[part]) for part in PARTS},'last_rowid':row['last_rowid'],'covered':row['message_count'],
            'skipped':row['skipped'],'updated_at':row['updated_at']}


def _job(db, conversation_id):
    """The newest summary job of the conversation."""
    return one(db,"SELECT id,status,error,created_at FROM ai_jobs WHERE conversation_id=? AND mode='summary' ORDER BY created_at DESC,rowid DESC LIMIT 1",
               (conversation_id,))


def state(db, conversation_id):
    """What the screen shows: the kept summary (or None), how many messages came since, the job on its way, and why the
    last one failed when it did (after the kept summary)."""
    kept = _kept(db,conversation_id)
    new = len(_new_messages(db,conversation_id,kept['last_rowid'] if kept else 0))
    job = _job(db,conversation_id)
    working = job and job['status'] in ('pending','running')
    failed = job and job['status']=='failed' and (not kept or job['created_at']>=kept['updated_at'])
    summary = {k:v for k,v in kept.items() if k!='last_rowid'} if kept else None
    return {'summary':summary,'new_messages':new,'working':bool(working),'job':job['id'] if working else None,
            'error':AI_ERRORS.get(job['error'],AI_ERRORS['provider']) if failed else ''}


def payload(db, conversation_id):
    """What the AI reads: the kept summary, and the messages since it - capped (the module's note) - by who wrote them."""
    kept = _kept(db,conversation_id)
    found = _new_messages(db,conversation_id,kept['last_rowid'] if kept else 0)
    recent = found[-MAX_MESSAGES:]
    who = lambda m: 'customer' if m['kind']=='customer' else 'internal_note' if m['kind']=='note' else 'ai_bot' if m['source']=='ai' \
        else 'system' if m['source']=='system' else 'team'
    messages = [{'from':who(m),'text':m['body'][:MAX_MESSAGE_CHARS]+('…' if len(m['body'])>MAX_MESSAGE_CHARS else '')} for m in recent]
    while len(messages)>1 and sum(len(m['text']) for m in messages)>MAX_TOTAL_CHARS:
        messages.pop(0)
    body = {'messages':messages,'left_out':len(found)-len(messages)}
    if kept:
        body['previous_summary'] = {part:kept[part] for part in PARTS}
    return body,len(found)


def request(db, tenant_id, ctx, conv):
    """The member's "สรุปด้วย AI": the kept summary when nothing new was written, the job already on its way, or a new
    job for the messages since. Raises AIError when the organization has no AI for staff help."""
    from backend.modules.ai import service as ai
    current = state(db,conv['id'])
    if current['working'] or (current['summary'] and not current['new_messages']):
        return current
    require(current['new_messages'],'ยังไม่มีข้อความให้สรุป')
    body,_ = payload(db,conv['id'])
    ai.enqueue(db,tenant_id,'summary',conv['id'],ctx['id'],payload=body)
    return state(db,conv['id'])


def ahead(db, tenant_id, conversation_id):
    """Write the summary ahead when the conversation changes hands, so it is ready when the new owner opens it. Quietly
    nothing when there is no AI for staff help, it is short, little was written since, or one is already on its way."""
    from backend.modules.ai import service as ai
    if not ai.has_key(tenant_id) or not ai.config(db)['drafts_enabled']:
        return None
    current = state(db,conversation_id)
    total = db.execute(f'SELECT COUNT(*) FROM messages WHERE conversation_id=? AND kind IN {_KINDS}',(conversation_id,)).fetchone()[0]
    if current['working'] or total<AHEAD_MIN_MESSAGES or current['new_messages']<(AHEAD_MIN_NEW if current['summary'] else 1):
        return None
    body,_ = payload(db,conversation_id)
    try:
        return ai.enqueue(db,tenant_id,'summary',conversation_id,None,payload=body)
    except AIError:
        return None


def validate(result):
    """The AI's summary, or AIError: three lists of short points."""
    if not isinstance(result,dict) or not all(isinstance(result.get(part),list) for part in PARTS):
        raise AIError('invalid_output')
    clean = {}
    for part in PARTS:
        points = [p.strip() for p in result[part] if isinstance(p,str) and p.strip()]
        if len(points)>MAX_POINTS*2 or any(len(p)>MAX_POINT_CHARS*2 for p in points):
            raise AIError('invalid_output')
        clean[part] = [p[:MAX_POINT_CHARS] for p in points[:MAX_POINTS]]
    return clean


def apply(db, job, result):
    """Keep the new summary, as covering the conversation up to the message that was newest when it was asked for."""
    asked = json.loads(job['payload'] or '{}')
    upto = one(db,'SELECT rowid AS n FROM messages WHERE id=?',(job['trigger_id'],)) if job['trigger_id'] else None
    kept = _kept(db,job['conversation_id'])
    covered = (kept['covered'] if kept else 0)+len(asked.get('messages',[]))+asked.get('left_out',0)
    skipped = (kept['skipped'] if kept else 0)+asked.get('left_out',0)
    db.execute('''INSERT INTO conversation_summaries(conversation_id,wants,tried,pending,last_rowid,message_count,skipped,updated_at)
                  VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET wants=excluded.wants,tried=excluded.tried,
                  pending=excluded.pending,last_rowid=excluded.last_rowid,message_count=excluded.message_count,
                  skipped=excluded.skipped,updated_at=excluded.updated_at''',
               (job['conversation_id'],*(json.dumps(result[p],ensure_ascii=False) for p in PARTS),
                upto['n'] if upto else (kept['last_rowid'] if kept else 0),covered,skipped,now()))
