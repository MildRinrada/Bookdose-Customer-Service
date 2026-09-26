"""What the staff's AI assistant may do, once the member confirms it (ai/assistant.py). The AI never changes anything
itself: its answer may carry actions, which the assistant's panel shows as a list the member checks, edits (a message
to a customer, a note) and confirms with one press of ทำเลย.

Two checks stand between the AI and the organization's data:
  resolve  when the answer arrives: each action must point at a case, member, team or tag the AI was shown (its refs,
           assistant_context.Refs), with values the case form accepts; anything else is dropped, never guessed at.
  run      when the member confirms: each action goes through the same service a member's own click goes through,
           with the member's rights (an agent stays in their team, only an owner changes the handing out), so the AI
           can never do more than the member could. One action failing does not stop the others; each says why.

A proposal is run once, by the member who asked, within RUN_MINUTES of the answer (after that the cases it was built
from may have moved on). Every change is recorded in the activity log under the member's name, as their own clicks are,
and the run itself as ai.actions_run."""
import datetime as dt
import json

from backend.database import audit, db as D
from backend.exceptions.errors import APIError, CHANNEL_ERRORS, ChannelError
from backend.modules.ai import repository
from backend.modules.tickets.model import PRIORITIES, SNOOZE_MAX_DAYS, SNOOZE_NOTE_MAX, STATUSES
from backend.utils.dates import iso, now, utc_now
from backend.utils.validation import require

TYPES = ('update_case','tag_case','snooze_case','wake_case','note','reply','retry_send','auto_assign')
MAX_ACTIONS = 20
TEXT_MAX = 5000
RUN_MINUTES = 60
REPLY_CHANNELS = ('web','line','email','facebook','instagram')


def _text(value, limit):
    return value.strip()[:limit] if isinstance(value,str) else ''


def _refs(values, table):
    return list(dict.fromkeys(table[v] for v in values if isinstance(v,str) and v in table)) if isinstance(values,list) else []


def _until(value):
    """A pause's end as UTC, when it is ahead and not past the longest pause."""
    try:
        moment = dt.datetime.fromisoformat(value.strip().replace('Z','+00:00'))
    except (AttributeError,ValueError):
        return None
    if moment.tzinfo is None:
        return None
    moment = moment.astimezone(dt.timezone.utc)
    return iso(moment) if utc_now()<moment<=utc_now()+dt.timedelta(days=SNOOZE_MAX_DAYS) else None


def _one(item, refs, owner):
    """The action as the system will do it, or None when it points at something the AI was not shown."""
    if not isinstance(item,dict) or item.get('type') not in TYPES:
        return None
    kind = item['type']
    if kind=='auto_assign':
        enabled,cap = item.get('enabled'),item.get('cap')
        from backend.modules.automation.distribution import CAP_MAX, CAP_MIN
        change = {**({'enabled':enabled=='on'} if enabled in ('on','off') else {}),
                  **({'cap':cap} if type(cap) is int and CAP_MIN<=cap<=CAP_MAX else {})}
        return {'type':kind,**change} if owner and change else None
    case = item.get('case')
    current = refs.get('current') or {}
    if case=='current':
        ticket_id,conversation_id = current.get('ticket_id'),current.get('conversation_id')
    else:
        key = case.strip().upper() if isinstance(case,str) else ''
        ticket_id,conversation_id = refs.get('cases',{}).get(key),None
    if not ticket_id and not (conversation_id and kind in ('note','reply')):
        return None
    number = next((k for k,v in refs.get('cases',{}).items() if v==ticket_id),'') if ticket_id else ''
    action = {'type':kind,'ticket_id':ticket_id,'case':number,**({'conversation_id':conversation_id} if conversation_id else {})}
    if kind=='update_case':
        changes = {}
        if item.get('status') in STATUSES:
            changes['status'] = item['status']
        if item.get('priority') in PRIORITIES:
            changes['priority'] = item['priority']
        team = refs.get('teams',{}).get(item.get('team'))
        if team:
            changes['team_id'] = team
        assignee = item.get('assignee')
        if assignee=='none':
            changes['assignee_id'] = None
        elif assignee in refs.get('members',{}):
            changes['assignee_id'] = refs['members'][assignee]
        return {**action,'changes':changes} if changes else None
    if kind=='tag_case':
        add,remove = _refs(item.get('add_tags'),refs.get('tags',{})),_refs(item.get('remove_tags'),refs.get('tags',{}))
        remove = [t for t in remove if t not in add]
        return {**action,'add_tags':add,'remove_tags':remove} if add or remove else None
    if kind=='snooze_case':
        until = _until(item.get('until'))
        return {**action,'until':until,'text':_text(item.get('text'),SNOOZE_NOTE_MAX)} if until else None
    if kind in ('note','reply'):
        text = _text(item.get('text'),TEXT_MAX)
        return {**action,'text':text} if text else None
    if kind=='retry_send':
        messages = (refs.get('failed',{}).get(number) or {}).get('messages',[])
        return {**action,'messages':messages} if messages else None
    return action


