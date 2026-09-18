"""Inviting a colleague into an organization by email.

Before this, an organization's admin had to invent a first password for every new member and pass it on by hand. Now
the admin only chooses the email, the role and the team: the colleague gets a link, sets their own password, and the
admin never knows it. Somebody who already has an account on the platform is added to the organization by the same
link and signs in with the password they already use.

An invitation needs the platform's mailbox (the same one that sends verification and reset links). Where there is no
mailbox yet, the old way - the admin sets a first password - still works on the members page."""
import secrets
import sys
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from backend.database import audit, db as D
from backend.exceptions.errors import ChannelError
from backend.extensions import channel_transport as T
from backend.middleware.access import validate_team
from backend.modules.auth import repository as users
from backend.modules.invitations import repository, schema
from backend.modules.invitations.model import INVITE_DAYS, KEEP_DAYS, RESEND_SECONDS
from backend.modules.organization import repository as memberships
from backend.modules.platform import repository as tenants, service as platform
from backend.utils.dates import after, now
from backend.utils.security import token_hash, uid
from backend.utils.validation import require

NO_MAILBOX = 'ยังส่งอีเมลเชิญไม่ได้ กรุณาให้ผู้ดูแลแพลตฟอร์มตั้งค่าอีเมลของระบบก่อน หรือเพิ่มสมาชิกพร้อมรหัสผ่านเริ่มต้นแทน'
TOO_SOON = 'เพิ่งส่งคำเชิญไปเมื่อครู่นี้ กรุณารอสักครู่แล้วส่งอีกครั้ง'
# A platform admin looks after the server only; they never join an organization's team (organization/repository.py).
PLATFORM_ACCOUNT = 'อีเมลนี้เป็นบัญชีผู้ดูแลแพลตฟอร์ม ซึ่งดูแลระบบเท่านั้น ไม่รับเคสหรือทำงานในองค์กร กรุณาใช้อีเมลอื่น'


def ready(cd):
    """Invitations can be sent: the platform's mailbox is set up."""
    return platform.registration_ready(cd)


# The organization's admins
def invitations_of(cd, ctx):
    D.begin(cd)
    repository.purge(cd,after(days=-KEEP_DAYS))
    cd.commit()
    return {'invitations':[schema.admin_view(row) for row in repository.of_tenant(cd,ctx['tenant_id'])],
            'can_invite':ready(cd)}


def invite(cd, db, ctx, body):
    """Invite an email address as a member of this organization; an address invited again gets a fresh link."""
    email,role,team_id = schema.invite_form(body)
    validate_team(db,ctx,team_id)
    require(ready(cd),NO_MAILBOX,503)
    D.begin(cd)
    repository.purge(cd,after(days=-KEEP_DAYS))
    user = users.find_user_by_email(cd,email)
    if user:
        require(not user['platform_admin'],PLATFORM_ACCOUNT,409)
        membership = memberships.find_membership(cd,ctx['tenant_id'],user['id'])
        require(not (membership and membership['active'] and not membership['expires_at']),
                'อีเมลนี้เป็นสมาชิกขององค์กรอยู่แล้ว',409)
    # Inviting the same address again (a mistyped role, a team that changed) replaces the open invitation: the
    # waiting period belongs to the plain "ส่งอีกครั้ง" button, which sends the very same invitation once more.
    open_row = repository.open_for(cd,ctx['tenant_id'],email)
    token = _issue(cd,ctx,open_row,email,role,team_id)
    audit.record(db,ctx['name'],'member.invited',ctx['tenant_id'],f'{email} · {role}')
    cd.commit()
    db.commit()
    return {**invitations_of(cd,ctx),'sent':_deliver(cd,ctx,email,token,bool(user))}


