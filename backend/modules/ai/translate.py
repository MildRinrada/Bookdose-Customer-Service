"""แปลภาษาอัตโนมัติสองทาง: a customer who writes in English (or any language but Thai) is read by the team in Thai, and
the team's Thai reply reaches them in their language.

Only for an organization that has connected an AI and whose owner switched this on (ตั้งค่า → AI → แปลภาษาอัตโนมัติ).

- A customer's message not in Thai (by its letters: free, no call) is sent to the AI alone - the text, nothing about
  who wrote it - which says what language it is and gives it in Thai. The message itself is never changed: the team
  sees the Thai with the original a click away. That language becomes the conversation's reply language.
- A team reply written in Thai to a conversation whose reply language is not Thai is held back from the customer
  (messages.delivery 'translating') while the AI translates it, then goes out translated: messages.body is always
  what the customer got, and the Thai the member wrote is kept beside it. A reply the member wrote in the customer's
  language already, or asked to send as typed, goes out at once.
- A held reply never waits for good: when its translation fails, is cancelled (the AI settings changed) or takes longer
  than HOLD_SECONDS, it goes out in Thai as written and the member sees that it did.
- The team's own choice of language for a customer (ข้อมูลลูกค้า → ภาษาที่ใช้ตอบ) wins over what was detected.

Translations count against the daily AI limit on their own, like mood readings: a foreign customer's long chat must
not use up what the chatbot and the team's drafts need, and the other way round. """
import re

from backend.database.db import one, rows
from backend.exceptions.errors import AIError
from backend.utils.dates import after, now

# A longer reply is sent as written: its translation could not be checked whole within one answer.
MAX_CHARS = 3000
HOLD_SECONDS = 90
# Written in Thai when at least this share of its letters are Thai (a Thai sentence with an English product name is Thai).
THAI_SHARE = 0.3
LANGUAGE_RE = re.compile(r'[a-z]{2,3}(?:-[a-z0-9]{2,8})?')
_THAI = re.compile(r'[ก-๎]')
_LETTER = re.compile(r'[^\W\d_]')
# Links and email addresses say nothing about the language a message is written in.
_NOT_WORDS = re.compile(r'https?://\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.]+')


def thai_share(text):
    """The share of the text's letters that are Thai, or None when it has too few letters to tell ("ok", "555", a link)."""
    letters = _LETTER.findall(_NOT_WORDS.sub(' ',text or ''))
    if len(letters)<2:
        return None
    return sum(1 for c in letters if _THAI.match(c))/len(letters)


def enabled(db, tenant_id):
    from backend.modules.ai import service as ai
    return ai.config(db)['translate_enabled'] and ai.has_key(tenant_id)


def reply_language(db, conversation_id):
    """The language replies go out in: the one the team chose for the customer, else the one they last wrote in ('' when
    nobody knows yet)."""
    chosen = db.execute('''SELECT p.language FROM contact_profiles p JOIN conversations c ON c.contact_id=p.contact_id
                           WHERE c.id=?''',(conversation_id,)).fetchone()
    if chosen and chosen[0]:
        return chosen[0]
    row = one(db,'SELECT language FROM conversation_languages WHERE conversation_id=?',(conversation_id,))
    return row['language'] if row else ''


def _set_language(db, conversation_id, code):
    db.execute('''INSERT INTO conversation_languages(conversation_id,language,updated_at) VALUES(?,?,?)
                  ON CONFLICT(conversation_id) DO UPDATE SET language=excluded.language,updated_at=excluded.updated_at''',
               (conversation_id,code,now()))


def _save(db, message_id, direction, language, thai, status, job_id, error=''):
    db.execute('''INSERT INTO message_translations(message_id,direction,language,thai,status,job_id,error,updated_at)
                  VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(message_id) DO UPDATE SET direction=excluded.direction,
                  language=excluded.language,thai=excluded.thai,status=excluded.status,job_id=excluded.job_id,
                  error=excluded.error,updated_at=excluded.updated_at''',
               (message_id,direction,language,thai,status,job_id,error,now()))


def of_conversation(db, conversation_id):
    """{message id: its translation} for the team's copy of a conversation."""
    found = rows(db,'''SELECT t.message_id,t.direction,t.language,t.thai,t.status,t.error FROM message_translations t
                       JOIN messages m ON m.id=t.message_id WHERE m.conversation_id=?''',(conversation_id,))
    return {row.pop('message_id'):row for row in found}


def state(db, conversation_id):
    """For the team's composer: whether translation is on here and the language a reply will go out in."""
    from backend.database import db as D
    return {'enabled':enabled(db,D.tenant_id_of(db)),'language':reply_language(db,conversation_id)}


def on_customer_message(db, tenant_id, conversation_id, message_id, text):
    """A customer wrote: in Thai, replies stay Thai; in another language, queue its Thai translation. Inside the
    caller's transaction; nothing here calls out."""
    share = thai_share(text)
    if share is None:
        return
    if share>=THAI_SHARE:
        _set_language(db,conversation_id,'th')
        return
    if not enabled(db,tenant_id):
        return
    from backend.modules.ai import service as ai
    try:
        job_id = ai.enqueue(db,tenant_id,'translate',conversation_id,payload={'direction':'to_thai','text':text[:MAX_CHARS]})
    except AIError as error:
        _save(db,message_id,'in','','','failed',None,error.code)
        return
    _save(db,message_id,'in','','','pending',job_id)


