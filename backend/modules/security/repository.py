"""Queries of platform security (control database): lockout rows, security events, alerts and blocked addresses."""
from backend.database.db import one, rows
from backend.utils.dates import now


# Progressive lockout
def failure(cd, key):
    return one(cd,'SELECT * FROM login_failures WHERE key=?',(key,))


def save_failures(cd, key, failures, window_start, ip):
    cd.execute('''INSERT INTO login_failures(key,failures,window_start,level,last_ip,updated_at) VALUES(?,?,?,0,?,?)
                  ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,window_start=excluded.window_start,
                  last_ip=excluded.last_ip,updated_at=excluded.updated_at''',(key,failures,window_start,ip,now()))


def save_lock(cd, key, level, locked_at, locked_until, ip, notified_at):
    """A new lock: the count starts over, the level and its start are kept for the next one."""
    cd.execute('''INSERT INTO login_failures(key,failures,window_start,locked_until,level,last_ip,updated_at,locked_at,notified_at)
                  VALUES(?,0,NULL,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET failures=0,window_start=NULL,
                  locked_until=excluded.locked_until,level=excluded.level,last_ip=excluded.last_ip,updated_at=excluded.updated_at,
                  locked_at=excluded.locked_at,notified_at=excluded.notified_at''',
               (key,locked_until,level,ip,now(),locked_at,notified_at))


def clear_failures(cd, key):
    """A sign-in, a completed reset or a Superadmin: no count and no lock; the level stays (it decays by itself)."""
    return cd.execute('UPDATE login_failures SET failures=0,window_start=NULL,locked_until=NULL,updated_at=? WHERE key=?',
                      (now(),key)).rowcount


def locked(cd, moment):
    return rows(cd,'SELECT * FROM login_failures WHERE locked_until>? ORDER BY locked_until DESC',(moment,))


def all_failures(cd):
    return rows(cd,'SELECT * FROM login_failures')


def delete_failure(cd, key):
    cd.execute('DELETE FROM login_failures WHERE key=?',(key,))


# Events
def same_event(cd, kind, ip, subject, since):
    return one(cd,'SELECT id FROM security_events WHERE kind=? AND at>=? AND ip=? AND subject=? ORDER BY id DESC LIMIT 1',
               (kind,since,ip,subject))


def latest_of_kind(cd, kind, since):
    return one(cd,'SELECT id FROM security_events WHERE kind=? AND at>=? ORDER BY id DESC LIMIT 1',(kind,since))


def count_event(cd, event_id):
    cd.execute('UPDATE security_events SET count=count+1 WHERE id=?',(event_id,))


def insert_event(cd, at, kind, severity, actor, subject, tenant_id, ip, user_agent, detail):
    cd.execute('''INSERT INTO security_events(at,kind,severity,actor,subject,tenant_id,ip,user_agent,count,detail)
                  VALUES(?,?,?,?,?,?,?,?,1,?)''',(at,kind,severity,actor,subject,tenant_id,ip,user_agent,detail))


def events_since(cd, since, kinds=None):
    if kinds:
        marks = ','.join('?'*len(kinds))
        return rows(cd,f'SELECT at,kind,severity,ip,subject,actor,count FROM security_events WHERE at>=? AND kind IN ({marks})',(since,*kinds))
    return rows(cd,'SELECT at,kind,severity,ip,subject,actor,count FROM security_events WHERE at>=?',(since,))


def count_since(cd, kind, since, per_ip):
    """[(ip or '', total count)] of one kind since a time: per address, or one line for the platform."""
    if per_ip:
        return [(r[0],r[1]) for r in cd.execute("SELECT ip,SUM(count) FROM security_events WHERE kind=? AND at>=? AND ip!='' GROUP BY ip",(kind,since))]
    total = cd.execute('SELECT SUM(count) FROM security_events WHERE kind=? AND at>=?',(kind,since)).fetchone()[0]
    return [('',total or 0)]


def search_events(cd, filters, limit):
    where,params = [],[]
    for column in ('kind','severity','actor','ip'):
        if filters.get(column):
            where.append(f'e.{column}=?')
            params.append(filters[column])
    if filters.get('tenant'):
        where.append('e.tenant_id=?')
        params.append(filters['tenant'])
    if filters.get('before'):
        where.append('e.id<?')
        params.append(filters['before'])
    if filters.get('q'):
        where.append("(e.subject LIKE ? ESCAPE '\\' OR e.ip LIKE ? ESCAPE '\\' OR e.detail LIKE ? ESCAPE '\\' OR e.user_agent LIKE ? ESCAPE '\\')")
        pattern = '%'+filters['q'].replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
        params += [pattern]*4
    clause = ('WHERE '+' AND '.join(where)) if where else ''
    return rows(cd,f'''SELECT e.*,t.name AS tenant_name FROM security_events e LEFT JOIN tenants t ON t.id=e.tenant_id
                       {clause} ORDER BY e.id DESC LIMIT ?''',(*params,limit))


def purge_events(cd, before):
    cd.execute('DELETE FROM security_events WHERE at<?',(before,))


# Alerts
def open_alert(cd, rule, ip):
    return one(cd,'SELECT * FROM security_alerts WHERE rule=? AND ip=? AND acknowledged_at IS NULL ORDER BY id DESC LIMIT 1',(rule,ip))


def acknowledged_since(cd, rule, ip, since):
    return one(cd,'SELECT * FROM security_alerts WHERE rule=? AND ip=? AND acknowledged_at>=? ORDER BY id DESC LIMIT 1',(rule,ip,since))


