"""AI queries (tenant database), the organization's API key file (OpenAI or Gemini) and its n8n webhook file."""
import json

from backend.database import db as D
from backend.database.db import one, rows
from backend.utils.dates import now
from backend.utils import secret_box

IN_FLIGHT = "status IN ('pending','running')"


# API key: a private file per organization, never in the database, API responses or backups, sealed with the
# platform's secret key (utils/secret_box).
# The file keeps its first name when the key is a Gemini one: backups and restores already know it by that name.
def key_path(tenant_id):
    D.tenant_path(tenant_id)  # Validate the ID before constructing a secret path.
    return D.DATA/'secrets'/f'{tenant_id}.openai-key'


def read_key(tenant_id):
    return secret_box.read_file(key_path(tenant_id)).strip()


def write_key(tenant_id, value):
    """Save the key, or delete it when value is empty."""
    path = key_path(tenant_id)
    if not value:
        path.unlink(missing_ok=True)
        return
    secret_box.write_file(path,value)


# n8n webhook: the organization's own workflow answers instead of OpenAI. Its URL works like a password (whoever has it
# can run the workflow), so it is sealed next to the key, with the shared secret sent in X-Bookdose-Secret.
def webhook_path(tenant_id):
    D.tenant_path(tenant_id)
    return D.DATA/'secrets'/f'{tenant_id}.ai-webhook.json'


def read_webhook(tenant_id):
    """{'url','secret'}, or None when the organization has not connected one."""
    try:
        value = json.loads(secret_box.read_file(webhook_path(tenant_id)) or 'null')
    except ValueError:
        return None
    return value if isinstance(value,dict) and value.get('url') else None


def write_webhook(tenant_id, value):
    """Save {'url','secret'}, or delete the file when value is None."""
    path = webhook_path(tenant_id)
    if not value:
        path.unlink(missing_ok=True)
        return
    secret_box.write_file(path,json.dumps(value))


def widen_jobs(db):
    """Databases from before a job mode was added (the owner's article and brief, the assistant's ask) rebuild ai_jobs
    with the current mode list and the payload column; SQLite cannot change a CHECK in place. Every job is kept, with
    every column it already had. Runs once per new mode list."""
    from backend.modules.ai.model import JOBS_TABLE
    row = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='ai_jobs'").fetchone()
    if not row or "'translate'" in row[0]:
        return
    columns = ','.join(r[1] for r in db.execute('PRAGMA table_info(ai_jobs)').fetchall())
    db.commit()
    # The copy is the same rows: their references were checked when written (and the pragma only works outside a
    # transaction).
    db.execute('PRAGMA foreign_keys=OFF')
    try:
        db.execute('BEGIN IMMEDIATE')
        db.execute('DROP TABLE IF EXISTS ai_jobs_wide')
        db.execute(JOBS_TABLE.format(name='ai_jobs_wide'))
        db.execute(f'INSERT INTO ai_jobs_wide({columns}) SELECT {columns} FROM ai_jobs')
        db.execute('DROP TABLE ai_jobs')
        db.execute('ALTER TABLE ai_jobs_wide RENAME TO ai_jobs')
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS ai_bot_trigger ON ai_jobs(trigger_id) WHERE mode='bot'")
        db.execute('CREATE INDEX IF NOT EXISTS ai_jobs_pending ON ai_jobs(status,created_at)')
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.execute('PRAGMA foreign_keys=ON')


# Settings
def settings(db):
    return dict(db.execute("SELECT key,value FROM settings WHERE key LIKE 'ai_%'").fetchall())


def save_settings(db, pairs):
    db.executemany('UPDATE settings SET value=? WHERE key=?',[(value,key) for key,value in pairs])


# Conversation mode (human or bot)
def conversation_mode(db, conversation_id):
    return one(db,'SELECT mode,reason FROM ai_conversations WHERE conversation_id=?',(conversation_id,))


def set_human(db, conversation_id, reason):
    db.execute('''INSERT INTO ai_conversations VALUES(?,'human',?,?) ON CONFLICT(conversation_id)
                  DO UPDATE SET mode='human',reason=excluded.reason,updated_at=excluded.updated_at''',
               (conversation_id,reason,now()))


def set_bot(db, conversation_id):
    db.execute("INSERT INTO ai_conversations VALUES(?,'bot','',?) ON CONFLICT(conversation_id) DO UPDATE SET mode='bot',reason='',updated_at=excluded.updated_at",(conversation_id,now()))


def set_initial_mode(db, conversation_id, mode):
    """Only for a new conversation; an existing mode is kept."""
    db.execute('INSERT OR IGNORE INTO ai_conversations VALUES(?,?,?,?)',(conversation_id,mode,'',now()))


def disable_web_bots(db):
    db.execute("UPDATE ai_conversations SET mode='human',reason='disabled',updated_at=? WHERE mode='bot' AND conversation_id IN (SELECT id FROM conversations WHERE channel='web')",(now(),))


def insert_message_meta(db, message_id, source, citations_json):
    db.execute('INSERT INTO ai_message_meta VALUES(?,?,?)',(message_id,source,citations_json))


