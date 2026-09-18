"""Tenant-scoped AI drafts for staff and a durable, conservative chatbot for web, LINE and Email.

No provider call occurs on an inbound customer's request. Jobs and messages are
committed together; provider calls run without an open database transaction.
"""
import json
import re
import threading
import unicodedata
from urllib.parse import urlsplit

from backend.extensions import monitor
from backend.database import audit, db as D
from backend.exceptions.errors import AIError
from backend.extensions import ai_webhook, openai_client
from backend.middleware.access import get_scoped
from backend.modules.ai import repository, schema
from backend.modules.ai.model import DEFAULT_MODEL, OWNER_MODES, PAYLOAD_MODES
from backend.modules.channels import service as channels
from backend.modules.conversations import repository as conversations
from backend.modules.organization import repository as memberships
from backend.modules.platform import repository as tenants
from backend.modules.tickets import repository as tickets, service as ticket_service
from backend.realtime import events as realtime
from backend.utils.dates import after, today
from backend.utils.security import token_hash, uid
from backend.utils.validation import require

HANDOFF_MESSAGE = 'ส่งเรื่องให้เจ้าหน้าที่แล้วค่ะ ทีมงานจะตอบกลับในแชทนี้ คุณส่งรายละเอียดเพิ่มเติมไว้ได้เลย'
CHANNEL_HANDOFF_MESSAGE = 'ส่งเรื่องให้เจ้าหน้าที่แล้วค่ะ ทีมงานจะตอบกลับผ่านช่องทางนี้'
NO_KNOWLEDGE_SUMMARY = 'ไม่พบความรู้ที่เกี่ยวข้องเพียงพอ กรุณาตรวจสอบและตอบลูกค้าโดยเจ้าหน้าที่'
# Longer than the slowest provider call (an n8n workflow on a local model: ai_webhook.TIMEOUT_SECONDS).
JOB_TIMEOUT_SECONDS = ai_webhook.TIMEOUT_SECONDS+30


def config(db):
    values = repository.settings(db)
    return {'drafts_enabled':values.get('ai_drafts')=='1','chatbot_enabled':values.get('ai_chatbot')=='1',
            'model':values.get('ai_model',DEFAULT_MODEL),'daily_limit':int(values.get('ai_daily_limit',100)),
            'conversation_limit':int(values.get('ai_conversation_limit',20)),
            'max_output_tokens':int(values.get('ai_max_output_tokens',1000)),
            'version':values.get('ai_version','0')}


def has_key(tenant_id):
    """The organization is connected to an AI: an n8n webhook (used when there is one) or an OpenAI API key."""
    return bool(repository.read_webhook(tenant_id) or repository.read_key(tenant_id))


def overview(db, tenant_id):
    cfg = config(db)
    webhook = repository.read_webhook(tenant_id)
    # The owner sees the saved URL (the secret header is what protects the workflow) and only the last characters of
    # the secret, enough to compare with n8n's Header Auth. Never on /api/workspace, which every member reads.
    cfg.update(key_configured=has_key(tenant_id),openai_key=bool(repository.read_key(tenant_id)),
               provider='n8n' if webhook else 'openai',webhook_host=urlsplit(webhook['url']).netloc if webhook else '',
               webhook_url=webhook['url'] if webhook else '',webhook_secret_end=webhook['secret'][-4:] if webhook else '',
               usage=repository.usage_since(db,today()))
    return cfg


def conversation_state(db, conversation_id):
    row = repository.conversation_mode(db,conversation_id) or {'mode':'human','reason':''}
    return {**row,'pending':repository.has_pending_bot_job(db,conversation_id)}


def set_initial_mode(db, conversation_id, bot):
    repository.set_initial_mode(db,conversation_id,'bot' if bot else 'human')


def stop_bot(db, conversation_id, reason='staff'):
    """Hand the conversation to staff: cancel queued bot answers, including ones waiting to go out on LINE/Email."""
    repository.set_human(db,conversation_id,reason)
    channels.cancel_ai_outbox(db,conversation_id)
    repository.cancel_bot_jobs(db,conversation_id)


