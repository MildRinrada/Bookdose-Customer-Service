"""The owner's client team in one organization: inviting staff by email with a preset role on all or some projects,
the invitee accepting or declining, changing a member's role or projects, and removing a member (at once: access is
checked on every request, see access.py). Declined and removed rows stay as history; inviting the email again
re-opens the same row.

Accepting needs a signed-in account whose email is the invited one and is proven (email_verified). While the platform
cannot send email (customers.service.email_ready False) any account with that email may accept: the same trust as
signing up without email, where no address is ever proven. Accepting also connects the account with the organization.
The invitation email goes out after the commit and only when email works; a failed delivery is not an error, since
the invitee also finds the invitation on their overview (client_invites in the control database)."""
import json

from backend.database import audit, db as D
from backend.exceptions.errors import ChannelError
from backend.modules.client_team import access, approvals, repository, schema
from backend.modules.contracts import schema as contract_schema
from backend.modules.customers import repository as accounts, service as customers
from backend.modules.platform import repository as tenants, service as platform
from backend.utils.security import uid
from backend.utils.validation import require

MEMBER_GONE = 'ไม่พบสมาชิกนี้ในทีมของคุณ'
INVITE_GONE = 'ไม่พบคำเชิญนี้ หรือคำเชิญถูกยกเลิกแล้ว'


def _name(cd, account_id):
    account = accounts.find(cd,account_id) if account_id else None
    return account['name'] if account else ''


def _projects(db, owner_id):
    """What an owner can give a member: every contract sent to them here, except MA contracts (they follow the
    project they renew)."""
    return [c for c in repository.sent_contracts(db,owner_id) if not c['renews_id']]


def _project_ids(db, owner_id):
    return {c['id'] for c in _projects(db,owner_id)}


def _tell(cd, email, subject, text):
    """Email the invitee (after the commit, when email works); a failed delivery is not an error. An email that
    already has an account follows its choice for the 'team' event (ตั้งค่าบัญชี → การแจ้งเตือน); the invitation still
    waits on its alerts page either way."""
    from backend.modules.customers import notify
    if not customers.email_ready(cd):
        return
    account = accounts.find_by_email(cd,email)
    if account and not notify.wants(account,'team','email'):
        return
    cfg = platform.registration_config(cd)
    try:
        customers._send(cfg,platform.registration_secret(),email,subject,f"{text}\n{cfg['public_base_url']}/customer/team\n")
    except ChannelError:
        pass


def team_view(cd, db, session):
    """The signed-in customer's own team (members and the projects they can be given), the teams they belong to, and
    the roles with what each may do."""
    me = session['account_id']
    return {'mine':{'members':[schema.member_view(m,_name(cd,m['account_id'])) for m in repository.of_owner(db,me)],
                    'projects':[{'id':c['id'],'reference':contract_schema.reference(c),'title':c['title'],'status':c['status']}
                                for c in _projects(db,me)]},
            'memberships':[{'owner_id':m['owner_id'],'owner_name':_name(cd,m['owner_id']),'role':m['role'],
                            'role_label':access.ROLE_LABELS[m['role']],'all_projects':bool(m['all_projects']),
                            'projects':json.loads(m['projects']),'accepted_at':m['accepted_at']} for m in repository.memberships(db,me)],
            'roles':schema.roles()}


def invite(cd, db, org, session, body):
    """Invite an email into the signed-in customer's team (they are its owner); returns the row id. Not your own email;
    an email already invited or active is refused, a declined or removed one is invited again on the same row."""
    owner = session['account_id']
    email,role,everything,projects = schema.invite_form(body,_project_ids(db,owner))
    require(email!=session['email'].lower(),'เชิญอีเมลของตัวเองไม่ได้')
    D.begin(db)
    found = repository.find_email(db,owner,email)
    if found:
        require(found['status'] in ('declined','removed'),'อีเมลนี้อยู่ในทีมหรือได้รับคำเชิญแล้ว',409)
        member_id = found['id']
        repository.reopen(db,member_id,role,everything,projects,owner)
    else:
        member_id = uid()
        repository.insert(db,member_id,owner,email,role,everything,projects,owner)
    audit.record(db,session['name'],'client_team.invited',member_id,email)
    db.commit()
    repository.add_invite(cd,email,org['id'],member_id)
    cd.commit()
    _tell(cd,email,f"คุณ{session['name']} เชิญคุณร่วมทีมโครงการกับ {org['name']}",
          f"คุณ{session['name']} เชิญคุณเป็น{access.ROLE_LABELS[role]} ในสัญญาและโครงการกับ {org['name']}\n"
          'เข้าสู่ระบบด้วยอีเมลนี้ (สมัครได้หากยังไม่มีบัญชี) แล้วกดรับคำเชิญที่:')
    return member_id


