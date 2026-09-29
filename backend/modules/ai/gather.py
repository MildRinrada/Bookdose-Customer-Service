"""Chatbot ถามข้อมูลก่อนถึงเจ้าหน้าที่: when the chatbot hands a conversation to a person, it asks the customer - while
they wait, never instead of the handoff - for the case fields the owner marked "ให้ Chatbot ถามลูกค้า" (ตั้งค่าองค์กร →
ช่องข้อมูลของเคส), and fills in what the customer answers, so the member who picks it up does not ask again.

1. At the handoff, the AI first reads what the customer already wrote: a field they have already answered is filled
   in and not asked for.
2. The fields still empty are asked for in one message the system writes itself from the field names (and a choice's
   options) - the AI never writes to the customer here.
3. Each message the customer sends after that is read for the fields still empty, at most MAX_ROUNDS times. Once
   they are all filled the customer is thanked; otherwise it stops quietly: nobody is asked twice.
4. It stops as soon as a member of the team writes to the customer or the case is closed: from then on the member
   asks what they need.

Values are checked like the case screen checks them (fields.value_of), never overwrite what the team filled in, and
the activity log says Bookdose AI filled them in. Only the customer's own messages are sent, with the field names. """
import json

from backend.database import audit
from backend.database.db import one, rows
from backend.exceptions.errors import AIError, APIError
from backend.utils.dates import now

MAX_ROUNDS = 3
MAX_MESSAGES = 20
MAX_MESSAGE_CHARS = 600
KIND_HINT = {'date':'วัน/เดือน/ปี','checkbox':'ใช่หรือไม่'}


def asked_fields(db):
    from backend.modules.tickets import fields
    return [f for f in fields.catalog(db) if f.get('ask')]


def _row(db, conversation_id):
    return one(db,'SELECT * FROM conversation_gather WHERE conversation_id=?',(conversation_id,))


def _set(db, conversation_id, **changes):
    marks = ','.join(f'{k}=?' for k in changes)
    db.execute(f'UPDATE conversation_gather SET {marks},updated_at=? WHERE conversation_id=?',(*changes.values(),now(),conversation_id))


def _empty(db, ticket_id, field_ids):
    from backend.modules.tickets import fields
    have = fields.values_of(db,ticket_id)
    known = {f['id']:f for f in fields.catalog(db)}
    return [known[i] for i in field_ids if i in known and not have.get(i)]


def _queue(db, tenant_id, conversation_id, wanted, after_rowid, stage):
    from backend.modules.ai import service as ai
    found = rows(db,"SELECT body FROM messages WHERE conversation_id=? AND kind='customer' AND rowid>? AND body<>'' ORDER BY rowid DESC LIMIT ?",
                 (conversation_id,after_rowid,MAX_MESSAGES))
    if not found:
        return None
    refs = {f'f{n}':f['id'] for n,f in enumerate(wanted,1)}
    payload = {'fields':[{'ref':ref,'name':f['name'],'kind':f['kind'],**({'options':f['options']} if f['kind']=='select' else {})}
                         for ref,f in zip(refs,wanted)],
               'messages':[m['body'][:MAX_MESSAGE_CHARS] for m in reversed(found)],'_refs':refs,'_stage':stage}
    db.execute("UPDATE ai_jobs SET status='cancelled',error='stale',updated_at=? WHERE conversation_id=? AND mode='gather' AND status='pending'",
               (now(),conversation_id))
    return ai.enqueue(db,tenant_id,'gather',conversation_id,None,payload=payload)


def question(wanted):
    lines = [f"- {f['name']}"+(f" ({', '.join(f['options'][:8])})" if f['kind']=='select' else f" ({KIND_HINT[f['kind']]})" if f['kind'] in KIND_HINT else '')
             for f in wanted]
    return 'ระหว่างรอเจ้าหน้าที่ รบกวนแจ้งข้อมูลต่อไปนี้ด้วยนะคะ เจ้าหน้าที่จะได้ดูแลต่อได้ทันที\n'+'\n'.join(lines)


def _ask(db, conversation_id, wanted):
    from backend.modules.ai import service as ai
    mid = ai.system_message(db,conversation_id,question(wanted))
    rowid = db.execute('SELECT rowid FROM messages WHERE id=?',(mid,)).fetchone()[0]
    _set(db,conversation_id,status='asking',asked_rowid=rowid)


def start(db, tenant_id, conversation_id, ticket_id):
    """The chatbot has just handed the conversation to a person (inside the handoff's transaction): read what the
    customer already wrote for the marked fields, then ask for the rest. Quietly nothing when no field is marked, the
    case has them all, or there is no AI."""
    from backend.modules.ai import service as ai
    wanted = _empty(db,ticket_id,[f['id'] for f in asked_fields(db)])
    if not wanted or not ai.has_key(tenant_id):
        return None
    db.execute('''INSERT INTO conversation_gather(conversation_id,ticket_id,fields,status,rounds,asked_rowid,updated_at)
                  VALUES(?,?,?,'reading',0,0,?) ON CONFLICT(conversation_id) DO UPDATE SET ticket_id=excluded.ticket_id,
                  fields=excluded.fields,status='reading',rounds=0,asked_rowid=0,updated_at=excluded.updated_at''',
               (conversation_id,ticket_id,json.dumps([f['id'] for f in wanted]),now()))
    try:
        job = _queue(db,tenant_id,conversation_id,wanted,0,'start')
    except AIError:
        job = None
    if not job:
        # Nothing to read (or no job to read it with): ask straight away.
        _ask(db,conversation_id,wanted)
    return job


