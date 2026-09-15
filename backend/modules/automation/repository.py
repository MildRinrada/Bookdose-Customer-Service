"""Automation queries: rules, macros, follow-ups, escalations, CSAT surveys, mentions and member activity.
Functions taking team_id limit results to that team when it is given (agents)."""
from backend.database.db import one, rows
from backend.utils.dates import now

DONE = "('resolved','closed')"


def _team(column, team_id):
    return (f' AND {column}=?',[team_id]) if team_id is not None else ('',[])


# Rules (applied in the order they were created; a later rule may override an earlier one)
def rules(db):
    return rows(db,'SELECT * FROM automation_rules ORDER BY created_at,rowid')


def enabled_rules(db):
    return rows(db,'SELECT * FROM automation_rules WHERE enabled=1 ORDER BY created_at,rowid')


def find_rule(db, rule_id):
    return one(db,'SELECT * FROM automation_rules WHERE id=?',(rule_id,))


def insert_rule(db, rule_id, v, user_id):
    db.execute('''INSERT INTO automation_rules(id,name,enabled,channel,keywords,set_priority,set_team_id,set_assignee_id,created_by,created_at,updated_at)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?)''',(rule_id,v['name'],int(v['enabled']),v['channel'],v['keywords'],v['set_priority'],
                  v['set_team_id'],v['set_assignee_id'],user_id,now(),now()))


def update_rule(db, rule_id, v):
    db.execute('''UPDATE automation_rules SET name=?,enabled=?,channel=?,keywords=?,set_priority=?,set_team_id=?,set_assignee_id=?,updated_at=?
                  WHERE id=?''',(v['name'],int(v['enabled']),v['channel'],v['keywords'],v['set_priority'],v['set_team_id'],v['set_assignee_id'],now(),rule_id))


def delete_rule(db, rule_id):
    db.execute('DELETE FROM automation_rules WHERE id=?',(rule_id,))


# Macros
def macros(db):
    return rows(db,'SELECT id,name,reply,set_status,followup_hours,updated_at FROM macros ORDER BY name')


def find_macro(db, macro_id):
    return one(db,'SELECT * FROM macros WHERE id=?',(macro_id,))


def insert_macro(db, macro_id, v, user_id):
    db.execute('INSERT INTO macros VALUES(?,?,?,?,?,?,?,?)',(macro_id,v['name'],v['reply'],v['set_status'],v['followup_hours'],user_id,now(),now()))


def update_macro(db, macro_id, v):
    db.execute('UPDATE macros SET name=?,reply=?,set_status=?,followup_hours=?,updated_at=? WHERE id=?',
               (v['name'],v['reply'],v['set_status'],v['followup_hours'],now(),macro_id))


def delete_macro(db, macro_id):
    db.execute('DELETE FROM macros WHERE id=?',(macro_id,))


# Follow-up reminders
def insert_followup(db, followup_id, ticket_id, due_at, note, user_id, user_name):
    db.execute('INSERT INTO followups VALUES(?,?,?,?,?,?,?,NULL)',(followup_id,ticket_id,due_at,note,user_id,user_name,now()))


def find_followup(db, followup_id):
    return one(db,'SELECT * FROM followups WHERE id=?',(followup_id,))


def followups_for_ticket(db, ticket_id):
    return rows(db,'SELECT * FROM followups WHERE ticket_id=? ORDER BY done_at IS NOT NULL,due_at DESC LIMIT 20',(ticket_id,))


def finish_followup(db, followup_id):
    db.execute('UPDATE followups SET done_at=? WHERE id=? AND done_at IS NULL',(now(),followup_id))


def open_followups_for(db, user_id, team_id=None):
    """Reminders the member set, or on cases they own, that are not done yet (soonest first)."""
    extra,params = _team('t.team_id',team_id)
    return rows(db,f'''SELECT f.*,t.number,t.subject,t.status FROM followups f JOIN tickets t ON t.id=f.ticket_id
                    WHERE f.done_at IS NULL AND (f.user_id=? OR t.assignee_id=?){extra} ORDER BY f.due_at LIMIT 50''',[user_id,user_id,*params])


