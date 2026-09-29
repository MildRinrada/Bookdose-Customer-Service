"""The service report's parts that the case list cannot tell, for the period the report shows:

  hours     new conversations by weekday and hour of the viewer's time (how busy each hour was); an agent sees their
            own team's, a lead the team picked or every team
  bot       (leads) the chatbot's conversations: answered alone, handed to a person and why, day by day
  articles  (leads) the articles the team copied, put in replies or sent as links, and the ones marked not helpful
  gaps      (the organization's owner) customers' questions that no public article answers, as on the overview
  assistant (leads) the staff's AI assistant: questions answered, proposals done, and ถูกใจ / ไม่ถูกใจ with the reasons
            and comments (never who wrote them)
  case_stats  every member, the cases they may see touched in the period or the one before it: how long the customer
            waited for each next reply, how many replies the team wrote and how upset the customer got (stats.py)

Periods are whole local days: `from` and `to` (YYYY-MM-DD) and the browser's time zone offset."""
import datetime as dt
import re
import threading
import time
from collections import defaultdict

from backend.database.db import rows
from backend.middleware.access import visible_team
from backend.modules.ai import insights, service as ai
from backend.modules.automation import schema as automation_schema
from backend.utils.dates import iso
from backend.utils.validation import require

MAX_DAYS = 366
TOP_ARTICLES = 8
UNHELPFUL_ARTICLES = 5
LEADS = ('admin','manager')
DAY = re.compile(r'\d{4}-\d{2}-\d{2}')
CACHE_SECONDS = 120          # the questions are the slow part; the page asks again when the filter changes

_gaps = {}
_gaps_lock = threading.Lock()


def _arg(query, name):
    return (query.get(name) or [''])[0]


def period(query):
    """(since, until, tz, first day): the UTC bounds of the local days from..to."""
    start,end = _arg(query,'from'),_arg(query,'to')
    require(DAY.fullmatch(start) and DAY.fullmatch(end),'เลือกช่วงวันที่ให้ถูกต้อง')
    try:
        first,last = dt.date.fromisoformat(start),dt.date.fromisoformat(end)
    except ValueError:
        require(False,'เลือกช่วงวันที่ให้ถูกต้อง')
    require(first<=last,'วันเริ่มต้นต้องไม่อยู่หลังวันสิ้นสุด')
    require((last-first).days<MAX_DAYS,'เลือกช่วงได้ไม่เกิน 1 ปี')
    tz = automation_schema.tz_offset(query)
    bound = lambda day: iso(dt.datetime.combine(day,dt.time(),dt.timezone.utc)+dt.timedelta(minutes=tz))
    return bound(first),bound(last+dt.timedelta(days=1)),tz,first


def _local(value, tz):
    try:
        return dt.datetime.fromisoformat(value)-dt.timedelta(minutes=tz)
    except (TypeError,ValueError):
        return None


def busy_hours(db, since, until, tz, team_id):
    """New conversations per weekday (0 = Sunday, as in JavaScript) and hour of the viewer's time."""
    grid = [[0]*24 for _ in range(7)]
    for (value,) in db.execute('SELECT created_at FROM conversations WHERE created_at>=? AND created_at<? AND (? IS NULL OR team_id=?)',
                               (since,until,team_id,team_id)).fetchall():
        moment = _local(value,tz)
        if moment:
            grid[(moment.weekday()+1)%7][moment.hour] += 1
    return {'counts':grid,'total':sum(map(sum,grid))}


def bot(db, since, until, tz, first):
    """The chatbot's result for the period and per local day (resolved, handed to a person, still going)."""
    summary = insights.bot_performance(db,since,until)
    days = defaultdict(lambda:{'resolved':0,'handed_off':0,'waiting':0})
    for r in insights.bot_conversations(db,since,until):
        moment = _local(r['created_at'],tz)
        if not moment:
            continue
        outcome = 'handed_off' if r['mode']=='human' else 'resolved' if r['answered'] else 'waiting'
        days[(moment.date()-first).days][outcome] += 1
    return {**summary,'days':[{'day':(first+dt.timedelta(days=i)).isoformat(),**counts} for i,counts in sorted(days.items())]}


