"""The Superadmin security dashboard (/api/platform/security/...): overview, events, locked accounts, alerts, blocked
addresses, ending an account's sessions and the security settings. Every change is written to the platform audit
log and recorded as a security event."""
import datetime as dt
import json

from backend.database import audit
from backend.modules.security import blocks, events, lockout, model, repository, schema, sessions
from backend.modules.security.events import parse
from backend.utils.dates import after, iso, now, utc_now
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
    cards = {'failed_logins':0,'locked_now':0,'rate_limited':0,'origin_csrf_rejected':0,'cross_tenant_denied':0,'open_alerts':0}
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
            'top_ips':[{**e,'blocked':e['ip'] in blocked} for e in top_ips],
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
    return {'events':[event_view(r) for r in page],'next_before':page[-1]['id'] if len(found)>limit else None}


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
    return {'alerts':[alert_view(r) for r in repository.alerts(cd,schema.alerts_open(query))]}


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
    return {'blocks':[block_view(r) for r in repository.live_blocks(cd)]}


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
    changed = {group:{name:value for name,value in values[group].items() if current[group].get(name)!=value} for group in values}
    events.from_request(req,'security_settings_changed',actor='platform',subject=_admin(req),
                        detail={group:items for group,items in changed.items() if items})
    return values
