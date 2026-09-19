"""What the overview tells an organization's owner about the chatbot and the knowledge base, and the AI they may ask
for there:

  bot_performance  of the conversations the chatbot started in a period: how many it answered without passing them
                   on, how many went to a person and why (the service report and today's summary)
  knowledge_gaps   customers' first questions that no public article answers (or that the chatbot found no article
                   for), grouped when they ask the same thing, most asked first
  request_article  an AI job that drafts an article from one group of those questions (the owner edits and saves it)
  request_brief    an AI job that sums up today in a few lines, from counts and today's questions only

The questions are the customers' own words, read by the organization's owner only; before any of them goes to the
AI provider, email addresses and phone numbers are masked."""
import json
import re
import threading
import time
from collections import Counter

from backend.database.db import one, rows
from backend.exceptions.errors import AIError
from backend.modules.ai import repository, schema, service
from backend.utils.dates import after, now
from backend.utils.validation import require

INSIGHT_DAYS = 30
QUESTION_LIMIT = 300          # the latest conversations read for questions
GROUP_LIMIT = 6
SIMILAR = 0.25                # two questions whose trigram sets overlap this much ask the same thing
COVERED = 0.3                 # an article answers a question when it shares this share of the question's trigrams
CACHE_SECONDS = 120           # the overview refreshes every 30 s; the gaps are worth recounting every two minutes
ARTICLE_QUESTIONS = 12
BRIEF_SUBJECTS = 40
ID = re.compile(r'[a-f0-9]{32}')

_cache = {}
_cache_lock = threading.Lock()


def _mask(text):
    """Customers' words without email addresses or phone numbers (before they leave for the AI provider)."""
    text = re.sub(r'[\w.+-]+@[\w-]+\.[\w.-]+','[อีเมล]',text)
    return re.sub(r'(?<!\d)(?:\+?66|0)[\d\s-]{8,11}\d','[เบอร์โทร]',text)


def _plain(text, limit):
    return re.sub(r'\s+',' ',text or '').strip()[:limit]


# The chatbot
FAR = '9999'


def bot_conversations(db, since, until=FAR):
    """Conversations the chatbot started between then (it was on when they began, or it handed them to a person),
    with when they began, whether it answered, and its mode and handoff reason now."""
    return rows(db,'''SELECT a.conversation_id,a.mode,a.reason,c.created_at,
                  EXISTS(SELECT 1 FROM messages m JOIN ai_message_meta x ON x.message_id=m.id
                         WHERE m.conversation_id=a.conversation_id AND x.source='ai') AS answered
                  FROM ai_conversations a JOIN conversations c ON c.id=a.conversation_id
                  WHERE c.created_at>=? AND c.created_at<? AND (a.mode='bot' OR a.reason!='')''',(since,until))


def bot_performance(db, since, until=FAR):
    """resolved = the chatbot answered and nobody had to take over; handed_off = a person took over, counted by why."""
    started = bot_conversations(db,since,until)
    resolved = sum(1 for r in started if r['mode']=='bot' and r['answered'])
    handed = [r for r in started if r['mode']=='human']
    answers = db.execute('''SELECT COUNT(*) FROM messages m JOIN ai_message_meta x ON x.message_id=m.id
                            WHERE x.source='ai' AND m.created_at>=? AND m.created_at<?''',(since,until)).fetchone()[0]
    return {'conversations':len(started),'resolved':resolved,'handed_off':len(handed),
            'waiting':len(started)-resolved-len(handed),'answers':answers,
            'reasons':[{'reason':reason,'count':count} for reason,count in Counter(r['reason'] for r in handed).most_common()]}


# Questions no article answers
def _article_index(db):
    return [(service.features(a['title']),service.features(a['title']+' '+a['body'][:20000]))
            for a in repository.articles(db,True)]


