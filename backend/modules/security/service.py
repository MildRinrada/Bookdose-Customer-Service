"""The Superadmin security dashboard (/api/platform/security/...): overview, events, locked accounts, alerts, blocked
addresses, ending an account's sessions, the security settings and the honeytokens (docs/security/monitoring-and-traps.md). Every change is written to the platform audit
log and recorded as a security event. Lists that show addresses carry ip_info: the country and network of each one the
IP database knows (ip_intel.py; empty while it is off)."""
import datetime as dt
import json
import secrets
from urllib.parse import urlsplit

from backend.database import audit
from backend.modules.security import blocks, events, ip_intel, lockout, model, repository, schema, sessions, traps
from backend.modules.security.events import parse
from backend.utils.dates import after, iso, now, utc_now
from backend.utils.security import uid
from backend.utils.validation import require

RANGES = {'24h':(24*3600,3600),'7d':(7*86400,6*3600)}


def _admin(req):
    return req.session['email']


# Overview
def overview(cd, query):
    span,step = RANGES[schema.time_range(query)]
    moment = utc_now()
    first = int(moment.timestamp()//step)*step-span+step
    start = dt.datetime.fromtimestamp(first,dt.timezone.utc)
    rows = repository.events_since(cd,iso(start))
    buckets = [{'at':iso(start+dt.timedelta(seconds=i*step)),'failed_logins':0,'rate_limited':0,'rejected':0} for i in range(span//step)]
    cards = {'failed_logins':0,'locked_now':0,'rate_limited':0,'origin_csrf_rejected':0,'cross_tenant_denied':0,'open_alerts':0,
             'honeypot_hits':0,'honeytoken_triggers':0}
    ips,subjects = {},{}
    for row in rows:
        at,count,kind = parse(row['at']),row['count'],row['kind']
        index = int((at.timestamp()-first)//step) if at else -1
        bucket = buckets[index] if 0<=index<len(buckets) else None
        if kind in model.FAILED_LOGIN_KINDS:
            cards['failed_logins'] += count
            if bucket:
                bucket['failed_logins'] += count
            key = (row['subject'],row['actor'])
            if row['subject']:
                subjects[key] = subjects.get(key,0)+count
        elif kind=='rate_limited':
            cards['rate_limited'] += count
            if bucket:
                bucket['rate_limited'] += count
        if kind in model.REJECTED_KINDS and bucket:
            bucket['rejected'] += count
        if kind in ('csrf_rejected','origin_rejected'):
            cards['origin_csrf_rejected'] += count
        elif kind=='cross_tenant_denied':
            cards['cross_tenant_denied'] += count
        elif kind in ('honeypot_path','honeypot_form'):
            cards['honeypot_hits'] += count
        elif kind=='honeytoken_triggered' and row['severity']=='critical':
            # The test button's events are 'info' and not counted.
            cards['honeytoken_triggers'] += count
        if row['ip']:
            entry = ips.setdefault(row['ip'],{'ip':row['ip'],'events':0,'failed_logins':0})
            entry['events'] += count
            if kind in model.FAILED_LOGIN_KINDS:
                entry['failed_logins'] += count
    cards['locked_now'] = len(repository.locked(cd,now()))
    cards['open_alerts'] = repository.count_open_alerts(cd)
    blocked = {b['ip'] for b in repository.live_blocks(cd)}
    top_ips = sorted(ips.values(),key=lambda e:(-e['events'],e['ip']))[:10]
    return {'cards':cards,'series':buckets,
            'top_ips':[{**e,'blocked':e['ip'] in blocked} for e in top_ips],'ip_info':ip_intel.describe(e['ip'] for e in top_ips),
            'top_subjects':[{'subject':s,'actor':a,'failures':n} for (s,a),n in sorted(subjects.items(),key=lambda i:(-i[1],i[0]))[:10]]}


# Events
def event_view(row):
    try:
        detail = json.loads(row['detail'] or '{}')
    except ValueError:
        detail = {}
    return {'id':row['id'],'at':row['at'],'kind':row['kind'],'severity':row['severity'],'actor':row['actor'],
            'subject':row['subject'],'tenant_id':row['tenant_id'],'tenant_name':row['tenant_name'],'ip':row['ip'],
            'user_agent':row['user_agent'],'count':row['count'],'detail':detail}


def list_events(cd, query):
    filters,limit = schema.event_filters(query)
    found = repository.search_events(cd,filters,limit+1)
    page = found[:limit]
    return {'events':[event_view(r) for r in page],'next_before':page[-1]['id'] if len(found)>limit else None,
            'ip_info':ip_intel.describe(r['ip'] for r in page)}


# Locked accounts
def list_locks(cd):
    moment = utc_now()
    result = []
    for row in repository.locked(cd,iso(moment)):
        actor,subject = lockout.split_key(row['key'])
        result.append({'key':row['key'],'actor':actor,'subject':subject,'failures':row['failures'],
                       'level':lockout.effective_level(row,moment),'locked_until':row['locked_until'],'last_ip':row['last_ip']})
    return {'locks':result}


def unlock(req):
    key = schema.lock_key(req.body)
    cd = req.cd
    row = repository.failure(cd,key)
    require(row and lockout.remaining_seconds(row),'ไม่พบบัญชีที่ถูกล็อก',404)
    # The email's other sign-in locks go too: each one refuses the others (lockout.related_keys).
    for each in (key,*lockout.related_keys(key)):
        repository.clear_failures(cd,each)
    audit.record(cd,req.session['user_id'],'security.unlock','platform',key)
    cd.commit()
    actor,subject = lockout.split_key(key)
    events.from_request(req,'admin_unlock',actor='platform',subject=_admin(req),detail={'account':subject,'account_actor':actor})
    return {'ok':True}


# Alerts
def alert_view(row):
    try:
        detail = json.loads(row['detail'] or '{}')
    except ValueError:
        detail = {}
    return {'id':row['id'],'rule':row['rule'],'label':model.ALERT_LABELS.get(row['rule'],row['rule']),'severity':row['severity'],
            'started_at':row['started_at'],'last_seen_at':row['last_seen_at'],'count':row['count'],'ip':row['ip'],
            'detail':detail,'acknowledged_by':row['acknowledged_by'],'acknowledged_at':row['acknowledged_at']}


def list_alerts(cd, query):
    found = repository.alerts(cd,schema.alerts_open(query))
    return {'alerts':[alert_view(r) for r in found],'ip_info':ip_intel.describe(r['ip'] for r in found)}


def acknowledge(req, alert_id):
    cd = req.cd
    require(repository.find_alert(cd,int(alert_id)),'ไม่พบการแจ้งเตือน',404)
    repository.acknowledge_alert(cd,int(alert_id),_admin(req))
    audit.record(cd,req.session['user_id'],'security.alert_acknowledged','platform',str(alert_id))
    cd.commit()
    return {'ok':True}


# Blocked addresses
def block_view(row):
    return {'ip':row['ip'],'reason':row['reason'],'created_by':row['created_by'],'created_at':row['created_at'],'expires_at':row['expires_at']}


def list_blocks(cd):
    found = repository.live_blocks(cd)
    return {'blocks':[block_view(r) for r in found],'ip_info':ip_intel.describe(r['ip'] for r in found)}


def add_block(req):
    ip,reason,seconds = schema.block_form(req.body)
    require(ip!=blocks.normalize(req.ip),'ไม่สามารถบล็อก IP ที่คุณใช้อยู่ตอนนี้ได้',400)
    cd = req.cd
    expires = after(seconds=seconds) if seconds else None
    repository.save_block(cd,ip,reason,_admin(req),expires)
    audit.record(cd,req.session['user_id'],'security.ip_blocked','platform',f'{ip} {reason}'.strip())
    cd.commit()
    blocks.invalidate()
    events.from_request(req,'admin_ip_block',actor='platform',subject=_admin(req),
                        detail={'action':'block','blocked_ip':ip,'expires_at':expires,'reason':reason})
    return list_blocks(cd)


def remove_block(req):
    ip = schema.block_ip(req.body,req.query)
    cd = req.cd
    require(repository.delete_block(cd,ip),'ไม่พบ IP นี้ในรายการบล็อก',404)
    audit.record(cd,req.session['user_id'],'security.ip_unblocked','platform',ip)
    cd.commit()
    blocks.invalidate()
    events.from_request(req,'admin_ip_block',actor='platform',subject=_admin(req),detail={'action':'unblock','blocked_ip':ip})
    return list_blocks(cd)


# Sessions of one account
def revoke_sessions(req):
    from backend.modules.auth import repository as users
    from backend.modules.customers import repository as accounts
    actor,email = schema.revoke_form(req.body)
    cd = req.cd
    if actor=='staff':
        user = users.find_user_by_email(cd,email)
        require(user,'ไม่พบบัญชีนี้',404)
        revoked = repository.delete_staff_sessions(cd,user['id'])
    else:
        account = accounts.find_by_email(cd,email)
        require(account,'ไม่พบบัญชีนี้',404)
        revoked = repository.delete_customer_sessions(cd,account['id'])
    audit.record(cd,req.session['user_id'],'security.sessions_revoked','platform',f'{actor}:{email} ({revoked})')
    cd.commit()
    events.from_request(req,'sessions_revoked',actor='platform',subject=email,detail={'account_actor':actor,'revoked':revoked,'by':_admin(req)})
    return {'revoked':revoked}


# Settings
def get_settings(cd):
    return sessions.settings(cd)


def save_settings(req):
    cd = req.cd
    current = sessions.settings(cd)
    values = schema.settings_form(req.body,current)
    sessions.save(cd,values)
    audit.record(cd,req.session['user_id'],'security.settings_updated','platform')
    cd.commit()
    traps.invalidate()
    changed = {group:{name:value for name,value in values[group].items() if current[group].get(name)!=value} for group in values}
    events.from_request(req,'security_settings_changed',actor='platform',subject=_admin(req),
                        detail={group:items for group,items in changed.items() if items})
    return values


# Honeytokens
PASSWORD_WORDS = ('Backup','Admin','Server','Office','Vault','Finance','Deploy','Archive','Support','Records','Report','System')
DECOY_NAMES = ('it-backup','backup-admin','sysadmin.backup','finance.admin','svc-reports','ops-recovery','db-admin','it-support.old')
ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'


def honeytoken_view(row):
    """What the dashboard shows: never the secret, only a short preview of it."""
    prefix = row['lookup_prefix']
    if row['kind']=='api_key':
        preview = prefix+'…'
    elif row['kind']=='link':
        preview = model.FILE_LINK_PREFIX+prefix[:6]+'…'
    else:
        preview = prefix[:6]+'…'
    return {'id':row['id'],'kind':row['kind'],'label':row['label'],'placed_at_note':row['placed_at_note'],
            'decoy_email':row['decoy_email'],'preview':preview,'enabled':bool(row['enabled']),'created_at':row['created_at'],
            'created_by':row['created_by'],'trigger_count':row['trigger_count'],'last_triggered_at':row['last_triggered_at'],
            'last_ip':row['last_ip']}


def list_honeytokens(cd):
    return {'tokens':[honeytoken_view(r) for r in repository.honeytokens(cd)]}


def _platform_domain(cd, base):
    """The platform's own email domain for a decoy account: its public address, else its mailbox, else example.com."""
    from backend.modules.platform import service as platform
    host = (urlsplit(base).hostname or '').lower()
    if '.' in host and not blocks.normalize(host):
        return host
    address = (platform.registration_config(cd).get('address') or '').lower()
    domain = address.rpartition('@')[2]
    return domain if '.' in domain else 'example.com'


def _new_secret(cd, kind, base):
    """(secret shown once, the value that is hashed and matched, decoy email or None)"""
    if kind=='api_key':
        key = model.API_KEY_MARKER+''.join(secrets.choice(ALPHANUMERIC) for _ in range(40))
        return key,key,None
    if kind=='password':
        password = (secrets.choice(PASSWORD_WORDS)+secrets.choice(PASSWORD_WORDS)+'@'+str(1000+secrets.randbelow(9000))
                    +secrets.choice('!#$%&*')+''.join(secrets.choice(ALPHANUMERIC) for _ in range(3)))
        return password,password,None
    if kind=='link':
        token = secrets.token_urlsafe(24)
        return base+model.FILE_LINK_PREFIX+token,token,None
    domain = _platform_domain(cd,base)
    for attempt in range(50):
        name = secrets.choice(DECOY_NAMES)+('' if attempt<5 else str(secrets.randbelow(90)+10))
        email = f'{name}@{domain}'
        if not repository.decoy_email_taken(cd,email):
            return email,email,email
    require(False,'สร้างอีเมลล่อไม่สำเร็จ กรุณาลองใหม่',409)


def _changed(req, action, row):
    events.from_request(req,'security_settings_changed',actor='platform',subject=_admin(req),
                        detail={'honeytoken':{'action':action,'id':row['id'],'kind':row['kind'],'label':row['label']}})


def create_honeytoken(req):
    from backend.modules.org_links.service import base_url
    kind,label,note = schema.honeytoken_form(req.body)
    cd = req.cd
    require(repository.count_honeytokens(cd)<model.MAX_HONEYTOKENS,f'สร้างกับดักได้ไม่เกิน {model.MAX_HONEYTOKENS} รายการ',409)
    base = base_url(cd,req) if kind in ('link','decoy_account') else ''
    shown,matched,email = _new_secret(cd,kind,base)
    row = {'id':uid(),'kind':kind,'label':label,'placed_at_note':note,'secret_hash':traps.digest(matched),
           'lookup_prefix':matched[:model.LOOKUP_PREFIX_LENGTH],'decoy_email':email,'created_by':_admin(req),'created_at':now()}
    repository.insert_honeytoken(cd,row)
    audit.record(cd,req.session['user_id'],'security.honeytoken_created','platform',f"{row['id']} {kind} {label}")
    cd.commit()
    traps.invalidate()
    _changed(req,'create',row)
    return {'token':honeytoken_view(repository.honeytoken(cd,row['id'])),'secret':shown}


def _find_token(cd, token_id):
    row = repository.honeytoken(cd,token_id)
    require(row,'ไม่พบกับดักนี้',404)
    return row


def update_honeytoken(req, token_id):
    cd = req.cd
    _find_token(cd,token_id)
    changes = schema.honeytoken_changes(req.body)
    repository.update_honeytoken(cd,token_id,changes)
    audit.record(cd,req.session['user_id'],'security.honeytoken_updated','platform',f"{token_id} {json.dumps(changes,ensure_ascii=False)}")
    cd.commit()
    traps.invalidate()
    row = repository.honeytoken(cd,token_id)
    _changed(req,'update',row)
    return {'token':honeytoken_view(row)}


def delete_honeytoken(req, token_id):
    cd = req.cd
    row = _find_token(cd,token_id)
    repository.delete_honeytoken(cd,token_id)
    audit.record(cd,req.session['user_id'],'security.honeytoken_deleted','platform',f"{token_id} {row['label']}")
    cd.commit()
    traps.invalidate()
    _changed(req,'delete',row)
    return {'ok':True}


def test_honeytoken(req, token_id):
    """A clearly marked test event (info): no count, alert, block or email."""
    row = _find_token(req.cd,token_id)
    events.from_request(req,'honeytoken_triggered',actor='platform',subject=_admin(req),severity='info',
                        detail={'token_id':row['id'],'kind':row['kind'],'label':row['label'],'where':'test','test':True})
    return {'ok':True}