def _team_wrote(db, conversation_id, after_rowid):
    return bool(db.execute('''SELECT 1 FROM messages m LEFT JOIN ai_message_meta meta ON meta.message_id=m.id
                              WHERE m.conversation_id=? AND m.rowid>? AND m.kind='reply' AND meta.message_id IS NULL LIMIT 1''',
                           (conversation_id,after_rowid)).fetchone())


def _over(db, row):
    """It has to stop: the team wrote to the customer, or the case is closed."""
    ticket = one(db,'SELECT status FROM tickets WHERE id=?',(row['ticket_id'],))
    return not ticket or ticket['status'] in ('resolved','closed') or _team_wrote(db,row['conversation_id'],row['asked_rowid'])


def on_customer_message(db, tenant_id, conversation_id):
    """A customer wrote in a conversation a person looks after: read it for the fields still asked for."""
    row = _row(db,conversation_id)
    if not row or row['status']!='asking':
        return None
    if _over(db,row):
        _set(db,conversation_id,status='stopped')
        return None
    wanted = _empty(db,row['ticket_id'],json.loads(row['fields']))
    if not wanted:
        _set(db,conversation_id,status='done')
        return None
    try:
        return _queue(db,tenant_id,conversation_id,wanted,row['asked_rowid'],'answer')
    except AIError:
        return None


def validate(result, payload):
    """{field id: value} of what the customer stated, each value one its field takes; anything else is left out."""
    if not isinstance(result,dict) or not isinstance(result.get('values'),list):
        raise AIError('invalid_output')
    refs = (payload or {}).get('_refs') or {}
    found = {}
    for entry in result['values']:
        if isinstance(entry,dict) and isinstance(entry.get('field'),str) and entry['field'] in refs and isinstance(entry.get('value'),str):
            found[refs[entry['field']]] = entry['value']
    return {'values':found}


def _fill(db, ticket_id, values):
    """Write the values that fit their field into the fields still empty. Returns how many were filled."""
    from backend.modules.tickets import fields
    from backend.realtime import events as realtime
    known = {f['id']:f for f in fields.catalog(db)}
    have = fields.values_of(db,ticket_id)
    filled = []
    for field_id,raw in values.items():
        field = known.get(field_id)
        if not field or have.get(field_id):
            continue
        try:
            value = fields.value_of(field,raw)
        except APIError:
            continue
        if value:
            db.execute('''INSERT INTO ticket_field_values VALUES(?,?,?,?,?) ON CONFLICT(ticket_id,field_id) DO UPDATE SET
                          value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by''',
                       (ticket_id,field_id,value,now(),'Bookdose AI'))
            filled.append({'field':field['name'],'before':'-','after':fields.display(field,value)})
    if filled:
        audit.record(db,'Bookdose AI','ticket.fields',ticket_id,json.dumps(filled,ensure_ascii=False))
        team = one(db,'SELECT team_id FROM tickets WHERE id=?',(ticket_id,))
        realtime.ticket(db,ticket_id,public=False,teams=(team['team_id'],) if team else ())
    return len(filled)


def apply(db, job, result, error=''):
    """The reading came back (or failed): fill in what the customer said, then ask for the rest, thank them, or stop."""
    from backend.modules.ai import service as ai
    payload = json.loads(job['payload'] or '{}')
    row = _row(db,job['conversation_id'])
    if not row or row['status'] not in ('reading','asking'):
        return
    if _over(db,row):
        _set(db,row['conversation_id'],status='stopped')
        return
    if not error:
        _fill(db,row['ticket_id'],result['values'])
    wanted = _empty(db,row['ticket_id'],json.loads(row['fields']))
    if payload.get('_stage')=='start':
        if wanted:
            _ask(db,row['conversation_id'],wanted)
        else:
            _set(db,row['conversation_id'],status='done')
        return
    rounds = row['rounds']+1
    if not wanted:
        from backend.modules.conversations import repository as conversations
        channel = conversations.find(db,row['conversation_id'])['channel']
        ai.system_message(db,row['conversation_id'],'ได้รับข้อมูลแล้ว ขอบคุณค่ะ เจ้าหน้าที่จะตอบกลับ'+('ในแชทนี้' if channel=='web' else 'ผ่านช่องทางนี้'))
        _set(db,row['conversation_id'],status='done',rounds=rounds)
    else:
        _set(db,row['conversation_id'],rounds=rounds,**({'status':'stopped'} if rounds>=MAX_ROUNDS else {}))
