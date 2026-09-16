"""Sending the customer's LINE notices: a chat reply for an account that wants it on the organization's LINE
(customers.service.send_notices) and the confirmation of linking (customers/line.py). The notification preferences
(customer_accounts.notify_prefs, one entry per event of model.NOTIFY_EVENTS) decide email and LINE per event.

LINE goes to an account linked with this organization's LINE (customers/line.py) while its LINE channel is on.
Nothing is sent inside a transaction: a notice is queued in customer_alert_outbox (inside the caller's transaction) and
sent afterwards by the automation worker. A failed delivery is retried up to 3 times (a LINE push carries a retry
key, so LINE drops a repeat). A LINE message is short: the subject and a link, never the messages themselves."""
import json
import uuid

from backend.database import db as D
from backend.exceptions.errors import ChannelError
from backend.extensions import channel_transport as T
from backend.modules.customers import repository as customer_accounts
from backend.modules.customers.model import NOTIFY_EVENTS
from backend.modules.platform import service as platform
from backend.utils.dates import after
from backend.utils.security import uid

EMAILED = {key for key,_,on in NOTIFY_EVENTS if on}
MAX_ATTEMPTS = 3
CLAIM_SECONDS = 300          # a notice taken for sending by a worker that stopped is tried again after this


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
    jobs = []
    with D.control() as cd, D.tenant(tenant_id) as db:
        D.begin(db)
        line_ok = bool(line_channel(db,tenant_id))
        for row in customer_accounts.due_alerts(db):
            account = customer_accounts.find(cd,row['account_id'])
            link = customer_accounts.line_link(db,row['account_id'])
            if row['attempts']>=MAX_ATTEMPTS:
                customer_accounts.finish_alert(db,row['id'],row['error'] or 'failed')
            elif not account or row['channel']!='line' or not line_ok or not link:
                customer_accounts.finish_alert(db,row['id'],'off')
            else:
                customer_accounts.claim_alert(db,row['id'],after(seconds=CLAIM_SECONDS))
                jobs.append({**row,'recipient':link['line_user_id']})
        line_secret = channels.read_secret(tenant_id,'line') if jobs else {}
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
    with D.tenant(tenant_id) as db:
        D.begin(db)
        for job,error in results:
            if error and (error.retryable or error.uncertain) and job['attempts']+1<MAX_ATTEMPTS:
                customer_accounts.retry_alert(db,job['id'],error.code,after(seconds=30*3**job['attempts']))
            else:
                customer_accounts.finish_alert(db,job['id'],'' if not error else 'unknown' if error.uncertain else error.code)
    return sum(1 for _,error in results if not error)
