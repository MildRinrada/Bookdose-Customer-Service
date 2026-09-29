"""Sending the customer's LINE notices: a chat reply for an account that wants it on the organization's LINE
(customers.service.send_notices) and the confirmation of linking (customers/line.py). The notification preferences
(customer_accounts.notify_prefs, one entry per event of model.NOTIFY_EVENTS) decide email and LINE per event.

LINE goes to an account linked with this organization's LINE (customers/line.py) while its LINE channel is on.
Nothing is sent inside a transaction: a notice is queued in customer_alert_outbox (inside the caller's transaction) and
sent afterwards by the automation worker. A failed delivery is retried up to 3 times (a LINE push carries a retry
key, so LINE drops a repeat). A LINE message is short: the subject and a link, never the messages themselves.

ช่วงเวลาห้ามรบกวน: the customer may set hours (Thai time, e.g. 21:00 to 08:00) when nothing reaches them by email or
LINE. What falls due meanwhile waits and goes out when the hours end - a chat reply they read on the page by then is not
sent at all, as at any other time. Stored in notify_prefs as 'quiet': {enabled, start, end}."""
import datetime as dt
import json
import uuid

from backend.database import db as D
from backend.exceptions.errors import ChannelError
from backend.extensions import channel_transport as T
from backend.modules.customers import repository as customer_accounts
from backend.modules.customers.model import NOTIFY_EVENTS
from backend.modules.platform import service as platform
from backend.utils.dates import after, iso, utc_now
from backend.utils.security import uid

EMAILED = {key for key,_,on in NOTIFY_EVENTS if on}
MAX_ATTEMPTS = 3
CLAIM_SECONDS = 300          # a notice taken for sending by a worker that stopped is tried again after this
THAI = dt.timezone(dt.timedelta(hours=7))
QUIET_DEFAULT = {'enabled':False,'start':'21:00','end':'08:00'}
# On the page itself, while the customer has it open: a pop-up at the bottom right when the team answers, and a
# short sound with it (frontend features/customer/useReplyPopups).
PAGE_DEFAULT = {'popup':True,'sound':True}


# Preferences
def prefs_of(account):
    try:
        saved = json.loads(account.get('notify_prefs') or '{}')
    except ValueError:
        return {}
    return saved if isinstance(saved,dict) else {}


def wants(account, event, channel):
    """The account wants this event on this channel: what it chose, else the default (email for the events in
    EMAILED, LINE for everything). A chat reply by email is the notify_email switch."""
    if event=='reply' and channel=='email':
        return bool(account['notify_email'])
    saved = prefs_of(account).get(event)
    value = saved.get(channel) if isinstance(saved,dict) else None
    if isinstance(value,bool):
        return value
    return channel=='line' or event in EMAILED


def quiet_of(account):
    """{enabled, start, end} of the account's ช่วงเวลาห้ามรบกวน (the default, off, until they set it)."""
    saved = prefs_of(account).get('quiet') if account else None
    return {**QUIET_DEFAULT,**saved} if isinstance(saved,dict) else dict(QUIET_DEFAULT)


def page_of(account):
    """{popup, sound} of the page's own alerts (the default, both on, until they choose)."""
    saved = prefs_of(account).get('page') if account else None
    return {**PAGE_DEFAULT,**saved} if isinstance(saved,dict) else dict(PAGE_DEFAULT)


def quiet_until(account, moment=None):
    """When the account's quiet hours end (UTC), while they are on now; else None. Hours past midnight (21:00 to
    08:00) run into the next morning."""
    quiet = quiet_of(account)
    if not quiet['enabled'] or quiet['start']==quiet['end']:
        return None
    local = (moment or utc_now()).astimezone(THAI)
    clock = local.strftime('%H:%M')
    inside = quiet['start']<=clock<quiet['end'] if quiet['start']<quiet['end'] else clock>=quiet['start'] or clock<quiet['end']
    if not inside:
        return None
    hour,minute = map(int,quiet['end'].split(':'))
    end = local.replace(hour=hour,minute=minute,second=0,microsecond=0)
    if end<=local:
        end += dt.timedelta(days=1)
    return end.astimezone(dt.timezone.utc)


def line_channel(db, tenant_id):
    """The organization's LINE channel setting when it is on and can push messages, else None."""
    from backend.modules.channels import service as channels
    row = channels.setting(db,'line')
    if not row or not row['enabled'] or not channels.credentials_ready('line',row['config'],channels.read_secret(tenant_id,'line')):
        return None
    return row