def resend(cd, db, ctx, invite_id):
    """Send the same invitation again with a new link; the old link stops working."""
    require(ready(cd),NO_MAILBOX,503)
    D.begin(cd)
    row = repository.find(cd,schema.invite_id(invite_id))
    require(row and row['tenant_id']==ctx['tenant_id'],'ไม่พบคำเชิญนี้',404)
    require(not row['accepted_at'] and not row['cancelled_at'],'คำเชิญนี้ถูกตอบรับหรือยกเลิกไปแล้ว',409)
    require(row['last_sent_at']<=after(seconds=-RESEND_SECONDS),TOO_SOON,429)
    known = bool(users.find_user_by_email(cd,row['email']))
    token = _issue(cd,ctx,row,row['email'],row['role'],row['team_id'])
    audit.record(db,ctx['name'],'member.invited',ctx['tenant_id'],f"{row['email']} · ส่งอีกครั้ง")
    cd.commit()
    db.commit()
    return {**invitations_of(cd,ctx),'sent':_deliver(cd,ctx,row['email'],token,known)}


def cancel(cd, db, ctx, invite_id):
    """Take back an invitation nobody has accepted yet; its link stops working at once."""
    D.begin(cd)
    row = repository.find(cd,schema.invite_id(invite_id))
    require(row and row['tenant_id']==ctx['tenant_id'],'ไม่พบคำเชิญนี้',404)
    require(repository.cancel(cd,row['id'])==1,'คำเชิญนี้ถูกตอบรับหรือยกเลิกไปแล้ว',409)
    audit.record(db,ctx['name'],'member.invite_cancelled',ctx['tenant_id'],row['email'])
    cd.commit()
    db.commit()
    return invitations_of(cd,ctx)


def invite_admin(cd, session, tenant_id, email):
    """The platform console invites an organization's admin (the platform's own organization has none at first):
    the same invitation as a colleague's, role admin, first team. Returns whether the email went out."""
    require(ready(cd),'ยังส่งอีเมลเชิญไม่ได้ ตั้งค่าอีเมลของระบบก่อน หรือสร้างบัญชีผู้ดูแลพร้อมรหัสผ่านเริ่มต้นแทน',503)
    ctx = {'tenant_id':tenant_id,'id':session['user_id'],'name':session['name']}
    with D.tenant(tenant_id) as db:
        D.begin(cd)
        D.begin(db)
        repository.purge(cd,after(days=-KEEP_DAYS))
        user = users.find_user_by_email(cd,email)
        token = _issue(cd,ctx,repository.open_for(cd,tenant_id,email),email,'admin',memberships.first_team_id(db))
        audit.record(db,session['name'],'member.invited',tenant_id,f'{email} · admin')
        cd.commit()
        db.commit()
    return _deliver(cd,ctx,email,token,bool(user))


def open_admin_invites(cd, tenant_id):
    """The emails invited as this organization's admin who have not answered yet."""
    return [row['email'] for row in repository.of_tenant(cd,tenant_id)
            if row['role']=='admin' and not row['accepted_at'] and not row['cancelled_at'] and row['expires_at']>now()]


def member_added(cd, tenant_id, email):
    """The admin added this address on the members page instead: its open invitation waits for nothing any more."""
    repository.cancel_open_for(cd,tenant_id,email)


def _issue(cd, ctx, row, email, role, team_id):
    """A new link for a new or renewed invitation (inside the caller's transaction); returns the raw token."""
    token = secrets.token_urlsafe(32)
    expires_at = after(days=INVITE_DAYS)
    if row:
        repository.renew(cd,row['id'],role,team_id,token_hash(token),expires_at)
    else:
        repository.insert(cd,uid(),ctx['tenant_id'],email,role,team_id,ctx['id'],token_hash(token),expires_at)
    return token


# The invited colleague
def view(cd, query):
    """What the invitation page shows before anybody types anything: which organization, which address, and whether
    the address already has an account (then it asks for nothing, only the password they know)."""
    value = schema.token((query.get('token') or [''])[0])
    row = repository.find_by_token(cd,token_hash(value))
    require(row and not row['accepted_at'] and not row['cancelled_at'] and row['expires_at']>now(),schema.BAD_LINK)
    require(row['tenant_status']=='active','องค์กรนี้หยุดให้บริการชั่วคราว กรุณาติดต่อผู้ดูแลองค์กร',409)
    return {'organization':row['tenant_name'],'email':row['email'],'role':row['role'],
            'needs_account':not users.find_user_by_email(cd,row['email'])}