def resume_bot(db, conversation_id):
    """Let the chatbot answer the customer's next message in this conversation."""
    repository.set_bot(db,conversation_id)


def system_message(db, conversation_id, body, source='system', citations=None, job=None, signature=None, notice=None):
    """Post the chatbot's answer or a system notice. On the web, `notice` ('ai' / 'handoff') also tells a customer who
    has closed the page (customers.notify_reply: email / LINE / SMS, after a couple of minutes unless they read it)."""
    mid = uid()
    conversations.insert_message(db,mid,conversation_id,None,'Bookdose AI' if source=='ai' else 'ระบบ','reply',body)
    repository.insert_message_meta(db,mid,source,json.dumps(citations or [],ensure_ascii=False))
    conversations.touch(db,conversation_id)
    channel = conversations.find(db,conversation_id)['channel']
    if channel in ('line','email'):
        channels.queue_ai(db,mid,job,signature,notice=source!='ai')
    elif channel=='web' and notice:
        from backend.modules.customers import service as customers
        customers.notify_reply(db,conversation_id,notice)
    realtime.conversation(db,conversation_id)
    # AI and system notices deliberately do not satisfy the human first-response SLA.
    return mid


def handoff(db, conversation_id, reason='customer'):
    """Stop the bot and make sure an open case exists for staff; tells the customer once."""
    previous = conversation_state(db,conversation_id)
    stop_bot(db,conversation_id,reason)
    conv = conversations.find(db,conversation_id)
    ticket = tickets.for_conversation(db,conversation_id)
    tid = ticket['id'] if ticket else ticket_service.open_ticket(db,conv['contact_id'],conv['team_id'],conv['subject'],'normal',conversation_id=conversation_id)
    conversations.reopen(db,conversation_id)
    tickets.reopen(db,tid)
    if previous['mode']=='bot' or not previous['reason']:
        # The customer who asked for a person is looking at the page, and a member of staff who takes over is about to
        # write (that reply is the notice); any other handoff may happen after the customer left.
        system_message(db,conversation_id,HANDOFF_MESSAGE if conv['channel']=='web' else CHANNEL_HANDOFF_MESSAGE,
                       notice=None if reason in ('customer','staff') else 'handoff')
        audit.record(db,'Bookdose AI','ai.handoff',conversation_id,reason)
    realtime.conversation(db,conversation_id)
    return tid


def requests_human(text):
    return bool(re.search(r'คุยกับ(?:คน|เจ้าหน้าที่|พนักงาน)|ติดต่อเจ้าหน้าที่|ขอ(?:คน|เจ้าหน้าที่)|human\s*(?:agent|please)|talk to (?:a )?(?:person|human)',text,re.I))


def bot_enabled(db, conversation_id):
    conv = conversations.find(db,conversation_id)
    if not conv:
        return False
    if conv['channel']=='web':
        return config(db)['chatbot_enabled']
    if conv['channel'] in ('line','email'):
        return channels.bot_enabled(db,conv)
    return False


def enqueue(db, tenant_id, mode, conversation_id=None, requested_by=None, payload=None):
    """Queue a job (or return the one already queued for the same trigger / draft request); enforces the limits.
    The owner's jobs (article, brief) and the assistant's (ask) carry their input in `payload` and count like a staff
    draft."""
    cfg = config(db)
    if (mode=='bot' and not bot_enabled(db,conversation_id)) or (mode in ('draft',*PAYLOAD_MODES) and not cfg['drafts_enabled']):
        raise AIError('disabled')
    if not has_key(tenant_id):
        raise AIError('not_configured')
    trigger_id = conversations.latest_message_id(db,conversation_id) if conversation_id else None
    if mode=='bot' and trigger_id:
        old = repository.bot_job_for_trigger(db,trigger_id)
        if old:
            return old
    if mode=='draft':
        old = repository.pending_draft(db,conversation_id,requested_by)
        if old:
            return old
    if mode in PAYLOAD_MODES:
        old = repository.pending_owner_job(db,requested_by,mode)
        if old:
            return old
    if repository.jobs_since(db,today())>=cfg['daily_limit']:
        raise AIError('quota')
    if conversation_id and repository.bot_jobs_for_conversation(db,conversation_id)>=cfg['conversation_limit'] and mode=='bot':
        raise AIError('quota')
    job_id = uid()
    repository.insert_job(db,job_id,conversation_id,trigger_id,requested_by,mode,cfg['version'],
                          json.dumps(payload or {},ensure_ascii=False))
    audit.record(db,requested_by or 'Bookdose AI','ai.queued',conversation_id or job_id,mode)
    return job_id


