"""ผู้ช่วย AI: a member of staff asks the AI from any page (the floating button in the staff app) - a question about their
work, a case to find or summarize, something to do with cases (it proposes, the member confirms:
ai/assistant_actions.py), or why something in their system does not work.

What goes to the provider: the question, the last few turns of this chat (kept by the browser, sent back with each
question), the organization's knowledge articles that match them, internal ones included (staff read those), and the
workspace as this member may see it (ai/assistant_context.py: cases by number and subject, people, teams, tags, the
case on screen, how the channels and the handing out are doing). Email addresses and phone numbers in what staff typed
and in customers' messages are masked first; customers' names are never sent. The answer cites articles by id; a
source that does not quote an article it was given is dropped (service.validate_owner_result)."""
import re

from backend.modules.ai import assistant_actions, assistant_context, insights, service
from backend.utils.validation import require

QUESTION_CHARS = 2000
TURN_CHARS = 4000
HISTORY_TURNS = 6
NUMBER = re.compile(r'\bBD-\d{1,9}\b',re.I)


def ask_form(body):
    """(question, [{'role','text'}] of the last turns) from the request."""
    body = body if isinstance(body,dict) else {}
    question,history = body.get('question'),body.get('history',[])
    require(isinstance(question,str) and question.strip(),'พิมพ์คำถามก่อน')
    require(len(question)<=QUESTION_CHARS,f'คำถามยาวได้ไม่เกิน {QUESTION_CHARS:,} ตัวอักษร')
    require(isinstance(history,list) and len(history)<=40,'ประวัติแชทไม่ถูกต้อง')
    turns = []
    for turn in history[-HISTORY_TURNS*2:]:
        require(isinstance(turn,dict) and turn.get('role') in ('user','assistant') and isinstance(turn.get('text'),str),'ประวัติแชทไม่ถูกต้อง')
        turns.append({'role':turn['role'],'text':turn['text'][:TURN_CHARS]})
    return question.strip(),turns


def persona_of(user_id):
    """How the member chose their assistant to speak (ตั้งค่า in the assistant's panel): {'style'} and, for a character
    they described, its 'description' (contact details masked like the question)."""
    from backend.database import db as D
    from backend.modules.staff_prefs import service as staff_prefs
    with D.control() as cd:
        chosen = staff_prefs.prefs_of(cd,user_id)['assistant']
    if chosen['persona']=='custom' and chosen['custom']:
        return {'style':'custom','description':insights._mask(chosen['custom'])}
    return {'style':chosen['persona'] or 'formal'}


def request(cd, db, ctx, body):
    """Queue the question: (job id, what was gathered for it). The browser waits for the job like a reply draft (GET
    /api/ai/jobs/<id>) and shows the member what was read meanwhile. body.page names the case or conversation open on
    the member's screen ({ticket_id} or {conversation_id}), for "this case"."""
    question,turns = ask_form(body)
    asked = ' '.join([question,*(t['text'] for t in turns if t['role']=='user')])
    articles = service.retrieve(db,asked,public_only=False)
    context,refs = assistant_context.build(cd,db,ctx,asked,body.get('page'))
    payload = {'asked_by':'owner' if ctx['role']=='admin' else 'agent','persona':persona_of(ctx['id']),
               'question':insights._mask(question),
               'history':[{'role':t['role'],'text':insights._mask(t['text'])} for t in turns],
               'articles':[{'id':a['id'],'title':a['title'],'visibility':a['visibility'],'text':a['body']} for a in articles],
               **context,'_refs':refs}
    current = context['current'] or {}
    gathered = {'cases':len(context['cases']),'cases_not_listed':context['cases_not_listed'],'articles':len(articles),
                'current':current.get('case') or ('chat' if current else ''),'customers':len(context['customers_named']),
                'members':len(context['members']),'channels':len(context['health']['channels']),'history':len(turns)}
    return insights._queue(db,ctx,'ask',payload),gathered


def stop(db, ctx, job_id):
    """หยุดรอ: the member no longer waits for their question. One the AI has not started never reaches it; one it is
    already answering is let finish there (the worker waits for that call before the next job, and throws its answer
    away) but nobody waits for it now. Returns whether the AI had started."""
    from backend.database import db as D
    from backend.modules.ai import repository
    D.begin(db)
    job = repository.job_for_user(db,job_id,ctx['id'])
    require(job and job['mode']=='ask','ไม่พบคำถามนี้',404)
    require(job['status'] in ('pending','running'),'ผู้ช่วยตอบคำถามนี้เสร็จแล้ว',409)
    repository.set_job_state(db,job['id'],'cancelled','stopped')
    db.commit()
    return {'status':'cancelled','started':job['status']=='running'}


def feedback(db, ctx, job_id, body):
    """ถูกใจ / ไม่ถูกใจ under an answer, by the member who asked it: {rating: 'up' | 'down' | '' (taken back), reason
    (model.FEEDBACK_REASONS, with ไม่ถูกใจ), comment}. The organization's owner reads the counts, the reasons and the
    comments in the service report, never who wrote them or what was asked; emails and phone numbers are masked."""
    from backend.database import db as D
    from backend.modules.ai import repository
    from backend.modules.ai.model import FEEDBACK_COMMENT_MAX, FEEDBACK_REASONS
    body = body if isinstance(body,dict) else {}
    rating,reason,comment = body.get('rating'),body.get('reason') or '',body.get('comment') or ''
    require(rating in ('up','down',''),'เลือกถูกใจหรือไม่ถูกใจ')
    require(reason=='' or (rating=='down' and reason in FEEDBACK_REASONS),'เหตุผลไม่ถูกต้อง')
    require(isinstance(comment,str) and len(comment.strip())<=FEEDBACK_COMMENT_MAX,f'ความเห็นยาวได้ไม่เกิน {FEEDBACK_COMMENT_MAX} ตัวอักษร')
    D.begin(db)
    job = repository.job_for_user(db,job_id,ctx['id'])
    require(job and job['mode']=='ask' and job['status']=='done','ไม่พบคำตอบนี้ของผู้ช่วย',404)
    if rating:
        repository.save_feedback(db,job['id'],ctx['id'],rating,reason,insights._mask(comment.strip()) if rating=='down' else '')
    else:
        repository.delete_feedback(db,job['id'])
    db.commit()
    return {'rating':rating,'reason':reason if rating=='down' else ''}


def finish(answer, citations, raw, payload):
    """The answer the member sees: its words and sources, the actions that passed (assistant_actions.resolve), how many
    did not, and {case number: case id} for every case it names that the member may open (the panel links them)."""
    actions,dropped = assistant_actions.resolve(raw.get('actions'),payload)
    known = ((payload or {}).get('_refs') or {}).get('cases',{})
    named = {n.upper() for n in NUMBER.findall(answer)}|{a['case'] for a in actions if a.get('case')}
    return {'answer':answer,'citations':citations,'actions':actions,'dropped':dropped,
            'cases':{n:known[n] for n in sorted(named) if n in known}}