def insert_alert(cd, rule, severity, count, ip, detail):
    return cd.execute('''INSERT INTO security_alerts(rule,severity,started_at,last_seen_at,count,ip,detail) VALUES(?,?,?,?,?,?,?)''',
                      (rule,severity,now(),now(),count,ip,detail)).lastrowid


def update_alert(cd, alert_id, count, detail):
    cd.execute('UPDATE security_alerts SET last_seen_at=?,count=MAX(count,?),detail=? WHERE id=?',(now(),count,detail,alert_id))


def alerts(cd, open_only, limit=200):
    clause = 'WHERE acknowledged_at IS NULL' if open_only else ''
    return rows(cd,f'SELECT * FROM security_alerts {clause} ORDER BY last_seen_at DESC,id DESC LIMIT ?',(limit,))


def find_alert(cd, alert_id):
    return one(cd,'SELECT * FROM security_alerts WHERE id=?',(alert_id,))


def acknowledge_alert(cd, alert_id, by):
    cd.execute('UPDATE security_alerts SET acknowledged_by=?,acknowledged_at=? WHERE id=? AND acknowledged_at IS NULL',(by,now(),alert_id))


def count_open_alerts(cd):
    return cd.execute('SELECT COUNT(*) FROM security_alerts WHERE acknowledged_at IS NULL').fetchone()[0]


def purge_alerts(cd, before):
    cd.execute('DELETE FROM security_alerts WHERE acknowledged_at IS NOT NULL AND last_seen_at<?',(before,))


# Blocked addresses
def live_blocks(cd):
    return rows(cd,'SELECT * FROM ip_blocks WHERE expires_at IS NULL OR expires_at>? ORDER BY created_at DESC',(now(),))


def save_block(cd, ip, reason, created_by, expires_at):
    cd.execute('''INSERT INTO ip_blocks VALUES(?,?,?,?,?) ON CONFLICT(ip) DO UPDATE SET reason=excluded.reason,
                  created_by=excluded.created_by,created_at=excluded.created_at,expires_at=excluded.expires_at''',
               (ip,reason,created_by,now(),expires_at))


def delete_block(cd, ip):
    return cd.execute('DELETE FROM ip_blocks WHERE ip=?',(ip,)).rowcount


def purge_blocks(cd):
    cd.execute('DELETE FROM ip_blocks WHERE expires_at IS NOT NULL AND expires_at<=?',(now(),))


# Sessions of one account (Superadmin: end them all)
def delete_staff_sessions(cd, user_id):
    return cd.execute('DELETE FROM sessions WHERE user_id=?',(user_id,)).rowcount


def delete_customer_sessions(cd, account_id):
    return cd.execute('DELETE FROM customer_sessions WHERE account_id=?',(account_id,)).rowcount


# Honeytokens
def honeytokens(cd):
    return rows(cd,'SELECT * FROM honeytokens ORDER BY created_at DESC,id')


def enabled_honeytokens(cd):
    return rows(cd,'SELECT id,kind,label,secret_hash,lookup_prefix,decoy_email FROM honeytokens WHERE enabled=1')


def honeytoken(cd, token_id):
    return one(cd,'SELECT * FROM honeytokens WHERE id=?',(token_id,))


def count_honeytokens(cd):
    return cd.execute('SELECT COUNT(*) FROM honeytokens').fetchone()[0]


def decoy_email_taken(cd, email):
    return bool(one(cd,'''SELECT 1 FROM honeytokens WHERE decoy_email=? UNION ALL SELECT 1 FROM users WHERE lower(email)=?
                          UNION ALL SELECT 1 FROM customer_accounts WHERE lower(email)=? LIMIT 1''',(email,email,email)))


def insert_honeytoken(cd, token):
    cd.execute('''INSERT INTO honeytokens(id,kind,label,placed_at_note,secret_hash,lookup_prefix,decoy_email,created_by,created_at,enabled)
                  VALUES(:id,:kind,:label,:placed_at_note,:secret_hash,:lookup_prefix,:decoy_email,:created_by,:created_at,1)''',token)


def update_honeytoken(cd, token_id, changes):
    names = ','.join(f'{name}=?' for name in changes)
    cd.execute(f'UPDATE honeytokens SET {names} WHERE id=?',(*[int(v) if isinstance(v,bool) else v for v in changes.values()],token_id))


def delete_honeytoken(cd, token_id):
    return cd.execute('DELETE FROM honeytokens WHERE id=?',(token_id,)).rowcount


def note_trigger(cd, token_id, ip):
    cd.execute('UPDATE honeytokens SET trigger_count=trigger_count+1,last_triggered_at=?,last_ip=? WHERE id=?',(now(),ip,token_id))


def open_honeytoken_alert(cd, token_id, ip):
    return one(cd,'''SELECT * FROM security_alerts WHERE rule='honeytoken' AND ip=? AND acknowledged_at IS NULL
                     AND json_extract(detail,'$.token_id')=? ORDER BY id DESC LIMIT 1''',(ip,token_id))


def bump_alert(cd, alert_id):
    cd.execute('UPDATE security_alerts SET last_seen_at=?,count=count+1 WHERE id=?',(now(),alert_id))


# Honeypots
def hits_since(cd, kind, ip, since):
    return cd.execute('SELECT COALESCE(SUM(count),0) FROM security_events WHERE ip=? AND at>=? AND kind=?',(ip,since,kind)).fetchone()[0]


def block(cd, ip):
    return one(cd,'SELECT * FROM ip_blocks WHERE ip=?',(ip,))