def on_customer_message(db, tenant_id, conversation_id, body, is_new=False):
    if is_new:
        set_initial_mode(db,conversation_id,bot_enabled(db,conversation_id) and has_key(tenant_id))
    if requests_human(body):
        handoff(db,conversation_id)
        return
    if conversation_state(db,conversation_id)['mode']!='bot':
        return
    latest = conversations.latest_message_id(db,conversation_id)
    if latest and conversations.has_attachment(db,latest):
        handoff(db,conversation_id,'attachment_requires_staff')
        return
    # Supersede older in-flight answers when the customer adds information.
    repository.cancel_bot_jobs(db,conversation_id)
    try:
        enqueue(db,tenant_id,'bot',conversation_id)
    except AIError as error:
        handoff(db,conversation_id,error.code)


def normalize(text):
    return re.sub(r'\s+',' ',unicodedata.normalize('NFKC',text).lower()).strip()


def features(text):
    """Thai character trigrams plus Latin words; no external embedding/index leak."""
    value = normalize(text)
    latin = set(re.findall(r'[a-z0-9]{3,}',value))
    thai = re.findall(r'[฀-๿]+',value)
    return latin | {word[i:i+3] for word in thai for i in range(len(word)-2)}


def retrieve(db, query, public_only):
    query_features = features(query)
    candidates = []
    for article in repository.articles(db,public_only):
        # Chunks are capped to bound provider input, with overlap for paragraph edges.
        for start in range(0,len(article['body']),1200):
            chunk = article['body'][start:start+1500]
            overlap = query_features & features(article['title']+' '+chunk)
            title_overlap = query_features & features(article['title'])
            score = len(overlap)+2*len(title_overlap)
            if overlap and score>=2:
                candidates.append((score,article['id'],start,{**article,'body':chunk}))
    candidates.sort(key=lambda item:(-item[0],item[1],item[2]))
    return [item[3] for item in candidates[:5]]


def snapshot(db, job, exclude_message=None):
    """(provider payload, articles used, signature). The signature changes when anything the answer relied on changes."""
    conv = conversations.find(db,job['conversation_id'])
    public = job['mode']=='bot'
    thread = conversations.line_thread(db,conv['id'])
    # In a LINE group the bot only sees the message that called it.
    only = job['trigger_id'] if public and thread and thread['source_type']!='user' else None
    messages = repository.recent_messages(db,conv['id'],public,exclude_message,only)
    latest_customer = next((m['body'] for m in reversed(messages) if m['kind']=='customer'),'')
    articles = retrieve(db,conv['subject']+' '+latest_customer,public)
    # Do not transmit contact records, visitor tokens, names, emails, or attachments.
    payload = {'subject':conv['subject'],'messages':[{'kind':m['kind'],'body':m['body'][:2500],'attachment_count':m['attachment_count']} for m in messages],
               'articles':[{'id':a['id'],'title':a['title'],'visibility':a['visibility'],'text':a['body']} for a in articles]}
    # The language the team noted for this customer (ข้อมูลลูกค้า → ภาษาที่ใช้ตอบ): only the code, nothing about who they are.
    language = db.execute('SELECT language FROM contact_profiles WHERE contact_id=?',(conv['contact_id'],)).fetchone()
    if language and language[0]:
        payload['reply_language'] = language[0]
    signature = token_hash(json.dumps({'payload':payload,'message_ids':[m['id'] for m in messages],'team_id':conv['team_id'],'status':conv['status'],
                                      'versions':[(a['id'],a['updated_at']) for a in articles]},sort_keys=True,ensure_ascii=False))
    return payload,articles,signature


