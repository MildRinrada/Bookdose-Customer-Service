"""องค์กรที่หลับ: organizations nobody uses any more - no member of their team has opened the app and no new case has
come in for DAYS days - which still take disk space and are accounts left lying around (a forgotten admin password
still opens everything in them). The platform console lists them with what they hold, so an admin can ask their
owners whether they still want them (contact()) or suspend them (the usual suspension, platform/service.py).

"Opened the app": a member's last use as the live agent monitor records it (agent_activity; a platform admin looking
in on a support access does not count). An organization younger than DAYS days is never dormant, nor is the
platform's own one, which every customer signs in through. Customers still writing in is shown beside it, since
that may be a reason to wake the team rather than suspend.

  dormant_contacted  (platform setting) {tenant id: {at, by}} the last time its owners were emailed from here """
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
import json
import sys

from backend.database import audit, db as D
from backend.modules.platform import repository
from backend.utils.dates import after, now
from backend.utils.validation import field, require

DAYS = 90
CONTACTED_KEY = 'dormant_contacted'


def _contacted(cd):
    try:
        return json.loads(repository.setting(cd,CONTACTED_KEY) or '{}')
    except ValueError:
        return {}


def _activity(tenant_id):
    """(member last seen, last new case, last customer message, open cases) of one organization."""
    with D.tenant(tenant_id) as db:
        one = lambda sql: db.execute(sql).fetchone()[0]
        return (one('SELECT MAX(last_seen) FROM agent_activity'),one('SELECT MAX(created_at) FROM tickets'),
                one("SELECT MAX(created_at) FROM messages WHERE kind='customer'"),
                one("SELECT COUNT(*) FROM tickets WHERE status NOT IN ('resolved','closed')"))


def listing(cd):
    """The active organizations asleep for DAYS days, the longest asleep first, each with what it holds and who runs it."""
    from backend.modules.organization import repository as organization
    from backend.modules.platform import health, service
    cutoff,home,contacted = after(days=-DAYS),service.home_tenant_id(cd),_contacted(cd)
    found = []
    for org in repository.list_with_member_count(cd):
        if org['status']!='active' or org['id']==home or org['created_at']>=cutoff or not D.tenant_path(org['id']).is_file():
            continue
        seen,case,customer,open_cases = _activity(org['id'])
        if (seen and seen>=cutoff) or (case and case>=cutoff):
            continue
        admins = [{'name':m['name'],'email':m['email']} for m in organization.tenant_members(cd,org['id'])
                  if m['role']=='admin' and m['active'] and not m['expires_at']]
        found.append({'id':org['id'],'name':org['name'],'slug':org['slug'],'created_at':org['created_at'],
                      'members':org['member_count'],'admins':admins,'last_seen':seen,'last_case':case,
                      'last_customer_message':customer,'open_cases':open_cases,
                      'used_bytes':health._folder_bytes(D.DATA/'files'/org['id'])+health._tenant_bytes(org['id']),
                      # Asleep since the last thing that happened in it, or since it was made.
                      'asleep_since':max([v for v in (seen,case,org['created_at']) if v]),
                      'contacted':contacted.get(org['id'])})
    found.sort(key=lambda o:o['asleep_since'])
    return {'days':DAYS,'organizations':found,'mail_ready':service.registration_ready(cd)}


def contact(cd, session, tenant_id, body):
    """Email the organization's admins from the platform's mailbox: {subject, message}. Returns who was emailed."""
    from backend.modules.organization import repository as organization
    from backend.modules.platform import service
    org = repository.find_tenant(cd,tenant_id)
    require(org,'ไม่พบองค์กร',404)
    require(service.registration_ready(cd),'ยังไม่ได้ตั้งค่าอีเมลของระบบ ตั้งที่ ตั้งค่าระบบ → อีเมล หรือคัดลอกอีเมลผู้ดูแลไปส่งเอง',409)
    subject,message = field(body,'subject',200),field(body,'message',5000)
    recipients = [m['email'] for m in organization.tenant_members(cd,tenant_id)
                  if m['role']=='admin' and m['active'] and not m['expires_at']]
    require(recipients,'องค์กรนี้ไม่มีผู้ดูแลที่ติดต่อได้',409)
    cfg,secret = service.registration_config(cd),service.registration_secret()
    sent = _send(recipients,cfg,secret,subject,message)
    require(sent,'ส่งอีเมลไม่สำเร็จ ตรวจการตั้งค่าอีเมลของระบบ',502)
    contacted = _contacted(cd)
    contacted[tenant_id] = {'at':now(),'by':session['name']}
    repository.save_setting(cd,CONTACTED_KEY,json.dumps(contacted,ensure_ascii=False))
    audit.record(cd,session['name'],'tenant.dormant_contacted',tenant_id,', '.join(sent))
    cd.commit()
    return {'sent':sent}


def _send(recipients, cfg, secret, subject, message):
    from backend.extensions import channel_transport as T
    sent = []
    for recipient in recipients:
        try:
            mail = EmailMessage()
            mail['Subject'] = subject
            mail['From'],mail['To'] = cfg['address'],recipient
            mail['Date'],mail['Message-ID'] = formatdate(localtime=False,usegmt=True),make_msgid()
            mail.set_content(message)
            T.send_email(cfg,secret,recipient,mail)
            sent.append(recipient)
        except Exception as error:
            print(f'[{now()}] Dormant organization mail: {type(error).__name__}',file=sys.stderr,flush=True)
    return sent