# Jobs
def usage_since(db, day):
    return one(db,'''SELECT COUNT(*) AS requests,COALESCE(SUM(input_tokens),0) AS input_tokens,
           COALESCE(SUM(output_tokens),0) AS output_tokens FROM ai_jobs WHERE created_at>=?''',(day,))


def has_pending_bot_job(db, conversation_id):
    return bool(one(db,f"SELECT id FROM ai_jobs WHERE conversation_id=? AND mode='bot' AND {IN_FLIGHT}",(conversation_id,)))


def cancel_bot_jobs(db, conversation_id):
    db.execute(f"UPDATE ai_jobs SET status='cancelled',error='stale',updated_at=? WHERE conversation_id=? AND mode='bot' AND {IN_FLIGHT}",(now(),conversation_id))


def cancel_all_in_flight(db):
    db.execute(f"UPDATE ai_jobs SET status='cancelled',error='stale',updated_at=? WHERE {IN_FLIGHT}",(now(),))


def waiting_bot_conversations(db):
    return [row['conversation_id'] for row in rows(db,f"SELECT DISTINCT conversation_id FROM ai_jobs WHERE mode='bot' AND {IN_FLIGHT}")]


def bot_job_for_trigger(db, trigger_id):
    row = one(db,"SELECT id FROM ai_jobs WHERE trigger_id=? AND mode='bot'",(trigger_id,))
    return row['id'] if row else None


def pending_draft(db, conversation_id, user_id):
    row = one(db,f"SELECT id FROM ai_jobs WHERE conversation_id=? AND requested_by=? AND mode='draft' AND {IN_FLIGHT}",(conversation_id,user_id))
    return row['id'] if row else None


# Work done on every message counts on its own against the daily limit (ai/mood.py, ai/translate.py): reading and
# translating a busy day's messages must never use up what the chatbot and the team's drafts need.
OWN_COUNT_MODES = ('mood','translate')


def jobs_since(db, day, mode=None):
    """Jobs queued since `day` against the daily limit: of `mode` when it counts on its own, else all the others."""
    if mode in OWN_COUNT_MODES:
        return db.execute('SELECT COUNT(*) FROM ai_jobs WHERE created_at>=? AND mode=?',(day,mode)).fetchone()[0]
    return db.execute(f"SELECT COUNT(*) FROM ai_jobs WHERE created_at>=? AND mode NOT IN {OWN_COUNT_MODES}",(day,)).fetchone()[0]


def bot_jobs_for_conversation(db, conversation_id):
    return db.execute("SELECT COUNT(*) FROM ai_jobs WHERE conversation_id=? AND mode='bot'",(conversation_id,)).fetchone()[0]


def insert_job(db, job_id, conversation_id, trigger_id, requested_by, mode, config_version, payload='{}'):
    db.execute('''INSERT INTO ai_jobs(id,conversation_id,trigger_id,requested_by,mode,status,config_version,created_at,updated_at,payload)
                  VALUES(?,?,?,?,?,'pending',?,?,?,?)''',
               (job_id,conversation_id,trigger_id,requested_by,mode,config_version,now(),now(),payload))


def latest_owner_job(db, user_id, mode, since):
    """The member's newest article or brief job since then (the overview shows the last brief of the day)."""
    return one(db,'SELECT * FROM ai_jobs WHERE requested_by=? AND mode=? AND created_at>=? ORDER BY created_at DESC,rowid DESC LIMIT 1',
               (user_id,mode,since))


def pending_owner_job(db, user_id, mode):
    row = one(db,f'SELECT id FROM ai_jobs WHERE requested_by=? AND mode=? AND {IN_FLIGHT}',(user_id,mode))
    return row['id'] if row else None


def find_job(db, job_id):
    return one(db,'SELECT * FROM ai_jobs WHERE id=?',(job_id,))


def job_for_user(db, job_id, user_id):
    return one(db,'SELECT * FROM ai_jobs WHERE id=? AND requested_by=?',(job_id,user_id))


def running_jobs_started_before(db, before):
    return rows(db,"SELECT * FROM ai_jobs WHERE status='running' AND updated_at<?",(before,))


def any_running(db, since):
    """A provider call is under way: a running job, or one cancelled while its call was out (it keeps its lease until
    the call comes back, process_one releases it) - up to `since`, in case the process died with the call out."""
    return bool(one(db,"SELECT 1 FROM ai_jobs WHERE status='running' OR (status='cancelled' AND lease IS NOT NULL AND updated_at>=?)",(since,)))


def release(db, job_id):
    """The job's provider call has come back."""
    db.execute('UPDATE ai_jobs SET lease=NULL WHERE id=?',(job_id,))


# The order the worker takes waiting jobs in (next_pending).
TURN = "CASE WHEN mode='translate' THEN -1 WHEN mode='mood' THEN 2 WHEN mode='summary' AND requested_by IS NULL THEN 1 ELSE 0 END"