def validate_result(result, articles, mode):
    """Accept an answer only when every citation is an exact quote from an article that was supplied."""
    if not isinstance(result,dict) or not isinstance(result.get('answer'),str) or not isinstance(result.get('summary'),str) or type(result.get('needs_human')) is not bool or not isinstance(result.get('citations'),list):
        raise AIError('invalid_output')
    if len(result['answer'])>12000 or len(result['summary'])>6000 or len(result['citations'])>8:
        raise AIError('invalid_output')
    citations = []
    for cite in result['citations']:
        if not isinstance(cite,dict) or not isinstance(cite.get('quote'),str) or not 12<=len(cite['quote'])<=300:
            raise AIError('invalid_output')
        article = next((a for a in articles if a['id']==cite.get('article_id') and cite['quote'] in a['body']),None)
        if not article:
            raise AIError('invalid_output')
        citations.append({'article_id':article['id'],'title':article['title'],'quote':cite['quote'],'visibility':article['visibility']})
    if mode!='test' and (not citations or not result['answer'].strip()):
        return {'answer':'','summary':result['summary'],'needs_human':True,'citations':[]}
    return {**result,'citations':citations}


def validate_owner_result(result, mode, payload=None):
    """An article draft (title, category, Markdown body), today's summary (a few short lines) or the assistant's answer
    (its sources only when they quote an article it was given); nothing else passes."""
    if not isinstance(result,dict):
        raise AIError('invalid_output')
    if mode=='ask':
        answer,cites = result.get('answer'),result.get('citations')
        if not isinstance(answer,str) or not answer.strip() or len(answer)>8000:
            raise AIError('invalid_output')
        articles = (payload or {}).get('articles',[])
        citations = []
        for cite in cites if isinstance(cites,list) else []:
            quote = cite.get('quote') if isinstance(cite,dict) else None
            article = next((a for a in articles if isinstance(quote,str) and 12<=len(quote)<=300
                            and a['id']==cite.get('article_id') and quote in a['text']),None)
            if article and article['id'] not in {c['article_id'] for c in citations}:
                citations.append({'article_id':article['id'],'title':article['title'],'quote':quote,'visibility':article['visibility']})
        return {'answer':answer.strip(),'citations':citations[:5]}
    if mode=='article':
        title,category,body = (result.get(k) for k in ('title','category','body'))
        if not all(isinstance(v,str) for v in (title,category,body)) or not title.strip() or not body.strip() \
                or len(title)>200 or len(category)>80 or len(body)>20000:
            raise AIError('invalid_output')
        return {'title':title.strip(),'category':category.strip() or 'ทั่วไป','body':body.strip()}
    lines = result.get('lines')
    if not isinstance(lines,list) or not 1<=len(lines)<=6 or not all(isinstance(l,str) and 0<len(l.strip())<=300 for l in lines):
        raise AIError('invalid_output')
    return {'lines':[l.strip() for l in lines]}


def permitted(cd, tenant_id, job, db):
    """The job may still run: organization active, bot still on, or the requester still has access."""
    if not tenants.is_active(cd,tenant_id):
        return False
    if job['mode']=='bot':
        return bot_enabled(db,job['conversation_id']) and conversation_state(db,job['conversation_id'])['mode']=='bot'
    membership = memberships.find_active_membership(cd,tenant_id,job['requested_by'])
    if not membership:
        return False
    if job['mode']=='test' or job['mode'] in OWNER_MODES:
        return membership['role']=='admin' and not membership.get('expires_at')
    if job['mode']=='ask':
        return not membership.get('expires_at')
    conv = conversations.find(db,job['conversation_id'])
    return bool(conv and (membership['role']!='agent' or membership['team_id']==conv['team_id']))