def line_wanted(db, tenant_id, account, event):
    """The account is linked with this organization's LINE, the channel is on, and it wants this event there."""
    return bool(account and wants(account,event,'line') and customer_accounts.line_link(db,account['id']) and line_channel(db,tenant_id))


def _link(cd, db, tenant_id, path):
    """A full link into the customer's app: the platform's public address, else the one set for LINE file links."""
    base = platform.registration_config(cd).get('public_base_url') or ''
    if not base:
        row = line_channel(db,tenant_id)
        base = (row['config'].get('public_base_url') or '') if row else ''
    return base.rstrip('/')+path if base else path


link = _link


# Queueing
def queue_line(cd, db, tenant_id, account_id, subject, path, dedup=None):
    """A LINE message to a linked account (its preferences were checked by the caller, or it is the confirmation of
    linking); with `dedup`, told once ever. Returns the ids queued."""
    alert_id = uid()
    added = customer_accounts.insert_alert(db,alert_id,account_id,'line',subject,'',_link(cd,db,tenant_id,path),dedup)
    return [alert_id] if added else []


# Sending
def _line_text(job):
    return f"{job['subject']}\n{job['link']}"[:4900]


def send(tenant_id):
    """Send the queued LINE notices that are due, outside any transaction; returns how many went out. A notice whose LINE went away meanwhile (unlinked, or the channel switched off) is closed unsent, and so is
    any row that is not a LINE notice."""
    from backend.modules.channels import service as channels
    jobs,mails = [],[]
    with D.control() as cd, D.tenant(tenant_id) as db:
        D.begin(db)
        line_ok = bool(line_channel(db,tenant_id))
        mail_ok = platform.registration_ready(cd)
        for row in customer_accounts.due_alerts(db):
            account = customer_accounts.find(cd,row['account_id'])
            link = customer_accounts.line_link(db,row['account_id'])
            quiet = quiet_until(account)
            if quiet and row['attempts']<MAX_ATTEMPTS:
                # ช่วงเวลาห้ามรบกวน: it waits for the morning, without counting as a try.
                customer_accounts.defer_alert(db,row['id'],iso(quiet))
            elif row['attempts']>=MAX_ATTEMPTS:
                customer_accounts.finish_alert(db,row['id'],row['error'] or 'failed')
            elif row['channel']=='email':
                # Only to an address the customer proved, while the platform can send at all.
                if not account or not account['email_verified'] or not mail_ok:
                    customer_accounts.finish_alert(db,row['id'],'off')
                else:
                    customer_accounts.claim_alert(db,row['id'],after(seconds=CLAIM_SECONDS))
                    mails.append({**row,'recipient':account['email'],'name':account['name']})
            elif not account or row['channel']!='line' or not line_ok or not link:
                customer_accounts.finish_alert(db,row['id'],'off')
            else:
                customer_accounts.claim_alert(db,row['id'],after(seconds=CLAIM_SECONDS))
                jobs.append({**row,'recipient':link['line_user_id']})
        line_secret = channels.read_secret(tenant_id,'line') if jobs else {}
        cfg,secret = (platform.registration_config(cd),platform.registration_secret()) if mails else ({},{})
    results = []
    for job in jobs:
        error = None
        try:
            T.send_line(line_secret,job['recipient'],_line_text(job),str(uuid.UUID(job['id'])))
        except ChannelError as failure:
            error = failure
        except Exception:
            error = ChannelError('unknown',uncertain=True)
        results.append((job,error))
    from backend.modules.customers import service as customers
    for job in mails:
        error = None
        try:
            customers.send_mail(cfg,secret,job['recipient'],job['subject'],
                                f"สวัสดีคุณ{job['name']}\n\n{job['text']}\n\n{job['link']}\n")
        except ChannelError as failure:
            error = failure
        except Exception:
            error = ChannelError('unknown',uncertain=True)
        results.append((job,error))
    with D.tenant(tenant_id) as db:
        D.begin(db)
        for job,error in results:
            if error and (error.retryable or error.uncertain) and job['attempts']+1<MAX_ATTEMPTS:
                customer_accounts.retry_alert(db,job['id'],error.code,after(seconds=30*3**job['attempts']))
            else:
                customer_accounts.finish_alert(db,job['id'],'' if not error else 'unknown' if error.uncertain else error.code)
    return sum(1 for _,error in results if not error)