def outgoing(db, tenant_id, conversation_id, message_id, text, wanted=True):
    """A team reply was stored: hold it for translation when it is in Thai and the customer's language is not.
    Returns whether it is held (the caller then does not send it; release() will)."""
    if not wanted or not enabled(db,tenant_id):
        return False
    target = reply_language(db,conversation_id)
    share = thai_share(text)
    if not target or target=='th' or share is None or share<THAI_SHARE:
        return False
    if len(text)>MAX_CHARS:
        _save(db,message_id,'out',target,text,'failed',None,'too_long')
        return False
    from backend.modules.ai import service as ai
    try:
        job_id = ai.enqueue(db,tenant_id,'translate',conversation_id,
                            payload={'direction':'from_thai','target_language':target,'text':text})
    except AIError as error:
        # Over the day's limit or the AI gone: the reply goes out as written, and the member is told.
        _save(db,message_id,'out',target,text,'failed',None,error.code)
        return False
    _save(db,message_id,'out',target,text,'pending',job_id)
    from backend.modules.conversations import repository as conversations
    conversations.set_delivery(db,message_id,'translating')
    return True


def forget(db, message_id):
    """The member rewrote the message: its old translation no longer belongs to it."""
    db.execute('DELETE FROM message_translations WHERE message_id=?',(message_id,))


def is_held(db, message_id):
    return bool(one(db,"SELECT 1 FROM message_translations WHERE message_id=? AND direction='out' AND status='pending'",(message_id,)))


def validate(result, payload):
    """The AI's translation, or AIError: a language code and the text, of a sensible length."""
    if not isinstance(result,dict) or not isinstance(result.get('text'),str) or not isinstance(result.get('language'),str):
        raise AIError('invalid_output')
    text,code = result['text'].strip(),result['language'].strip().lower().replace('_','-')
    if not text or len(text)>3*len(payload.get('text',''))+300 or not LANGUAGE_RE.fullmatch(code):
        raise AIError('invalid_output')
    if payload.get('direction')=='from_thai':
        code = payload['target_language']
    return {'text':text,'language':code}


def finish(db, job_id, result=None, error=''):
    """The translation came back (result) or will not (error): put it on its message; a held reply goes out either way,
    translated or as written. Returns the conversation to tell the screens about, or None."""
    from backend.modules.conversations import repository as conversations
    row = one(db,"SELECT * FROM message_translations WHERE job_id=? AND status='pending'",(job_id,))
    if not row:
        return None
    message = conversations.find_message(db,row['message_id'])
    if not message:
        return None
    conversation_id = message['conversation_id']
    if row['direction']=='in':
        if error:
            _save(db,row['message_id'],'in','','','failed',job_id,error)
            return conversation_id
        _save(db,row['message_id'],'in',result['language'],result['text'] if result['language']!='th' or result['text']!=message['body'] else '',
              'done',job_id)
        # An older message translated late does not decide the language the customer writes in now.
        if conversations.latest_message_id(db,conversation_id,'customer')==row['message_id']:
            _set_language(db,conversation_id,result['language'])
        return conversation_id
    if message['deleted_at']:
        _save(db,row['message_id'],'out',row['language'],row['thai'],'failed',job_id,'stale')
        return conversation_id
    if error:
        _save(db,row['message_id'],'out',row['language'],row['thai'],'failed',job_id,error)
    else:
        conversations.set_body(db,row['message_id'],result['text'])
        _save(db,row['message_id'],'out',row['language'],row['thai'],'done',job_id)
    release(db,row['message_id'],row['thai'])
    return conversation_id


def release(db, message_id, written):
    """Let a held reply out: on the support page it is simply no longer hidden; LINE / Email / Facebook get it queued now.
    A translation the channel refuses (too long for LINE) goes as `written`, which passed when it was sent."""
    from backend.database import db as D
    from backend.modules.channels import facebook, service as channels
    from backend.modules.conversations import repository as conversations
    from backend.modules.conversations.service import EXTERNAL
    message = conversations.find_message(db,message_id)
    conv = conversations.find(db,message['conversation_id'])
    conversations.set_delivery(db,message_id,'stored')
    # Its time is when the customer got it: a read before then was not a read of it.
    conversations.set_message_created_at(db,message_id,now())
    if conv['channel'] not in EXTERNAL:
        return
    tenant_id = D.tenant_id_of(db)
    provider = facebook if conv['channel']=='facebook' else channels
    try:
        provider.check_reply(db,tenant_id,conv,{'body':message['body']})
    except Exception:
        if message['body']!=written:
            conversations.set_body(db,message_id,written)
            db.execute("UPDATE message_translations SET status='failed',error='too_long',updated_at=? WHERE message_id=?",(now(),message_id))
    try:
        provider.enqueue_reply(db,{'tenant_id':tenant_id,'id':message['author_id']},conv,message_id)
    except Exception:
        # The channel was switched off meanwhile: the member sees it did not go and can send it again.
        conversations.set_delivery(db,message_id,'failed')


def sweep(db):
    """Held replies whose translation is not coming - its job cancelled (the AI settings changed), failed without an
    answer, or simply late - go out as written. Returns the conversations that changed."""
    late = after(seconds=-HOLD_SECONDS)
    found = rows(db,"""SELECT t.job_id,j.status AS job_status FROM message_translations t LEFT JOIN ai_jobs j ON j.id=t.job_id
                       WHERE t.status='pending' AND (j.id IS NULL OR j.status NOT IN ('pending','running') OR t.updated_at<?)""",(late,))
    changed = []
    for row in found:
        if row['job_status'] in ('pending','running'):
            db.execute("UPDATE ai_jobs SET status='cancelled',error='timeout',updated_at=? WHERE id=?",(now(),row['job_id']))
        conversation_id = finish(db,row['job_id'],error='timeout' if row['job_status'] in ('pending','running') else 'stale')
        if conversation_id:
            changed.append(conversation_id)
    return changed