def process_one(tenant_id):
    """Claim one job and atomically publish at most one reply. Testable without a thread."""
    with D.control() as cd, D.tenant(tenant_id) as db:
        D.begin(db)
        for old in repository.running_jobs_started_before(db,after(seconds=-JOB_TIMEOUT_SECONDS)):
            repository.set_job_state(db,old['id'],'failed','timeout')
            if old['mode']=='bot':
                handoff(db,old['conversation_id'],'timeout')
        # Only one in-flight provider call per tenant, even with multiple app processes.
        if repository.any_running(db):
            return False
        job = repository.next_pending(db)
        if not job:
            return False
        cfg = config(db)
        enabled = job['mode']=='test' or (bot_enabled(db,job['conversation_id']) if job['mode']=='bot' else cfg['drafts_enabled'])
        if not permitted(cd,tenant_id,job,db) or cfg['version']!=job['config_version'] or not enabled:
            repository.set_job_state(db,job['id'],'cancelled','stale')
            return True
        lease = uid()
        repository.claim(db,job['id'],lease)
        owner = job['mode'] in PAYLOAD_MODES
        if job['mode']=='test':
            payload,articles,signature = {'test':'Bookdose connection check'},[],None
        elif owner:
            # Built when the owner asked (ai/insights.py), from counts and customers' questions only.
            payload,articles,signature = json.loads(job['payload'] or '{}'),[],None
        else:
            payload,articles,signature = snapshot(db,job)
        webhook = repository.read_webhook(tenant_id)
        key = repository.read_key(tenant_id)
    usage = {'input_tokens':0,'output_tokens':0}
    error = None

    def ask():
        # The organization's n8n workflow when it connected one, otherwise OpenAI; the answer is checked the same way.
        if webhook:
            return ai_webhook.call(webhook,cfg,payload,job['mode'])
        return openai_client.call_provider(key,cfg,payload,job['mode'])
    try:
        if not webhook and not key:
            raise AIError('not_configured')
        if owner:
            raw,usage = ask()
            result = validate_owner_result(raw,job['mode'],payload)
        elif job['mode']!='test' and not articles:
            result = {'answer':'','summary':NO_KNOWLEDGE_SUMMARY,'needs_human':True,'citations':[]}
        else:
            raw,usage = ask()
            result = validate_result(raw,articles,job['mode'])
    except AIError as failure:
        error = failure.code
        result = {}
    except Exception:
        # Never log provider response bodies or credentials.
        error,result = 'provider',{}
    with D.control() as cd, D.tenant(tenant_id) as db:
        # Lock order is always control -> tenant, including the final permission check.
        D.begin(cd)
        D.begin(db)
        current = repository.find_job(db,job['id'])
        if current['lease']!=lease:
            return True
        repository.set_usage(db,job['id'],usage)
        if current['status']!='running':
            return True
        unchanged = job['mode']=='test' or owner or signature==snapshot(db,job)[2]
        if not permitted(cd,tenant_id,job,db) or cfg['version']!=config(db)['version'] or not unchanged:
            repository.set_job_state(db,job['id'],'cancelled','stale')
            if job['mode']=='bot' and tenants.is_active(cd,tenant_id):
                handoff(db,job['conversation_id'],'changed')
            return True
        if job['mode']=='draft' and not error:
            result['_context_hash'] = signature
        if job['conversation_id']:
            # A finished draft is for staff; a chatbot job also changes what the customer sees (pending answer).
            realtime.conversation(db,job['conversation_id'],public=job['mode']=='bot',listed=False)
        repository.finish_job(db,job['id'],'failed' if error else 'done',json.dumps(result,ensure_ascii=False),error or '')
        if job['mode']=='bot':
            if error or result.get('needs_human'):
                handoff(db,job['conversation_id'],error or 'insufficient_knowledge')
            else:
                system_message(db,job['conversation_id'],result['answer'],'ai',result['citations'],job,signature,notice='ai')
        audit.record(db,'Bookdose AI','ai.'+('failed' if error else 'completed'),job['conversation_id'] or job['id'],job['mode']+(':'+error if error else ''))
    return True


