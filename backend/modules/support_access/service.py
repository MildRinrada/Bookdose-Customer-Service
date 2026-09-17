"""Support access with the organization's consent (model.py has the states).

The rules:
  * asking gives nothing: a platform admin can read an organization's cases only after one of its own admins approves,
    and only until the time they approved runs out (at most the time asked for);
  * the organization's admins are told by email when someone asks, see every request with its reason, and can stop an
    access at any moment; the platform admin can withdraw a request or leave early;
  * a member of the organization with a permanent membership never goes through here, and support access never
    changes a permanent membership;
  * every step is written to the platform's history and to the organization's own history."""
import sys
import threading
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from backend.database import audit, db as D
from backend.modules.organization import repository as memberships
from backend.modules.platform import repository as tenants
from backend.modules.support_access import repository, schema
from backend.modules.support_access.model import PENDING_HOURS
from backend.utils.dates import after, now
from backend.utils.security import uid
from backend.utils.validation import require

GONE = 'คำขอนี้ถูกตัดสินหรือสิ้นสุดไปแล้ว กรุณารีเฟรชหน้า'


def _tenant_audit(tenant_id, actor, action, entity, detail=''):
    with D.tenant(tenant_id) as td:
        audit.record(td,actor,action,entity,detail)


# The platform admin
def request_access(cd, session, tenant_id, body):
    """Ask to enter an organization for support; returns the request id. Nothing can be read until it is approved."""
    reason,hours = schema.request_form(body)
    D.begin(cd)
    tidy(cd)
    require(tenants.find_tenant(cd,tenant_id),'ไม่พบองค์กร',404)
    require(tenants.is_active(cd,tenant_id),'องค์กรนี้ถูกระงับอยู่',409)
    user_id = session['user_id']
    membership = memberships.find_membership(cd,tenant_id,user_id)
    require(not (membership and membership['active'] and not membership['expires_at']),'คุณเป็นสมาชิกขององค์กรนี้อยู่แล้ว',409)
    require(not repository.open_request(cd,tenant_id,user_id),'มีคำขอที่รออนุมัติหรือสิทธิ์ที่ยังใช้งานอยู่แล้ว',409)
    request_id = uid()
    repository.insert(cd,request_id,tenant_id,user_id,reason,hours)
    audit.record(cd,user_id,'tenant.support_requested',tenant_id,reason)
    _tenant_audit(tenant_id,session['name'],'tenant.support_requested',user_id,f'{reason} · {hours} ชม.')
    cd.commit()
    _tell_admins(tenant_id,session['name'],reason,hours)
    return request_id


def withdraw(cd, session, request_id):
    """The platform admin withdraws a waiting request, or leaves an access in force early."""
    D.begin(cd)
    row = repository.find(cd,schema.request_id(request_id))
    require(row and row['user_id']==session['user_id'],'ไม่พบคำขอนี้',404)
    if row['status']=='pending':
        repository.cancel(cd,row['id'])
        action = 'tenant.support_cancelled'
    else:
        require(row['status']=='approved' and row['expires_at']>now(),GONE,409)
        _stop(cd,row,session['user_id'])
        action = 'tenant.support_ended'
    audit.record(cd,session['user_id'],action,row['tenant_id'])
    _tenant_audit(row['tenant_id'],session['name'],action,row['user_id'])
    cd.commit()


def my_requests(cd, user_id):
    """{tenant id: the request} of the platform admin's waiting and current accesses (the organizations page)."""
    tidy(cd)
    cd.commit()
    found = {}
    for row in repository.open_of_user(cd,user_id):
        found.setdefault(row['tenant_id'],schema.platform_view(row))
    return found


# The organization's admins
def requests_of(cd, ctx):
    tidy(cd)
    cd.commit()
    return {'requests':[schema.admin_view(row) for row in repository.of_tenant(cd,ctx['tenant_id'])]}


def approve(cd, db, ctx, request_id, body):
    """Say yes: the platform admin is a manager of the organization until the time chosen (no longer than asked)."""
    D.begin(cd)
    tidy(cd)
    row = repository.find(cd,schema.request_id(request_id))
    require(row and row['tenant_id']==ctx['tenant_id'],'ไม่พบคำขอนี้',404)
    require(row['status']=='pending',GONE,409)
    hours = schema.approved_hours(body,row['hours'])
    existing = memberships.find_membership(cd,row['tenant_id'],row['user_id'])
    require(not (existing and existing['active'] and not existing['expires_at']),'ผู้ขอเป็นสมาชิกขององค์กรนี้อยู่แล้ว',409)
    expires_at = after(hours=hours)
    require(repository.decide(cd,row['id'],'approved',ctx['id'],schema.note(body),expires_at)==1,GONE,409)
    repository.grant(cd,row['tenant_id'],row['user_id'],memberships.first_team_id(db),expires_at,existing)
    detail = f"{row['user_name']} · {hours} ชม. · {row['reason']}"
    audit.record(cd,ctx['id'],'tenant.support_access',row['tenant_id'],row['reason'])
    audit.record(db,ctx['name'],'tenant.support_access',row['user_id'],detail)
    cd.commit()
    db.commit()
    from backend.modules.security import events
    events.record('support_access',actor='platform',subject=row['user_email'],tenant_id=row['tenant_id'],
                  detail={'reason':row['reason'][:300],'hours':hours,'approved_by':ctx['name']})
    return requests_of(cd,ctx)