def due_followup_count(db, before):
    return db.execute('SELECT COUNT(*) FROM followups f JOIN tickets t ON t.id=f.ticket_id WHERE f.done_at IS NULL AND f.due_at<=?',(before,)).fetchone()[0]


# SLA escalation
def unclaimed_before(db, created_before):
    """Open cases nobody has taken or answered since before the given time, not yet escalated."""
    return rows(db,f'''SELECT * FROM tickets WHERE status NOT IN {DONE} AND assignee_id IS NULL AND first_response_at IS NULL
                     AND created_at<=? AND id NOT IN (SELECT ticket_id FROM escalations) ORDER BY created_at''',(created_before,))


def unanswered_due_before(db, due_before):
    """Owned cases still waiting for their first reply whose deadline falls before the given time, not yet escalated."""
    return rows(db,f'''SELECT * FROM tickets WHERE status NOT IN {DONE} AND assignee_id IS NOT NULL AND first_response_at IS NULL
                     AND first_response_due_at<=? AND id NOT IN (SELECT ticket_id FROM escalations) ORDER BY first_response_due_at''',(due_before,))


def insert_escalation(db, ticket_id, reason, from_user_id, to_user_id):
    db.execute('INSERT OR IGNORE INTO escalations VALUES(?,?,?,?,?)',(ticket_id,reason,from_user_id,to_user_id,now()))


def escalation_for(db, ticket_id):
    return one(db,'SELECT * FROM escalations WHERE ticket_id=?',(ticket_id,))


def recent_escalations(db, limit=20, team_id=None):
    extra,params = _team('t.team_id',team_id)
    return rows(db,f'''SELECT e.*,t.number,t.subject,t.status,t.priority,t.assignee_id FROM escalations e JOIN tickets t ON t.id=e.ticket_id
                    WHERE 1=1{extra} ORDER BY e.escalated_at DESC LIMIT ?''',[*params,limit])


def escalations_to(db, user_id):
    return rows(db,f'''SELECT e.*,t.number,t.subject,t.status,t.priority FROM escalations e JOIN tickets t ON t.id=e.ticket_id
                    WHERE e.to_user_id=? AND t.status NOT IN {DONE} ORDER BY e.escalated_at DESC LIMIT 20''',(user_id,))


def escalation_count_since(db, since):
    return db.execute('SELECT COUNT(*) FROM escalations e JOIN tickets t ON t.id=e.ticket_id WHERE e.escalated_at>=?',(since,)).fetchone()[0]


def open_count_by_assignee(db):
    return dict(db.execute(f'SELECT assignee_id,COUNT(*) FROM tickets WHERE assignee_id IS NOT NULL AND status NOT IN {DONE} GROUP BY assignee_id').fetchall())


# CSAT surveys
def insert_survey(db, survey_id, ticket_id, conversation_id, message_id):
    db.execute('INSERT INTO csat_surveys(id,ticket_id,conversation_id,message_id,sent_at) VALUES(?,?,?,?,?)',(survey_id,ticket_id,conversation_id,message_id,now()))


def pending_survey(db, conversation_id, sent_after):
    return one(db,'SELECT * FROM csat_surveys WHERE conversation_id=? AND answered_at IS NULL AND sent_at>=? ORDER BY sent_at DESC LIMIT 1',(conversation_id,sent_after))


def pending_survey_for_ticket(db, ticket_id):
    return one(db,'SELECT * FROM csat_surveys WHERE ticket_id=? AND answered_at IS NULL',(ticket_id,))


def latest_survey(db, column, value):
    assert column in ('ticket_id','conversation_id')
    return one(db,f'SELECT * FROM csat_surveys WHERE {column}=? ORDER BY sent_at DESC,rowid DESC LIMIT 1',(value,))


def answer_survey(db, survey_id, rating, comment=''):
    db.execute('UPDATE csat_surveys SET rating=?,comment=?,answered_at=? WHERE id=? AND answered_at IS NULL',(rating,comment,now(),survey_id))


def rating_counts(db, since):
    return dict(db.execute('SELECT rating,COUNT(*) FROM csat_surveys WHERE answered_at>=? GROUP BY rating',(since,)).fetchall())