def _covered(question, index):
    for title,body in index:
        shared = question & body
        if shared and len(shared)+2*len(question & title)>=max(3,COVERED*len(question)):
            return True
    return False


def _questions(db, since, limit=QUESTION_LIMIT, until=FAR):
    """Each conversation's first customer message (not a bare "let me talk to a person"), newest first."""
    found = []
    for row in rows(db,'''SELECT c.id,c.created_at,a.reason,
                          (SELECT m.body FROM messages m WHERE m.conversation_id=c.id AND m.kind='customer'
                           ORDER BY m.created_at,m.rowid LIMIT 1) AS question
                          FROM conversations c LEFT JOIN ai_conversations a ON a.conversation_id=c.id
                          WHERE c.created_at>=? AND c.created_at<? AND c.channel!='manual' ORDER BY c.created_at DESC LIMIT ?''',(since,until,limit)):
        text = _plain(row['question'],500)
        if not text or (service.requests_human(text) and len(text)<40):
            continue
        found.append({**row,'question':text,'features':service.features(text)})
    return [q for q in found if len(q['features'])>=4]


def knowledge_gaps(db, since, until=FAR):
    index = _article_index(db)
    gaps = [q for q in _questions(db,since,until=until) if q['reason']=='insufficient_knowledge' or not _covered(q['features'],index)]
    groups = []
    for q in gaps:
        home = next((g for g in groups if len(q['features'] & g['features'])/len(q['features'] | g['features'])>=SIMILAR),None)
        if home:
            home['members'].append(q)
        else:
            groups.append({'features':q['features'],'members':[q]})
    # Most asked first; among equals, the one asked most recently (questions arrive newest first).
    groups.sort(key=lambda g:-len(g['members']))
    return {'total':len(gaps),'groups':[{
        'label':_plain(g['members'][0]['question'],120),'count':len(g['members']),
        'bot_unsure':sum(1 for m in g['members'] if m['reason']=='insufficient_knowledge'),
        'examples':[_plain(m['question'],160) for m in g['members'][1:4]],
        'conversations':[m['id'] for m in g['members'][:20]],'last_at':g['members'][0]['created_at']}
        for g in groups[:GROUP_LIMIT]]}


def overview(db, tenant_id):
    """The owner's cards on the overview, counted again at most every two minutes per organization."""
    with _cache_lock:
        cached = _cache.get(tenant_id)
        if cached and cached[0]>time.monotonic():
            return cached[1]
    since = after(days=-INSIGHT_DAYS)
    cfg = service.config(db)
    # How the chatbot did is in the service report (reports/service.py); the overview keeps what asks for action.
    value = {'days':INSIGHT_DAYS,'gaps':knowledge_gaps(db,since),
             'ai':{'drafts_enabled':cfg['drafts_enabled'],'chatbot_enabled':cfg['chatbot_enabled'],'key_configured':service.has_key(tenant_id)}}
    with _cache_lock:
        _cache[tenant_id] = (time.monotonic()+CACHE_SECONDS,value)
    return value


def forget(tenant_id):
    """A new article may close a gap: the next overview counts again."""
    from backend.modules.reports import service as reports
    with _cache_lock:
        _cache.pop(tenant_id,None)
    reports.forget(tenant_id)


# The owner's AI
def _queue(db, ctx, mode, payload):
    from backend.database import db as D
    D.begin(db)
    try:
        job_id = service.enqueue(db,ctx['tenant_id'],mode,requested_by=ctx['id'],payload=payload)
    except AIError:
        db.rollback()
        raise
    db.commit()
    return job_id