def next_pending(db):
    """The oldest waiting job that somebody is waiting for - a translation first (a reply is held for it, or a member is
    reading); a summary written ahead of time (ai/summary.py), then a mood reading (ai/mood.py), only once none is left."""
    return one(db,f"SELECT * FROM ai_jobs WHERE status='pending' ORDER BY {TURN},created_at,rowid LIMIT 1")


def jobs_ahead(db, job_id):
    """How many jobs the worker does before this waiting one: the one it is on now, and those next_pending takes first
    (as things stand; a translation asked later still goes first)."""
    me = one(db,f'SELECT {TURN} AS turn,created_at,rowid AS n FROM ai_jobs WHERE id=?',(job_id,))
    if not me:
        return 0
    return db.execute(f"""SELECT COUNT(*) FROM ai_jobs WHERE id!=? AND (status='running'
                          OR (status='pending' AND ({TURN},created_at,rowid)<(?,?,?)))""",(job_id,me['turn'],me['created_at'],me['n'])).fetchone()[0]


def set_job_state(db, job_id, status, error):
    db.execute('UPDATE ai_jobs SET status=?,error=?,updated_at=? WHERE id=?',(status,error,now(),job_id))


def claim(db, job_id, lease):
    db.execute("UPDATE ai_jobs SET status='running',lease=?,updated_at=? WHERE id=?",(lease,now(),job_id))


def set_usage(db, job_id, usage):
    db.execute('UPDATE ai_jobs SET input_tokens=?,output_tokens=? WHERE id=?',(usage['input_tokens'],usage['output_tokens'],job_id))


def finish_job(db, job_id, status, result_json, error):
    db.execute('UPDATE ai_jobs SET status=?,result=?,error=?,updated_at=? WHERE id=?',(status,result_json,error,now(),job_id))


# ถูกใจ / ไม่ถูกใจ under the assistant's answers
def save_feedback(db, job_id, user_id, rating, reason, comment):
    db.execute('''INSERT INTO ai_feedback(job_id,user_id,rating,reason,comment,updated_at) VALUES(?,?,?,?,?,?)
                  ON CONFLICT(job_id) DO UPDATE SET rating=excluded.rating,reason=excluded.reason,comment=excluded.comment,
                  updated_at=excluded.updated_at''',(job_id,user_id,rating,reason,comment,now()))


def delete_feedback(db, job_id):
    db.execute('DELETE FROM ai_feedback WHERE job_id=?',(job_id,))


def assistant_report(db, since, until):
    """The assistant's answers asked in the period: how many, how many proposed something and how many of those were
    done, how many failed, and what the members who asked thought of them (counts, reasons, the latest comments)."""
    asked = one(db,"""SELECT COUNT(*) AS asked,COALESCE(SUM(status='done'),0) AS answered,COALESCE(SUM(status='failed'),0) AS failed,
                      COALESCE(SUM(status='done' AND json_array_length(result,'$.actions')>0),0) AS proposed,
                      COALESCE(SUM(status='done' AND json_type(result,'$.ran') IS NOT NULL),0) AS ran,
                      COUNT(DISTINCT requested_by) AS people
                      FROM ai_jobs WHERE mode='ask' AND created_at>=? AND created_at<?""",(since,until))
    marks = rows(db,"""SELECT f.rating,f.reason,COUNT(*) AS n FROM ai_feedback f JOIN ai_jobs j ON j.id=f.job_id
                       WHERE j.created_at>=? AND j.created_at<? GROUP BY f.rating,f.reason""",(since,until))
    comments = rows(db,"""SELECT f.reason,f.comment,f.updated_at FROM ai_feedback f JOIN ai_jobs j ON j.id=f.job_id
                          WHERE j.created_at>=? AND j.created_at<? AND f.rating='down' AND f.comment!=''
                          ORDER BY f.updated_at DESC LIMIT 5""",(since,until))
    reasons = {}
    for m in marks:
        if m['rating']=='down':
            reasons[m['reason'] or 'unsaid'] = reasons.get(m['reason'] or 'unsaid',0)+m['n']
    return {**asked,'up':sum(m['n'] for m in marks if m['rating']=='up'),'down':sum(reasons.values()),
            'reasons':[{'reason':k,'count':v} for k,v in sorted(reasons.items(),key=lambda item:-item[1])],'comments':comments}


# What the model may read
def articles(db, public_only):
    return rows(db,'SELECT id,title,body,visibility,updated_at FROM knowledge_articles'+(" WHERE visibility='public'" if public_only else ''))


def recent_messages(db, conversation_id, public, exclude_message=None, only_message=None):
    """The latest 14 messages, oldest first, with attachment counts (never attachment contents).
    public leaves out internal notes; only_message limits the list to one message (a LINE group call)."""
    extra = " AND kind!='note'" if public else ''
    params = [conversation_id]
    if exclude_message:
        extra += ' AND id!=?'
        params.append(exclude_message)
    if only_message:
        extra += ' AND id=?'
        params.append(only_message)
    return rows(db,'''SELECT id,kind,body,(SELECT COUNT(*) FROM attachments a WHERE a.message_id=messages.id) AS attachment_count
                      FROM messages WHERE conversation_id=?'''+extra+' ORDER BY rowid DESC LIMIT 14',params)[::-1]