def surveys_sent_since(db, since):
    return db.execute('SELECT COUNT(*) FROM csat_surveys WHERE sent_at>=?',(since,)).fetchone()[0]


def csat_by_assignee(db, since):
    return {r['user_id']:r for r in rows(db,'''SELECT t.assignee_id AS user_id,AVG(s.rating) AS average,COUNT(*) AS count FROM csat_surveys s
            JOIN tickets t ON t.id=s.ticket_id WHERE s.answered_at>=? AND t.assignee_id IS NOT NULL GROUP BY t.assignee_id''',(since,))}


def recent_ratings(db, limit=5):
    return rows(db,'''SELECT s.rating,s.answered_at,t.id AS ticket_id,t.number,t.subject FROM csat_surveys s JOIN tickets t ON t.id=s.ticket_id
                    WHERE s.answered_at IS NOT NULL ORDER BY s.answered_at DESC LIMIT ?''',(limit,))


# Mentions in internal notes
def insert_mention(db, mention_id, message_id, conversation_id, user_id, author_name):
    db.execute('INSERT INTO mentions VALUES(?,?,?,?,?,?,NULL)',(mention_id,message_id,conversation_id,user_id,author_name,now()))


def unread_mentions(db, user_id, team_id=None):
    extra,params = _team('c.team_id',team_id)
    return rows(db,f'''SELECT n.id,n.conversation_id,n.author_name,n.created_at,c.subject,m.body,tc.ticket_id,t.number AS ticket_number
                    FROM mentions n JOIN conversations c ON c.id=n.conversation_id JOIN messages m ON m.id=n.message_id
                    LEFT JOIN ticket_conversations tc ON tc.conversation_id=n.conversation_id LEFT JOIN tickets t ON t.id=tc.ticket_id
                    WHERE n.user_id=? AND n.read_at IS NULL{extra} ORDER BY n.created_at DESC LIMIT 50''',[user_id,*params])


def mark_mentions_read(db, user_id, conversation_id=None):
    if conversation_id:
        db.execute('UPDATE mentions SET read_at=? WHERE user_id=? AND read_at IS NULL AND conversation_id=?',(now(),user_id,conversation_id))
    else:
        db.execute('UPDATE mentions SET read_at=? WHERE user_id=? AND read_at IS NULL',(now(),user_id))


def mentioned_users(db, message_id):
    return [row[0] for row in db.execute('SELECT user_id FROM mentions WHERE message_id=?',(message_id,))]


# Member activity and performance (live agent monitor)
def touch(db, user_id, seen_at):
    db.execute('INSERT INTO agent_activity VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET last_seen=excluded.last_seen',(user_id,seen_at))


def last_seen(db):
    return dict(db.execute('SELECT user_id,last_seen FROM agent_activity').fetchall())


def resolved_since_by_assignee(db, since):
    return dict(db.execute('SELECT assignee_id,COUNT(*) FROM tickets WHERE assignee_id IS NOT NULL AND resolved_at>=? GROUP BY assignee_id',(since,)).fetchall())


def first_response_minutes_by_assignee(db, since):
    return {r['assignee_id']:r['minutes'] for r in rows(db,'''SELECT assignee_id,AVG((julianday(first_response_at)-julianday(created_at))*1440) AS minutes
            FROM tickets WHERE assignee_id IS NOT NULL AND first_response_at IS NOT NULL AND created_at>=? GROUP BY assignee_id''',(since,))}


def replies_since_by_author(db, since):
    """Replies each member wrote (AI and system messages have no author)."""
    return dict(db.execute("SELECT author_id,COUNT(*) FROM messages WHERE kind='reply' AND author_id IS NOT NULL AND created_at>=? GROUP BY author_id",(since,)).fetchall())


def conversation_times(db, since):
    """When each conversation started (every channel, including cases recorded by staff)."""
    return [row[0] for row in db.execute('SELECT created_at FROM conversations WHERE created_at>=?',(since,))]


def enabled_rule_count(db):
    return db.execute('SELECT COUNT(*) FROM automation_rules WHERE enabled=1').fetchone()[0]