def _mine(db, session, member_id):
    """A member or invitation of the signed-in owner's team that has not ended; 404 otherwise."""
    member = repository.find(db,schema.member_id(member_id))
    require(member and member['owner_id']==session['account_id'] and member['status'] in ('invited','active'),MEMBER_GONE,404)
    return member


def update(db, session, member_id, body):
    """The owner changes a member's role or projects; it applies from the member's next request (and the member leaves
    the approval flows it may no longer review in)."""
    member = _mine(db,session,member_id)
    role,everything,projects = schema.update_form(body,_project_ids(db,session['account_id']))
    D.begin(db)
    repository.update(db,member['id'],role,everything,projects)
    if member['account_id'] and member['status']=='active':
        approvals.on_member_removed(db,member['owner_id'],member['account_id'])
    audit.record(db,session['name'],'client_team.updated',member['id'],member['email'])
    db.commit()


def remove(cd, db, org, session, member_id):
    """The owner removes a member (or withdraws an invitation): access ends at once, and the member leaves every
    approval flow of the owner."""
    member = _mine(db,session,member_id)
    D.begin(db)
    repository.end(db,member['id'],'removed')
    if member['account_id']:
        approvals.on_member_removed(db,member['owner_id'],member['account_id'])
    audit.record(db,session['name'],'client_team.removed',member['id'],member['email'])
    db.commit()
    repository.drop_invite(cd,org['id'],member['id'])
    cd.commit()


def _invitation(cd, db, session, member_id):
    """An invitation waiting for the signed-in account's email (proven, unless the platform cannot send email)."""
    member = repository.find(db,schema.member_id(member_id))
    require(member and member['status']=='invited' and member['email']==session['email'].lower()
            and member['owner_id']!=session['account_id'],INVITE_GONE,404)
    require(session['email_verified'] or not customers.email_ready(cd),'กรุณายืนยันอีเมลของบัญชีก่อนรับคำเชิญ (ตั้งค่าบัญชี → ขอลิงก์ยืนยัน)',403)
    return member


def accept(cd, db, org, session, member_id):
    """The invitee joins the team (and the organization)."""
    member = _invitation(cd,db,session,member_id)
    # Before this connection writes: joining writes the organization's database through its own connection.
    customers._join(cd,session['account_id'],org)
    D.begin(db)
    require(repository.activate(db,member['id'],session['account_id']),INVITE_GONE,409)
    audit.record(db,session['name'],'client_team.accepted',member['id'],member['email'])
    db.commit()
    repository.drop_invite(cd,org['id'],member['id'])
    cd.commit()


def decline(cd, db, org, session, member_id):
    member = _invitation(cd,db,session,member_id)
    D.begin(db)
    repository.end(db,member['id'],'declined')
    audit.record(db,session['name'],'client_team.declined',member['id'],member['email'])
    db.commit()
    repository.drop_invite(cd,org['id'],member['id'])
    cd.commit()


def invitations(cd, session):
    """Invitations waiting for this account's email in every active organization, newest first:
    [{id, org_slug, org_name, owner_name, role, role_label, invited_at}] (for the overview). None while the account's
    address is unproven and email works: it could not accept them (_invitation), so it learns nothing about them."""
    found = []
    if not session['email_verified'] and customers.email_ready(cd):
        return found
    email = session['email'].lower()
    for invite in repository.invites_for(cd,email):
        org = tenants.find_active(cd,invite['tenant_id'])
        if not org:
            continue
        with D.tenant(org['id']) as db:
            member = repository.find(db,invite['invite_id'])
        if member and member['status']=='invited' and member['email']==email:
            found.append({'id':member['id'],'org_slug':org['slug'],'org_name':org['name'],'owner_name':_name(cd,member['owner_id']),
                          'role':member['role'],'role_label':access.ROLE_LABELS[member['role']],'invited_at':member['invited_at']})
    found.sort(key=lambda i:i['invited_at'],reverse=True)
    return found