def save_settings(db, ctx, body):
    """Update AI modes, model, limits and the API key. Any change cancels in-flight AI work and hands bot chats to staff."""
    cfg,model,key,remove = schema.settings_form(body,config(db))
    change = schema.webhook_form(body)
    effective_key = '' if remove else key or repository.read_key(ctx['tenant_id'])
    saved = repository.read_webhook(ctx['tenant_id'])
    # Left empty, the URL and the secret keep what was saved (so the secret alone can be changed).
    require(change in (None,False) or change['url'] or saved,'กรุณาใส่ URL ของ Webhook')
    webhook = None if change is False else saved if change is None else \
        {'url':change['url'] or saved['url'],'secret':change['secret'] or (saved or {}).get('secret','')}
    require(not webhook or webhook['secret'],'กรุณาตั้งรหัสลับของ Webhook (ใส่ค่าเดียวกันใน Header Auth ของ n8n)')
    require(effective_key or webhook or not (cfg['drafts_enabled'] or cfg['chatbot_enabled']),
            'ต้องเชื่อม AI (OpenAI API Key หรือ n8n Webhook) ก่อนเปิด AI หรือปิดทั้งสองโหมดก่อนลบการเชื่อมต่อ')
    D.begin(db)
    if key or remove:
        repository.write_key(ctx['tenant_id'],effective_key)
    if change is not None:
        repository.write_webhook(ctx['tenant_id'],webhook)
    repository.save_settings(db,[('ai_drafts',str(int(cfg['drafts_enabled']))),('ai_chatbot',str(int(cfg['chatbot_enabled']))),
        ('ai_model',model),('ai_daily_limit',str(cfg['daily_limit'])),('ai_conversation_limit',str(cfg['conversation_limit'])),
        ('ai_max_output_tokens',str(cfg['max_output_tokens'])),('ai_version',uid())])
    # An edit invalidates in-flight work, including key/model changes.
    waiting = repository.waiting_bot_conversations(db)
    repository.cancel_all_in_flight(db)
    for conversation_id in waiting:
        handoff(db,conversation_id,'settings_changed')
    if not cfg['chatbot_enabled']:
        repository.disable_web_bots(db)
    audit.record(db,ctx['name'],'ai.settings_updated',ctx['tenant_id'])
    db.commit()
    return overview(db,ctx['tenant_id'])


def queue_connection_test(db, ctx):
    D.begin(db)
    job_id = enqueue(db,ctx['tenant_id'],'test',requested_by=ctx['id'])
    db.commit()
    return job_id


def find_job(db, job_id):
    return repository.find_job(db,job_id)


def job_view(db, ctx, job_id):
    """Status and result of a job the user requested. A finished draft whose conversation or settings changed is reported as stale."""
    job = repository.job_for_user(db,job_id,ctx['id'])
    require(job,'ไม่พบงาน AI',404)
    if job['conversation_id']:
        get_scoped(db,'conversations',job['conversation_id'],ctx)
    else:
        require(ctx['role']=='admin' or job['mode']=='ask','เฉพาะผู้ดูแลองค์กร',403)
    result = json.loads(job['result'])
    signature = result.pop('_context_hash',None)
    if job['mode']=='draft' and job['status']=='done' and (signature!=snapshot(db,job)[2] or job['config_version']!=config(db)['version']):
        job['status'],job['error'],result = 'cancelled','stale',{}
    return schema.job_view(job,result)


class Worker:
    """Background thread: every second, one job per active organization."""
    def __init__(self):
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.run,name='bookdose-ai',daemon=True)

    def start(self):
        self.thread.start()

    def run(self):
        while not self.stop.wait(1):
            with D.control() as cd:
                ids = tenants.active_tenant_ids(cd)
            monitor.heartbeat('ai')
            for tenant_id in ids:
                if self.stop.is_set():
                    return
                try:
                    process_one(tenant_id)
                except Exception as error:
                    print(f'AI worker: {type(error).__name__}; retrying queue scan',flush=True)
                    monitor.error('ai',type(error).__name__)
