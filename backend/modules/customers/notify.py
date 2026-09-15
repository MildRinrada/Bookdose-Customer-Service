"""Telling the customer side: contract events for the owner of the contract and the members of the owner's team whose
role has the capability the event is about (see client_team/access.py), the reminders the automation worker makes
once a day, and sending all of them by email and LINE.

Event keys (customers.model.NOTIFY_EVENTS): contract_review (sent for signing), contract_done, delivery, invoice,
receipt, approval (your step is waiting), drive (a new file from the contractor), team (invitations, role changes),
warranty, invoice_due (reminder), reply (a chat reply: customers.service.notify_reply).

Each recipient chooses per event and channel (customer_accounts.notify_prefs). Email goes to a proven address while
the platform can send email; LINE goes to an account linked with this organization's LINE (customers/line.py) while
its LINE channel is on. Nothing is sent inside a transaction: a notice is queued in customer_alert_outbox (inside or
after the caller's transaction) and sent afterwards - right away for a contract event, by the automation worker for
reminders and retries. A failed delivery is retried up to 3 times (never an email whose delivery is uncertain: SMTP
has no idempotency key; a LINE push carries a retry key, so LINE drops a repeat). The page shows every event either
way. A LINE message is short (the subject and a link, never an amount the email does not give)."""
import datetime as dt
import json
import uuid

from backend.database import db as D
from backend.exceptions.errors import ChannelError
from backend.extensions import channel_transport as T
from backend.modules.customers import repository as customer_accounts
from backend.modules.customers.model import NOTIFY_EVENTS
from backend.modules.platform import repository as tenants, service as platform
from backend.utils.dates import after, today
from backend.utils.security import uid

EVENT_KEYS = tuple(key for key,_,_ in NOTIFY_EVENTS)
EMAILED = {key for key,_,on in NOTIFY_EVENTS if on}
MAX_ATTEMPTS = 3
CLAIM_SECONDS = 300          # a notice taken for sending by a worker that stopped is tried again after this
REMINDER_DAY = 'customer_reminders_day'
DUE_SOON_DAYS = 3
WARRANTY_DAYS = (7,30)


# Preferences
def prefs_of(account):
    try:
        saved = json.loads(account.get('notify_prefs') or '{}')
    except ValueError:
        return {}
    return saved if isinstance(saved,dict) else {}


def wants(account, event, channel):
    """The account wants this event on this channel: what it chose, else the default (email for the events in
    EMAILED and for contract events without a key, LINE for everything). A chat reply by email is the notify_email
    switch, as before."""
    if event=='reply' and channel=='email':
        return bool(account['notify_email'])
    saved = prefs_of(account).get(event)
    value = saved.get(channel) if isinstance(saved,dict) else None
    if isinstance(value,bool):
        return value
    return channel=='line' or event in EMAILED or event not in EVENT_KEYS


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
def queue(cd, db, tenant_id, account_ids, event, subject, text, path, dedup=None):
    """Queue a notice for each account on the channels it wants (inside the caller's transaction on db). `text` is the
    email's body (a greeting and the link are added); LINE gets the subject and the link. With `dedup`, each account
    and channel is told once ever (reminders). Returns the ids queued."""
    from backend.modules.customers import service as customers
    email_ok,line_ok = customers.email_ready(cd),bool(line_channel(db,tenant_id))
    link,ids = _link(cd,db,tenant_id,path),[]
    for account_id in dict.fromkeys(account_ids):
        account = customer_accounts.find(cd,account_id)
        if not account:
            continue
        for channel in ('email','line'):
            ready = email_ok and account['email_verified'] if channel=='email' else line_ok and customer_accounts.line_link(db,account_id)
            if not ready or not wants(account,event,channel):
                continue
            alert_id = uid()
            if customer_accounts.insert_alert(db,alert_id,account_id,channel,subject,text,link,f'{dedup}:{account_id}:{channel}' if dedup else None):
                ids.append(alert_id)
    return ids


def queue_line(cd, db, tenant_id, account_id, subject, path, dedup=None):
    """A LINE message to a linked account whatever its preferences (the confirmation of linking)."""
    alert_id = uid()
    added = customer_accounts.insert_alert(db,alert_id,account_id,'line',subject,'',_link(cd,db,tenant_id,path),dedup)
    return [alert_id] if added else []


def recipients(db, contract, need='documents', only=None):
    """Account ids to tell: the owner, then the active team members of the owner whose role has `need` and whose
    projects cover the contract; with `only`, just the ones listed there."""
    from backend.modules.client_team import access, repository as team
    found = [contract['account_id']]
    for member in team.active_of_owner(db,contract['account_id']):
        if (member['account_id'] and member['account_id'] not in found and need in access.CAPABILITIES[member['role']]
                and access.covers(member,contract)):
            found.append(member['account_id'])
    return [a for a in found if only is None or a in only]


def contract_event(cd, org, contract, event, subject, text, need='documents', path=None, accounts=None):
    """Tell the owner and the team members whose role has `need` about a contract event (`accounts`: only these
    account ids), each on the channels they want for `event`. The link: `path` in the customer's app, else the
    document's page. Call it after the caller's commit: the notices are queued and sent right away."""
    with D.tenant(org['id']) as db:
        D.begin(db)
        ids = queue(cd,db,org['id'],recipients(db,contract,need,accounts),event,subject,text,
                    path or f"/#documents/{org['slug']}/{contract['id']}")
    if ids:
        send(org['id'],ids)


# Sending
def _line_text(job):
    return f"{job['subject']}\n{job['link']}"[:4900]


