"""AI queries (tenant database) and the organization's OpenAI API key file."""
from backend.database import db as D
from backend.database.db import one, rows
from backend.utils.dates import now
from backend.utils.files import write_private_file

IN_FLIGHT = "status IN ('pending','running')"


# API key: a private file per organization, never in the database, API responses or backups.
def key_path(tenant_id):
    D.tenant_path(tenant_id)  # Validate the ID before constructing a secret path.
    return D.DATA/'secrets'/f'{tenant_id}.openai-key'


def read_key(tenant_id):
    path = key_path(tenant_id)
    return path.read_text().strip() if path.is_file() else ''


def write_key(tenant_id, value):
    """Save the key, or delete it when value is empty."""
    path = key_path(tenant_id)
    if not value:
        path.unlink(missing_ok=True)
        return
    write_private_file(path,value)


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


def jobs_since(db, day):
    return db.execute('SELECT COUNT(*) FROM ai_jobs WHERE created_at>=?',(day,)).fetchone()[0]


def bot_jobs_for_conversation(db, conversation_id):
    return db.execute("SELECT COUNT(*) FROM ai_jobs WHERE conversation_id=? AND mode='bot'",(conversation_id,)).fetchone()[0]


def insert_job(db, job_id, conversation_id, trigger_id, requested_by, mode, config_version):
    db.execute('''INSERT INTO ai_jobs(id,conversation_id,trigger_id,requested_by,mode,status,config_version,created_at,updated_at)
                  VALUES(?,?,?,?,?,'pending',?,?,?)''',
               (job_id,conversation_id,trigger_id,requested_by,mode,config_version,now(),now()))


def find_job(db, job_id):
    return one(db,'SELECT * FROM ai_jobs WHERE id=?',(job_id,))


def job_for_user(db, job_id, user_id):
    return one(db,'SELECT * FROM ai_jobs WHERE id=? AND requested_by=?',(job_id,user_id))


def running_jobs_started_before(db, before):
    return rows(db,"SELECT * FROM ai_jobs WHERE status='running' AND updated_at<?",(before,))


def any_running(db):
    return bool(one(db,"SELECT 1 FROM ai_jobs WHERE status='running'"))


def next_pending(db):
    return one(db,"SELECT * FROM ai_jobs WHERE status='pending' ORDER BY created_at,rowid LIMIT 1")


def set_job_state(db, job_id, status, error):
    db.execute('UPDATE ai_jobs SET status=?,error=?,updated_at=? WHERE id=?',(status,error,now(),job_id))


def claim(db, job_id, lease):
    db.execute("UPDATE ai_jobs SET status='running',lease=?,updated_at=? WHERE id=?",(lease,now(),job_id))


def set_usage(db, job_id, usage):
    db.execute('UPDATE ai_jobs SET input_tokens=?,output_tokens=? WHERE id=?',(usage['input_tokens'],usage['output_tokens'],job_id))


def finish_job(db, job_id, status, result_json, error):
    db.execute('UPDATE ai_jobs SET status=?,result=?,error=?,updated_at=? WHERE id=?',(status,result_json,error,now(),job_id))


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