def accept(cookie_header, body, client=None):
    """Join the organization from the emailed link. Someone without an account chooses their own name and password
    here and is signed in; someone who already has one is added to the organization and signs in as they always do
    (their password, and their second step, are never skipped by a link)."""
    from backend.modules.auth import service as auth
    value = schema.token(body.get('token'))
    with D.control() as cd:
        row = repository.find_by_token(cd,token_hash(value))
        require(row and not row['accepted_at'] and not row['cancelled_at'] and row['expires_at']>now(),schema.BAD_LINK)
        require(row['tenant_status']=='active','องค์กรนี้หยุดให้บริการชั่วคราว กรุณาติดต่อผู้ดูแลองค์กร',409)
        user = users.find_user_by_email(cd,row['email'])
        require(not (user and user['platform_admin']),PLATFORM_ACCOUNT,409)
        name,password = (None,None) if user else schema.accept_form(body)
        with D.tenant(row['tenant_id']) as db:
            # The team of the invitation may have been removed while the link was on its way.
            team_id = row['team_id'] if row['team_id'] and memberships.team_exists(db,row['team_id']) else memberships.first_team_id(db)
            D.begin(cd)
            D.begin(db)
            require(repository.accept(cd,row['id'])==1,schema.BAD_LINK)
            if user:
                user_id = user['id']
            else:
                user_id = uid()
                users.insert_user(cd,user_id,name,row['email'],password)
                users.mark_email_verified(cd,user_id)
            repository.grant(cd,row['tenant_id'],user_id,row['role'],team_id,memberships.find_membership(cd,row['tenant_id'],user_id))
            audit.record(cd,user_id,'member.joined',row['tenant_id'])
            audit.record(db,name or user['name'],'member.joined',user_id,row['role'])
            cd.commit()
            db.commit()
        answer = {'organization':row['tenant_name'],'email':row['email'],'signed_in':not user}
        if user:
            return answer,None
        return answer,auth.replace_session(cd,cookie_header,user_id,client)


# Sending the invitation
def _deliver(cd, ctx, email, token, known):
    """Send the link; False when the mailbox refused it (the invitation stays, the admin can send it again)."""
    try:
        cfg,secret = platform.registration_config(cd),platform.registration_secret()
        org = tenants.tenant_summary(cd,ctx['tenant_id'])
        link = cfg['public_base_url'].rstrip('/')+'/invite?token='+token
        mail = EmailMessage()
        mail['Subject'] = f"คำเชิญร่วมทีมงานของ {org['name']}"
        mail['From'],mail['To'] = cfg['address'],email
        mail['Date'],mail['Message-ID'],mail['Auto-Submitted'] = formatdate(localtime=False,usegmt=True),make_msgid(),'auto-generated'
        mail.set_content(f"{ctx['name']} เชิญคุณเข้าร่วมเป็นทีมงานของ {org['name']} บนระบบบริการลูกค้า Bookdose\n\n"
                         f"เปิดลิงก์นี้เพื่อ{'เข้าร่วมองค์กร' if known else 'ตั้งรหัสผ่านของคุณเองและเริ่มใช้งาน'}:\n{link}\n\n"
                         +('อีเมลนี้มีบัญชีอยู่แล้ว เมื่อเข้าร่วมแล้วให้เข้าสู่ระบบด้วยรหัสผ่านเดิมของคุณ\n'
                           if known else 'คุณจะเป็นผู้ตั้งรหัสผ่านเอง ไม่มีใครในองค์กรรู้รหัสผ่านของคุณ\n')
                         +f"ลิงก์มีอายุ {INVITE_DAYS} วันและใช้ได้ครั้งเดียว\n"
                         "หากคุณไม่ได้คาดหวังคำเชิญนี้ ไม่ต้องทำอะไร จะไม่มีอะไรเกิดขึ้นกับอีเมลของคุณ\n")
        T.send_email(cfg,secret,email,mail)
        return True
    except ChannelError:
        return False
    except Exception as error:
        print(f'[{now()}] Invitation mail: {type(error).__name__}',file=sys.stderr,flush=True)
        return False