def request_article(db, ctx, body):
    """Draft an article from the questions of the conversations given (one group of knowledge_gaps). The questions
    are read again here: only conversations of this organization, and only their first customer message."""
    ids = body.get('conversation_ids') if isinstance(body,dict) else None
    require(isinstance(ids,list) and 0<len(ids)<=20 and all(isinstance(i,str) and ID.fullmatch(i) for i in ids),'เลือกกลุ่มคำถามก่อน')
    marks = ','.join('?'*len(ids))
    found = rows(db,f'''SELECT (SELECT m.body FROM messages m WHERE m.conversation_id=c.id AND m.kind='customer'
                        ORDER BY m.created_at,m.rowid LIMIT 1) AS question FROM conversations c WHERE c.id IN ({marks})''',ids)
    questions = [_mask(_plain(r['question'],500)) for r in found if r['question']][:ARTICLE_QUESTIONS]
    require(questions,'ไม่พบคำถามของกลุ่มนี้',404)
    existing = rows(db,'SELECT title,category FROM knowledge_articles ORDER BY updated_at DESC LIMIT 80')
    payload = {'questions':questions,'existing_articles':[{'title':a['title'],'category':a['category']} for a in existing],
               'categories':sorted({a['category'] for a in existing})}
    return _queue(db,ctx,'article',payload)


def _count_by(db, sql, params):
    return {key or 'อื่นๆ':count for key,count in db.execute(sql,params).fetchall()}


def brief_payload(db, day):
    """Today against the last seven days, as counts, plus today's questions (masked) - no names, no case contents."""
    week = after(days=-7)
    today_channels = _count_by(db,'SELECT channel,COUNT(*) FROM conversations WHERE created_at>=? GROUP BY channel',(day,))
    week_channels = _count_by(db,'SELECT channel,COUNT(*) FROM conversations WHERE created_at>=? AND created_at<? GROUP BY channel',(week,day))
    ratings = one(db,'SELECT COUNT(*) AS count,AVG(rating) AS average FROM csat_surveys WHERE answered_at>=?',(day,))
    now_iso = now()
    return {
        'conversations_today_by_channel':today_channels,
        'conversations_daily_average_last_7_days_by_channel':{k:round(v/7,1) for k,v in week_channels.items()},
        'cases_opened_today':db.execute('SELECT COUNT(*) FROM tickets WHERE created_at>=?',(day,)).fetchone()[0],
        'cases_opened_today_by_category':_count_by(db,'SELECT category,COUNT(*) FROM tickets WHERE created_at>=? GROUP BY category',(day,)),
        'cases_resolved_today':db.execute('SELECT COUNT(*) FROM tickets WHERE resolved_at>=?',(day,)).fetchone()[0],
        'cases_open_now':db.execute("SELECT COUNT(*) FROM tickets WHERE status NOT IN ('resolved','closed')").fetchone()[0],
        'cases_past_sla_now':db.execute('''SELECT COUNT(*) FROM tickets WHERE status NOT IN ('resolved','closed') AND
                                          ((first_response_at IS NULL AND first_response_due_at<?) OR resolution_due_at<?)''',(now_iso,now_iso)).fetchone()[0],
        'cases_unassigned_now':db.execute("SELECT COUNT(*) FROM tickets WHERE assignee_id IS NULL AND status NOT IN ('resolved','closed')").fetchone()[0],
        'satisfaction_today':{'answers':ratings['count'],'average':round(ratings['average'],2) if ratings['average'] else None},
        'chatbot_today':bot_performance(db,day),
        'questions_today':[_mask(q['question'][:160]) for q in _questions(db,day,BRIEF_SUBJECTS)],
    }


def request_brief(db, ctx, day):
    return _queue(db,ctx,'brief',brief_payload(db,day))


def latest_brief(db, ctx, day):
    """The owner's last summary of today: the lines, or where the job stands."""
    job = repository.latest_owner_job(db,ctx['id'],'brief',day)
    if not job:
        return None
    result = json.loads(job['result'] or '{}') if job['status']=='done' else {}
    return {'id':job['id'],'status':job['status'],'lines':result.get('lines',[]),'created_at':job['created_at'],
            'error':schema.AI_ERRORS.get(job['error'],'') if job['status']=='failed' else ''}