def resolve(raw, payload):
    """(the actions that may be offered, how many were dropped) from the AI's answer. Each case appears in at most one
    action of a kind: a second one would only undo or repeat the first."""
    payload = payload or {}
    refs = payload.get('_refs') or {}
    owner = (payload.get('me') or {}).get('role')=='owner'
    # The subject the member knows each case by, for the list they confirm.
    current = payload.get('current') or {}
    listed = [*payload.get('cases',[]),*current.get('customer_other_cases',[]),*(c for n in payload.get('customers_named',[]) for c in n['cases'])]
    subjects = {c['case']:c['subject'] for c in listed}
    items = raw if isinstance(raw,list) else []
    found,seen = [],set()
    for item in items[:MAX_ACTIONS]:
        action = _one(item,refs,owner)
        key = action and (action['type'],action.get('ticket_id') or action.get('conversation_id'))
        if action and key not in seen:
            seen.add(key)
            if action['type']!='auto_assign':
                action['subject'] = subjects.get(action['case'],'') if action['case'] else current.get('subject','')
            found.append(action)
    return found,len(items)-len(found)


def run_form(body, count):
    """(the actions picked, by index; {index: the text the member edited}) from the confirm request."""
    body = body if isinstance(body,dict) else {}
    picked,texts = body.get('picked'),body.get('texts',{}) or {}
    require(isinstance(picked,list) and picked and all(type(i) is int and 0<=i<count for i in picked),'เลือกรายการที่จะให้ทำอย่างน้อย 1 รายการ')
    require(isinstance(texts,dict) and all(isinstance(v,str) for v in texts.values()),'ข้อความที่แก้ไม่ถูกต้อง')
    edited = {}
    for key,value in texts.items():
        require(str(key).isdigit() and int(key)<count,'ข้อความที่แก้ไม่ถูกต้อง')
        require(value.strip(),'ข้อความที่จะส่งต้องไม่ว่าง')
        require(len(value)<=TEXT_MAX,f'ข้อความยาวได้ไม่เกิน {TEXT_MAX:,} ตัวอักษร')
        edited[int(key)] = value.strip()
    return list(dict.fromkeys(picked)),edited


def _conversation(db, ctx, action, reply):
    """Where a note or a message goes: the conversation on screen, or the case's latest one (for a message, the latest
    one a message can reach)."""
    from backend.middleware.access import get_scoped
    if action.get('conversation_id'):
        return get_scoped(db,'conversations',action['conversation_id'],ctx)
    get_scoped(db,'tickets',action['ticket_id'],ctx)
    found = D.rows(db,'''SELECT c.* FROM conversations c JOIN ticket_conversations tc ON tc.conversation_id=c.id WHERE tc.ticket_id=?
                          ORDER BY c.updated_at DESC,c.rowid DESC''',(action['ticket_id'],))
    conv = next((c for c in found if not reply or c['channel'] in REPLY_CHANNELS),None)
    require(conv,'เคสนี้บันทึกเอง ไม่มีช่องทางส่งข้อความถึงลูกค้า' if reply else 'ไม่พบบทสนทนาของเคสนี้',404)
    return conv