def send(tenant_id, ids=None):
    """Send the queued notices that are due (with ids: only those) outside any transaction; returns how many went out.
    A notice whose channel went away meanwhile (email unproven, LINE unlinked or switched off) is closed unsent."""
    from backend.modules.channels import service as channels
    from backend.modules.customers import service as customers
    jobs = []
    with D.control() as cd, D.tenant(tenant_id) as db:
        D.begin(db)
        email_ok,line_ok = customers.email_ready(cd),bool(line_channel(db,tenant_id))
        for row in customer_accounts.due_alerts(db,ids):
            account = customer_accounts.find(cd,row['account_id'])
            link = customer_accounts.line_link(db,row['account_id']) if row['channel']=='line' else None
            if row['attempts']>=MAX_ATTEMPTS:
                customer_accounts.finish_alert(db,row['id'],row['error'] or 'failed')
            elif not account or (not (email_ok and account['email_verified']) if row['channel']=='email' else not (line_ok and link)):
                customer_accounts.finish_alert(db,row['id'],'off')
            else:
                customer_accounts.claim_alert(db,row['id'],after(seconds=CLAIM_SECONDS))
                jobs.append({**row,'name':account['name'],'email':account['email'],'recipient':link['line_user_id'] if link else ''})
        cfg,secret = platform.registration_config(cd),platform.registration_secret()
        line_secret = channels.read_secret(tenant_id,'line') if any(j['channel']=='line' for j in jobs) else {}
    results = []
    for job in jobs:
        error = None
        try:
            if job['channel']=='email':
                customers._send(cfg,secret,job['email'],job['subject'],f"สวัสดีคุณ{job['name']}\n\n{job['text']}\n{job['link']}\n")
            else:
                T.send_line(line_secret,job['recipient'],_line_text(job),str(uuid.UUID(job['id'])))
        except ChannelError as failure:
            error = failure
        except Exception:
            error = ChannelError('unknown',uncertain=True)
        results.append((job,error))
    with D.tenant(tenant_id) as db:
        D.begin(db)
        for job,error in results:
            again = error and (error.retryable or job['channel']=='line' and error.uncertain) and job['attempts']+1<MAX_ATTEMPTS
            if again:
                customer_accounts.retry_alert(db,job['id'],error.code,after(seconds=30*3**job['attempts']))
            else:
                customer_accounts.finish_alert(db,job['id'],'' if not error else 'unknown' if error.uncertain else error.code)
    return sum(1 for _,error in results if not error)


# Reminders
def _days_left(value):
    return (dt.date.fromisoformat(value[:10])-dt.date.fromisoformat(today())).days


def remind(tenant_id, force=False):
    """Queue today's reminders, once a day (force: whatever ran today). Each goes to each person once, whatever how
    often this runs (dedup keys): an unpaid invoice due within 3 days, due today, and overdue (to the owner and the
    members with billing); a project's warranty / MA cover ending within 30 and within 7 days (to those with decide,
    unless an MA renewal was already asked for). Returns the ids queued."""
    from backend.modules.contracts import project, schema as contract_schema
    ids = []
    with D.control() as cd:
        org = tenants.find_active(cd,tenant_id)
        if not org:
            return ids
        with D.tenant(tenant_id) as db:
            D.begin(db)
            if not force and customer_accounts.stored_setting(db,REMINDER_DAY)==today():
                return ids
            customer_accounts.store_setting(db,REMINDER_DAY,today())
            for i in customer_accounts.unpaid_invoices(db):
                left = _days_left(i['due_date'])
                kind = 'overdue' if left<0 else 'due0' if left==0 else 'due3' if left<=DUE_SOON_DAYS else None
                if not kind:
                    continue
                ref,what = project.invoice_ref(i['number']),f"งวดที่ {i['seq']} {i['milestone_title']}"
                subject = {'due3':f'ใกล้ถึงกำหนดชำระ {ref} ({i["due_date"]})','due0':f'ครบกำหนดชำระวันนี้ {ref}',
                           'overdue':f'เลยกำหนดชำระ {ref} แล้ว'}[kind]
                text = (f"{org['name']} แจ้งเตือน: ใบแจ้งหนี้ {ref} ({what}) ของ "
                        f"{contract_schema.reference({'kind':i['kind'],'number':i['contract_number']})} ครบกำหนดชำระ {i['due_date']}\n"
                        'ดูยอด ช่องทางชำระเงิน และแนบสลิปได้ที่:')
                people = recipients(db,{'id':i['contract_id'],'account_id':i['account_id'],'renews_id':i['renews_id']},'billing')
                ids += queue(cd,db,tenant_id,people,'invoice_due',subject,text,f"/customer/billing/{org['slug']}/{i['id']}",f"{kind}:{i['id']}")
            projects = customer_accounts.covered_projects(db)
            for c in projects:
                if c['renews_id'] or c['ma_requested_at']:
                    continue
                cover = project.coverage(c,[r for r in projects if r['renews_id']==c['id']])
                if cover['state']!='active':
                    continue
                kind = next((f'warranty{d}' for d in WARRANTY_DAYS if cover['days_left']<=d),None)
                if not kind:
                    continue
                ref = contract_schema.reference(c)
                text = (f"การรับประกัน/MA ของ {ref} {c['title']} กับ {org['name']} จะหมดใน {cover['days_left']} วัน ({cover['end']})\n"
                        'ขอต่อสัญญา MA ได้ที่:')
                ids += queue(cd,db,tenant_id,recipients(db,c,'decide'),'warranty',f"การรับประกัน {ref} จะหมดใน {cover['days_left']} วัน",text,
                             f"/customer/documents/{org['slug']}/{c['id']}?tab=warranty",f"{kind}:{c['id']}:{cover['end']}")
    return ids


def run(tenant_id):
    """The automation worker's round: today's reminders, then every notice that is due. Returns how many went out."""
    remind(tenant_id)
    return send(tenant_id)