def articles(db, since, until):
    """The articles the team used most in the period (by how), and the ones marked not helpful more than helpful."""
    used = rows(db,'''SELECT a.id,a.title,a.category,a.visibility,COUNT(*) AS uses,
                      SUM(u.kind='copy') AS copied,SUM(u.kind='insert') AS inserted,SUM(u.kind='link') AS linked,
                      COUNT(DISTINCT u.user_id) AS people
                      FROM knowledge_uses u JOIN knowledge_articles a ON a.id=u.article_id
                      WHERE u.created_at>=? AND u.created_at<? GROUP BY a.id ORDER BY uses DESC,a.title LIMIT ?''',(since,until,TOP_ARTICLES))
    votes = {r['article_id']:r for r in rows(db,'''SELECT article_id,SUM(vote=1) AS helpful,SUM(vote=-1) AS unhelpful
                                                   FROM knowledge_marks GROUP BY article_id''')}
    for row in used:
        mark = votes.get(row['id'])
        row['helpful'],row['unhelpful'] = (mark['helpful'] or 0,mark['unhelpful'] or 0) if mark else (0,0)
    unhelpful = rows(db,'''SELECT a.id,a.title,a.category,a.updated_at,SUM(m.vote=1) AS helpful,SUM(m.vote=-1) AS unhelpful
                           FROM knowledge_marks m JOIN knowledge_articles a ON a.id=m.article_id GROUP BY a.id
                           HAVING SUM(m.vote=-1)>0 AND SUM(m.vote=-1)>=SUM(m.vote=1)
                           ORDER BY SUM(m.vote=-1)-SUM(m.vote=1) DESC,SUM(m.vote=-1) DESC LIMIT ?''',(UNHELPFUL_ARTICLES,))
    totals = db.execute('''SELECT COUNT(*),COUNT(DISTINCT article_id) FROM knowledge_uses WHERE created_at>=? AND created_at<?''',
                        (since,until)).fetchone()
    # What customers said of the published ones in the period (knowledge/feedback.py).
    from backend.modules.knowledge import feedback
    return {'top':used,'unhelpful':unhelpful,'uses':totals[0],'used_articles':totals[1],
            'articles':db.execute('SELECT COUNT(*) FROM knowledge_articles').fetchone()[0],'customers':feedback.report(db,since,until)}


def gaps(db, tenant_id, since, until):
    key = (tenant_id,since,until)
    with _gaps_lock:
        cached = _gaps.get(key)
        if cached and cached[0]>time.monotonic():
            return cached[1]
    value = insights.knowledge_gaps(db,since,until)
    with _gaps_lock:
        for stale in [k for k,v in _gaps.items() if v[0]<=time.monotonic()]:
            _gaps.pop(stale,None)
        _gaps[key] = (time.monotonic()+CACHE_SECONDS,value)
    return value


def forget(tenant_id):
    """A new article may close a gap: the report counts again."""
    with _gaps_lock:
        for key in [k for k in _gaps if k[0]==tenant_id]:
            _gaps.pop(key,None)


def extras(db, ctx, query):
    since,until,tz,first = period(query)
    team = visible_team(ctx) or _arg(query,'team') or None
    # The period before counts too: every figure is compared with it.
    start,end = dt.datetime.fromisoformat(since),dt.datetime.fromisoformat(until)
    before = iso(start-(end-start))
    from backend.modules.reports import stats
    result = {'hours':busy_hours(db,since,until,tz,team),'bot':None,'articles':None,'gaps':None,'ai':None,'assistant':None,
              'case_stats':stats.case_stats(db,before,team)}
    if ctx['role'] in LEADS:
        from backend.modules.ai import repository as ai_repository
        cfg = ai.config(db)
        result.update(bot=bot(db,since,until,tz,first),articles=articles(db,since,until),assistant=ai_repository.assistant_report(db,since,until),
                      ai={'drafts_enabled':cfg['drafts_enabled'],'chatbot_enabled':cfg['chatbot_enabled'],'key_configured':ai.has_key(ctx['tenant_id'])})
    if ctx['role']=='admin' and not ctx.get('read_only'):
        result['gaps'] = gaps(db,ctx['tenant_id'],since,until)
    return result