def _do(cd, db, ctx, action):
    from backend.modules.tickets import service as tickets, tags
    kind = action['type']
    if kind=='update_case':
        changes = dict(action['changes'])
        # Another team without a name for who takes it: nobody in the new team has it yet.
        if 'team_id' in changes and 'assignee_id' not in changes:
            current = D.one(db,'SELECT team_id FROM tickets WHERE id=?',(action['ticket_id'],))
            if current and current['team_id']!=changes['team_id']:
                changes['assignee_id'] = None
        tickets.update_ticket(cd,db,ctx,action['ticket_id'],changes)
    elif kind=='tag_case':
        have = tags.of_ticket(db,action['ticket_id'])
        tags.set_for_ticket(db,ctx,action['ticket_id'],{'tags':[t for t in have if t not in action['remove_tags']]+
                                                          [t for t in action['add_tags'] if t not in have]})
    elif kind=='snooze_case':
        tickets.snooze_ticket(db,ctx,action['ticket_id'],{'until':action['until'],'note':action['text']})
    elif kind=='wake_case':
        tickets.wake_ticket(db,ctx,action['ticket_id'])
    elif kind in ('note','reply'):
        from backend.modules.conversations import service as conversations
        conversations.post_staff_message(db,ctx,_conversation(db,ctx,action,kind=='reply'),{'kind':kind,'body':action['text']},cd)
    elif kind=='retry_send':
        from backend.modules.channels import service as channels
        for message_id in action['messages']:
            channels.retry_failed_delivery(db,ctx,message_id)
    elif kind=='auto_assign':
        require(ctx['role']=='admin','เฉพาะเจ้าขององค์กรตั้งการแจกเคสอัตโนมัติได้',403)
        from backend.modules.automation import distribution
        cfg = distribution.config(db)
        distribution.save(cd,db,ctx,{**cfg,**{k:action[k] for k in ('enabled','cap') if k in action}})


def _why(error):
    if isinstance(error,APIError):
        return error.message
    if isinstance(error,ChannelError):
        return CHANNEL_ERRORS.get(error.code,CHANNEL_ERRORS['unknown'])
    return 'ทำรายการนี้ไม่สำเร็จ ลองทำเองจากหน้าเคส'


def run(cd, db, ctx, job_id, body):
    """ทำเลย: the picked actions of one of the member's answers, each through its own service. Returns each one's result."""
    require(not ctx.get('read_only'),'ผู้ช่วย AI ใช้ได้เฉพาะทีมงานขององค์กร',403)
    D.begin(db)
    job = repository.job_for_user(db,job_id,ctx['id'])
    require(job and job['mode']=='ask' and job['status']=='done','ไม่พบคำตอบนี้ของผู้ช่วย',404)
    result = json.loads(job['result'] or '{}')
    actions = result.get('actions') or []
    require(actions,'คำตอบนี้ไม่มีรายการที่ต้องทำ')
    require(not result.get('ran'),'ทำรายการของคำตอบนี้ไปแล้ว',409)
    require(dt.datetime.fromisoformat(job['updated_at'])>=utc_now()-dt.timedelta(minutes=RUN_MINUTES),
            f'คำตอบนี้เก่าเกิน {RUN_MINUTES} นาที ข้อมูลเคสอาจเปลี่ยนไปแล้ว ถามผู้ช่วยใหม่อีกครั้ง',409)
    picked,edited = run_form(body,len(actions))
    # Claimed before anything runs: a second press, or a second tab, finds it taken.
    result['ran'] = {'at':now(),'results':[]}
    repository.finish_job(db,job['id'],'done',json.dumps(result,ensure_ascii=False),'')
    db.commit()
    results = []
    for index in picked:
        action = actions[index]
        if index in edited and action['type'] in ('note','reply'):
            action = {**action,'text':edited[index]}
        try:
            _do(cd,db,ctx,action)
            results.append({'index':index,'ok':True,'error':''})
        except (APIError,ChannelError,ValueError,KeyError,TypeError) as error:
            if db.in_transaction:
                db.rollback()
            results.append({'index':index,'ok':False,'error':_why(error)})
    D.begin(db)
    result['ran']['results'] = results
    repository.finish_job(db,job['id'],'done',json.dumps(result,ensure_ascii=False),'')
    done = sum(1 for r in results if r['ok'])
    audit.record(db,ctx['name'],'ai.actions_run',job['id'],f'{done} จาก {len(results)} รายการ')
    db.commit()
    return {'results':results}
