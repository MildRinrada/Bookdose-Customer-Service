"""Security alerts and clean-up, run by the security worker every minute.

Rules (thresholds in the security settings): failed sign-ins from one address in 10 minutes (warning) or across the
platform (critical), accounts locked in an hour (critical), rate-limited requests from one address in 10 minutes
(warning), bad webhook signatures in 10 minutes (warning). One open alert per rule and address, updated while the
condition continues; once acknowledged, a condition still inside the same window updates that alert silently instead
of opening a new one. A new critical alert is emailed to the platform admins when the mailbox is ready (at most once
per rule per hour)."""
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
import json
import sys
import threading

from backend.database import db as D
from backend.extensions import monitor
from backend.modules.security import model, repository, sessions
from backend.modules.security.events import parse
from backend.utils.dates import after, now, utc_now

MAIL_KEY = 'security_alert_mail'


def run_rules():
    """Check every rule once; returns the ids of alerts opened now."""
    opened,mail = [],[]
    with D.control() as cd:
        thresholds = sessions.settings(cd)['alerts']
        D.begin(cd)
        for rule,(severity,setting,kind,per_ip,window) in model.ALERT_RULES.items():
            since = after(seconds=-window)
            for ip,count in repository.count_since(cd,kind,since,per_ip):
                if count<thresholds[setting]:
                    continue
                detail = json.dumps({'kind':kind,'window_minutes':window//60,'threshold':thresholds[setting]})
                current = repository.open_alert(cd,rule,ip) or repository.acknowledged_since(cd,rule,ip,since)
                if current:
                    repository.update_alert(cd,current['id'],count,detail)
                    continue
                alert_id = repository.insert_alert(cd,rule,severity,count,ip,detail)
                opened.append(alert_id)
                if severity=='critical':
                    mail.append({'rule':rule,'count':count,'ip':ip})
        cd.commit()
        recipients,task = _mail_task(cd,mail)
    if task:
        _send(recipients,task)
    return opened


def _mail_task(cd, found):
    """(platform admin emails, what to send) for new critical alerts whose rule was not emailed in the last hour."""
    from backend.modules.platform import repository as platform, service as platform_service
    if not found or not platform_service.registration_ready(cd):
        return [],None
    try:
        sent = json.loads(platform.setting(cd,MAIL_KEY) or '{}')
    except ValueError:
        sent = {}
    due = []
    for item in found:
        last = parse(sent.get(item['rule']))
        if not last or (utc_now()-last).total_seconds()>=model.ALERT_MAIL_SECONDS:
            sent[item['rule']] = now()
            due.append(item)
    if not due:
        return [],None
    platform.save_setting(cd,MAIL_KEY,json.dumps(sent))
    cd.commit()
    recipients = [a['email'] for a in platform.platform_admins(cd)]
    return recipients,{'items':due,'config':platform_service.registration_config(cd)}


def _send(recipients, task):
    from backend.extensions import channel_transport as T
    from backend.modules.platform import service as platform_service
    cfg,secret = task['config'],platform_service.registration_secret()
    lines = '\n'.join(f"- {model.ALERT_LABELS.get(i['rule'],i['rule'])}: {i['count']} ครั้ง" for i in task['items'])
    for recipient in recipients:
        try:
            mail = EmailMessage()
            mail['Subject'] = 'แจ้งเตือนความปลอดภัยระดับวิกฤต'
            mail['From'],mail['To'] = cfg['address'],recipient
            mail['Date'],mail['Message-ID'],mail['Auto-Submitted'] = formatdate(localtime=False,usegmt=True),make_msgid(),'auto-generated'
            mail.set_content(f"ระบบพบเหตุการณ์ด้านความปลอดภัยที่ต้องตรวจสอบ\n\n{lines}\n\n"
                             f"ดูรายละเอียดที่ คอนโซลระบบกลาง → ความปลอดภัย:\n{cfg.get('public_base_url','')}/platform/security\n")
            T.send_email(cfg,secret,recipient,mail)
        except Exception as error:
            print(f'[{now()}] Security alert mail: {type(error).__name__}',file=sys.stderr,flush=True)


def cleanup():
    """Events past 90 days, acknowledged alerts past 90 days, ended blocks, lockout rows with nothing left to remember,
    and sessions past their limits."""
    from backend.modules.security import lockout
    moment = utc_now()
    with D.control() as cd:
        D.begin(cd)
        repository.purge_events(cd,after(days=-model.EVENT_KEEP_DAYS))
        repository.purge_alerts(cd,after(days=-model.EVENT_KEEP_DAYS))
        repository.purge_blocks(cd)
        for row in repository.all_failures(cd):
            window = parse(row['window_start'])
            if (not lockout.remaining_seconds(row,moment) and not row['locked_until'] and lockout.effective_level(row,moment)==0
                    and (not window or (moment-window).total_seconds()>=model.LOCK_WINDOW_SECONDS)):
                repository.delete_failure(cd,row['key'])
        values = sessions.settings(cd)
        staff,platform,customer = (sessions.seconds_of(values,a) for a in ('staff','platform','customer'))
        for token,created,active,expires,is_platform in cd.execute(
                'SELECT s.token,s.created_at,s.last_active_at,s.expires_at,u.platform_admin FROM sessions s JOIN users u ON u.id=s.user_id').fetchall():
            if sessions.expired_reason(created,active,platform if is_platform else staff,expires,moment):
                cd.execute('DELETE FROM sessions WHERE token=?',(token,))
        for token,created,active,expires in cd.execute('SELECT token_hash,created_at,last_active_at,expires_at FROM customer_sessions').fetchall():
            if sessions.expired_reason(created,active,customer,expires,moment):
                cd.execute('DELETE FROM customer_sessions WHERE token_hash=?',(token,))
        cd.commit()


class Worker:
    """Background thread every minute (bookdose-security): alert rules and clean-up, the platform admins' email about
    the server itself (platform/watch.py), and the day's automatic backup when it is due (platform/backups.py, in its
    own thread so a long backup never holds up the alerts)."""
    INTERVAL = 60

    def __init__(self):
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.run,name='bookdose-security',daemon=True)

    def start(self):
        self.thread.start()

    def run(self):
        from backend.modules.platform import backups, watch
        while not self.stop.wait(self.INTERVAL):
            monitor.heartbeat('security')
            for name,step in (('security',run_rules),('security',cleanup),('watch',watch.run)):
                try:
                    step()
                except Exception as error:
                    print(f'Security worker ({name}): {type(error).__name__}; retrying next round',flush=True)
                    monitor.error('security',f'{name}: {type(error).__name__}')
            try:
                with D.control() as cd:
                    due = backups.due(cd)
                if due and not backups.busy():
                    threading.Thread(target=backups.auto_round,name='bookdose-backup',daemon=True).start()
            except Exception as error:
                print(f'Automatic backup: {type(error).__name__}; retrying next round',flush=True)
                monitor.error('security','backup: '+type(error).__name__)