def deny(cd, db, ctx, request_id, body):
    D.begin(cd)
    row = repository.find(cd,schema.request_id(request_id))
    require(row and row['tenant_id']==ctx['tenant_id'],'ไม่พบคำขอนี้',404)
    require(repository.decide(cd,row['id'],'denied',ctx['id'],schema.note(body))==1,GONE,409)
    audit.record(cd,ctx['id'],'tenant.support_denied',row['tenant_id'],row['reason'])
    audit.record(db,ctx['name'],'tenant.support_denied',row['user_id'],row['reason'])
    cd.commit()
    db.commit()
    return requests_of(cd,ctx)


def end(cd, db, ctx, request_id):
    """Stop an access in force now."""
    D.begin(cd)
    row = repository.find(cd,schema.request_id(request_id))
    require(row and row['tenant_id']==ctx['tenant_id'],'ไม่พบคำขอนี้',404)
    require(row['status']=='approved' and row['expires_at']>now(),GONE,409)
    _stop(cd,row,ctx['id'],db)
    audit.record(cd,ctx['id'],'tenant.support_ended',row['tenant_id'])
    audit.record(db,ctx['name'],'tenant.support_ended',row['user_id'])
    cd.commit()
    db.commit()
    return requests_of(cd,ctx)


def member_removed(cd, db, tenant_id, user_id, actor_id):
    """An admin switched off a support member on the members page: the approved request ends with it."""
    row = repository.approved_for(cd,tenant_id,user_id)
    if row:
        repository.end(cd,row['id'],actor_id)


def _stop(cd, row, by_user_id, db=None):
    repository.end(cd,row['id'],by_user_id)
    repository.withdraw(cd,row['tenant_id'],row['user_id'])
    _unassign(row['tenant_id'],row['user_id'],db)


def _unassign(tenant_id, user_id, db=None):
    from backend.modules.tickets import repository as tickets
    if db is not None:
        tickets.unassign_member(db,user_id,False,'')
        return
    with D.tenant(tenant_id) as td:
        tickets.unassign_member(td,user_id,False,'')


# Keeping it tidy
def tidy(cd):
    """Requests nobody decided lapse; accesses whose time is over are closed (the membership checks already ignore
    them from that minute). The caller commits."""
    repository.lapse_pending(cd,after(hours=-PENDING_HOURS))
    for row in repository.ran_out(cd):
        repository.mark_expired(cd,row['id'])
        repository.withdraw(cd,row['tenant_id'],row['user_id'])
        try:
            _unassign(row['tenant_id'],row['user_id'])
        except ValueError:
            pass
        audit.record(cd,'ระบบ','tenant.support_expired',row['tenant_id'])


def sweep():
    """The automation worker's round."""
    with D.control() as cd:
        D.begin(cd)
        tidy(cd)


def pending_for(cd, ctx):
    """How many requests wait for this organization's admins (0 for anyone else)."""
    return repository.pending_count(cd,ctx['tenant_id']) if ctx.get('role')=='admin' else 0


# Telling the organization's admins
def _tell_admins(tenant_id, requester, reason, hours):
    threading.Thread(target=_mail_admins,args=(tenant_id,requester,reason,hours),daemon=True).start()


def _mail_admins(tenant_id, requester, reason, hours):
    from backend.extensions import channel_transport as T
    from backend.modules.platform import service as platform
    try:
        with D.control() as cd:
            if not platform.registration_ready(cd):
                return
            cfg,secret = platform.registration_config(cd),platform.registration_secret()
            org = tenants.tenant_summary(cd,tenant_id)
            admins = D.rows(cd,'''SELECT u.email FROM memberships m JOIN users u ON u.id=m.user_id
                                  WHERE m.tenant_id=? AND m.role='admin' AND m.active=1 AND m.expires_at IS NULL''',(tenant_id,))
        for admin in admins:
            mail = EmailMessage()
            mail['Subject'] = f"คำขอเข้าช่วยดูแลองค์กร {org['name']} รอการอนุมัติ"
            mail['From'],mail['To'] = cfg['address'],admin['email']
            mail['Date'],mail['Message-ID'],mail['Auto-Submitted'] = formatdate(localtime=False,usegmt=True),make_msgid(),'auto-generated'
            mail.set_content(f"{requester} จากทีมผู้ดูแลแพลตฟอร์ม ขอเข้าพื้นที่ทำงานของ {org['name']} เพื่อช่วยเหลือ\n\n"
                             f"เหตุผล: {reason}\nระยะเวลาที่ขอ: {hours} ชั่วโมง\n\n"
                             "ยังไม่มีใครเข้าองค์กรได้จนกว่าผู้ดูแลองค์กรจะอนุมัติ อนุมัติหรือปฏิเสธได้ที่ ตั้งค่าองค์กร → สมาชิก\n"
                             f"คำขอที่ไม่มีใครตัดสินภายใน {PENDING_HOURS} ชั่วโมงจะหมดอายุเอง\n\n{cfg.get('public_base_url','')}/settings\n")
            T.send_email(cfg,secret,admin['email'],mail)
    except Exception as error:
        print(f'[{now()}] Support request notice: {type(error).__name__}',file=sys.stderr,flush=True)
