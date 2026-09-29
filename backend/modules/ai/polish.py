"""เกลาข้อความ: a member of staff has written a reply and, before sending it, asks the AI to make it more polite, shorter
or free of typos. The member reads the result and decides: nothing is ever sent from here.

Only what the member typed is sent - no conversation, no customer, no article - and even in it the email addresses and
phone numbers are swapped for placeholders ([[1]], [[2]] …) that come back as they were once the answer arrives. An
answer that lost, repeated or made up a placeholder is refused rather than shown with a contact detail gone wrong.

The same switch as the reply drafts ("AI ช่วยเจ้าหน้าที่"): it is staff help of the same kind, and counts like a draft.
A member who asks again before the answer came gets the newer one only (the older job is cancelled while it waits)."""
import re

from backend.database import db as D
from backend.exceptions.errors import AIError
from backend.utils.dates import now
from backend.utils.validation import require

STYLES = ('polite','short','fix')
MAX_CHARS = 3000
_CONTACT = re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+|(?<![\d\w])(?:\+?66|0)(?:[ -]?\d){8,9}(?!\d)')
_SLOT = re.compile(r'\[\[(\d+)\]\]')


def mask(text):
    """(the text with each email and phone number as [[n]], {n: what it stood for})."""
    slots = {}

    def swap(match):
        slots[str(len(slots)+1)] = match.group(0)
        return f'[[{len(slots)}]]'
    return _CONTACT.sub(swap,text),slots


def request(db, ctx, body):
    """The member's "เกลาข้อความ": queue the job and return its id (the page asks /api/ai/jobs/<id> for the answer)."""
    from backend.modules.ai import service as ai
    body = body if isinstance(body,dict) else {}
    style,text = body.get('style'),body.get('text')
    require(style in STYLES,'เลือกว่าจะให้ปรับแบบไหน')
    require(isinstance(text,str) and text.strip(),'พิมพ์ข้อความก่อนให้ AI ช่วยเกลา')
    require(len(text)<=MAX_CHARS,f'ข้อความยาวเกิน {MAX_CHARS:,} ตัวอักษร ให้ AI ช่วยเกลาทีละส่วน')
    masked,slots = mask(text.strip())
    D.begin(db)
    db.execute("UPDATE ai_jobs SET status='cancelled',error='stale',updated_at=? WHERE requested_by=? AND mode='polish' AND status='pending'",
               (now(),ctx['id']))
    job_id = ai.enqueue(db,ctx['tenant_id'],'polish',None,ctx['id'],payload={'style':style,'text':masked,'_slots':slots})
    db.commit()
    return job_id


def validate(result, payload):
    """{'text'} with the contact details back in place, or AIError: every placeholder kept exactly once, none made up,
    and not grown out of all proportion (an answer to the text instead of the text)."""
    text = result.get('text') if isinstance(result,dict) else None
    sent = (payload or {}).get('text','')
    if not isinstance(text,str) or not text.strip() or len(text)>len(sent)*2+300:
        raise AIError('invalid_output')
    slots = (payload or {}).get('_slots') or {}
    found = _SLOT.findall(text)
    if sorted(found)!=sorted(slots):
        raise AIError('invalid_output')
    return {'text':_SLOT.sub(lambda m:slots[m.group(1)],text.strip())}
