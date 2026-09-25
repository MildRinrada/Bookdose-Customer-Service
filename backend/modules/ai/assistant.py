"""ผู้ช่วย AI: a member of staff asks the AI a question from any page (the floating button in the staff app).

What goes to the provider: the question, the last few turns of this chat (kept by the browser, sent back with each
question) and the organization's knowledge articles that match them, internal ones included (staff read those). Email
addresses and phone numbers in what staff typed are masked first. The answer cites articles by id; a source that does
not quote an article it was given is dropped (service.validate_owner_result)."""
from backend.modules.ai import insights, service
from backend.utils.validation import require

QUESTION_CHARS = 2000
TURN_CHARS = 4000
HISTORY_TURNS = 6


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


def request(db, ctx, body):
    """Queue the question; the browser waits for the job like a reply draft (GET /api/ai/jobs/<id>)."""
    question,turns = ask_form(body)
    asked = ' '.join([question,*(t['text'] for t in turns if t['role']=='user')])
    articles = service.retrieve(db,asked,public_only=False)
    payload = {'asked_by':'owner' if ctx['role']=='admin' else 'agent','persona':persona_of(ctx['id']),
               'question':insights._mask(question),
               'history':[{'role':t['role'],'text':insights._mask(t['text'])} for t in turns],
               'articles':[{'id':a['id'],'title':a['title'],'visibility':a['visibility'],'text':a['body']} for a in articles]}
    return insights._queue(db,ctx,'ask',payload)
