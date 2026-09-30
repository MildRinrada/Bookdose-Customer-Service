"""บัญชีผู้ใช้ทั้งระบบ: find an account by its email and stop it everywhere at once.

Suspending an organization stops everyone in it, and signing an account out lasts only until the next sign-in: whoever
knows the password is straight back in. So the account itself carries the state (suspended_at on users and on
customer_accounts), for a staff account and a customer account alike:

  - suspend      every session ends and no new one starts (auth.create_session / customers._new_session refuse it),
                 whatever the way in: password, second step, passkey or a new password from a reset link. Lifted by a
                 platform admin only.
  - force reset  for a password that is known to someone else: the password stops working at once, every session
                 ends, every passkey goes (one may have been added by whoever got in), and the owner is emailed a link
                 to choose a new one - proving the mailbox, which the other person does not have. Needs the platform's
                 email, or nobody could get back in.

Every act is written in the platform's history and the account's own, with the reason given. A platform admin's own
account, or another platform admin's, is not touched here (ทีมผู้ดูแลระบบ removes one)."""
import secrets

from backend.database import audit, db as D
from backend.exceptions.errors import APIError
from backend.utils.dates import now
from backend.utils.security import password_hash
from backend.utils.validation import require

KINDS = ('staff','customer')
MAX_RESULTS = 20
SUSPENDED = 'บัญชีนี้ถูกระงับโดยผู้ดูแลระบบ กรุณาติดต่อผู้ดูแลระบบ'
COLUMNS = (('suspended_at','TEXT'),('suspended_reason',"TEXT NOT NULL DEFAULT ''"))


def upgrade(cd):
    """suspended_at / suspended_reason on both kinds of account (safe to repeat)."""
    for table in ('users','customer_accounts'):
        present = {row[1] for row in cd.execute(f'PRAGMA table_info({table})')}
        for name,declaration in COLUMNS:
            if name not in present:
                cd.execute(f'ALTER TABLE {table} ADD COLUMN {name} {declaration}')


def refuse_suspended(cd, table, account_id):
    """403 before a session starts for a suspended account (auth.create_session, customers._new_session)."""
    row = D.one(cd,f'SELECT suspended_at FROM {table} WHERE id=?',(account_id,))
    if row and row['suspended_at']:
        raise APIError(403,SUSPENDED,{'reason':'account_suspended'})


# Finding
def search(cd, body):
    """Staff and customer accounts whose email contains the text typed (at least 3 letters), with where each works
    or is a customer."""
    text = body.get('email')
    require(isinstance(text,str) and 3<=len(text.strip())<=254,'พิมพ์อีเมลอย่างน้อย 3 ตัวอักษร')
    pattern = '%'+text.strip().lower().replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
    staff = D.rows(cd,r"""SELECT id,name,email,platform_admin,created_at,suspended_at,suspended_reason FROM users
                          WHERE lower(email) LIKE ? ESCAPE '\' ORDER BY email LIMIT ?""",(pattern,MAX_RESULTS))
    customers = D.rows(cd,r"""SELECT id,name,email,created_at,last_login_at,email_verified,suspended_at,suspended_reason
                              FROM customer_accounts WHERE lower(email) LIKE ? ESCAPE '\' ORDER BY email LIMIT ?""",
                       (pattern,MAX_RESULTS))
    for user in staff:
        user['platform_admin'] = bool(user['platform_admin'])
        user['organizations'] = D.rows(cd,'''SELECT t.id,t.name,t.slug,t.status,m.role,m.active,m.expires_at FROM memberships m
                                             JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? ORDER BY t.name''',(user['id'],))
        last = D.one(cd,'SELECT MAX(created_at) AS at FROM sessions WHERE user_id=?',(user['id'],))
        user['signed_in'] = bool(last and last['at'])
    for account in customers:
        account['email_verified'] = bool(account['email_verified'])
        account['organizations'] = D.rows(cd,'''SELECT t.id,t.name,t.slug,t.status FROM customer_orgs o
                                                JOIN tenants t ON t.id=o.tenant_id WHERE o.account_id=? ORDER BY t.name''',(account['id'],))
    return {'staff':staff,'customers':customers,'limit':MAX_RESULTS}


# Acting
def _account(cd, session, kind, account_id):
    require(kind in KINDS,'ประเภทบัญชีไม่ถูกต้อง')
    if kind=='staff':
        row = D.one(cd,'SELECT * FROM users WHERE id=?',(account_id,))
        require(row,'ไม่พบบัญชีนี้',404)
        require(row['id']!=session['user_id'],'ทำกับบัญชีของตัวเองไม่ได้')
        require(not row['platform_admin'],'บัญชีผู้ดูแลแพลตฟอร์มจัดการที่ ทีมผู้ดูแลระบบ',409)
    else:
        row = D.one(cd,'SELECT * FROM customer_accounts WHERE id=?',(account_id,))
        require(row,'ไม่พบบัญชีนี้',404)
    return row


def _reason(body):
    reason = body.get('reason','')
    require(isinstance(reason,str) and len(reason.strip())<=300,'เหตุผลยาวได้ไม่เกิน 300 ตัวอักษร')
    return reason.strip()


def _end_sessions(cd, kind, account_id):
    if kind=='staff':
        cd.execute('DELETE FROM sessions WHERE user_id=?',(account_id,))
    else:
        cd.execute('DELETE FROM customer_sessions WHERE account_id=?',(account_id,))


def _note(cd, kind, account_id, action, detail, client):
    """The account's own history (ตั้งค่าบัญชี → ความปลอดภัย)."""
    if kind=='staff':
        from backend.modules.staff_security import service as staff_security
        staff_security.note(cd,account_id,action,detail,client)
    else:
        from backend.modules.customer_security import service as customer_security
        customer_security.record(cd,account_id,action,detail,client)


def set_suspended(cd, session, kind, account_id, body, client=None):
    """{suspended: bool, reason?}: suspend (sessions end, no new ones) or lift it."""
    row = _account(cd,session,kind,account_id)
    suspended,reason = body.get('suspended'),_reason(body)
    require(isinstance(suspended,bool),'ข้อมูลไม่ถูกต้อง')
    table = 'users' if kind=='staff' else 'customer_accounts'
    if suspended:
        require(not row['suspended_at'],'บัญชีนี้ถูกระงับอยู่แล้ว',409)
        cd.execute(f'UPDATE {table} SET suspended_at=?,suspended_reason=? WHERE id=?',(now(),reason,account_id))
        _end_sessions(cd,kind,account_id)
    else:
        require(row['suspended_at'],'บัญชีนี้ไม่ได้ถูกระงับ',409)
        cd.execute(f"UPDATE {table} SET suspended_at=NULL,suspended_reason='' WHERE id=?",(account_id,))
    action = 'suspended' if suspended else 'unsuspended'
    audit.record(cd,session['name'],f'account.{action}',account_id,f"{row['email']}{' · '+reason if reason else ''}")
    _note(cd,kind,account_id,action,reason,client)
    cd.commit()
    return {'ok':True}


def force_reset(cd, session, kind, account_id, body, client=None):
    """The password stops working, every session and passkey goes, and the owner is emailed a link to choose a new
    one. Returns {emailed}."""
    from backend.modules.platform import service as platform
    row = _account(cd,session,kind,account_id)
    reason = _reason(body)
    require(platform.registration_ready(cd),'ตั้งอีเมลของระบบก่อน (ตั้งค่าระบบ → อีเมล) เจ้าของบัญชีจึงจะได้ลิงก์ตั้งรหัสผ่านใหม่',409)
    table = 'users' if kind=='staff' else 'customer_accounts'
    cd.execute(f'UPDATE {table} SET password=? WHERE id=?',(password_hash(secrets.token_urlsafe(32)),account_id))
    _end_sessions(cd,kind,account_id)
    if kind=='staff':
        from backend.modules.staff_security import service as staff_security
        cd.execute('DELETE FROM staff_resets WHERE user_id=?',(account_id,))
        staff_security.forget_passkeys(cd,account_id,client)
    else:
        from backend.modules.customer_security import service as customer_security
        cd.execute('DELETE FROM customer_resets WHERE account_id=?',(account_id,))
        customer_security.forget_passkeys(cd,account_id,client)
    audit.record(cd,session['name'],'account.password_forced',account_id,f"{row['email']}{' · '+reason if reason else ''}")
    _note(cd,kind,account_id,'password_forced',reason,client)
    cd.commit()
    return {'emailed':_send_link(cd,kind,row['email'])}


def _send_link(cd, kind, email):
    """The usual forgotten-password email: the link is the only way back in now."""
    try:
        if kind=='staff':
            from backend.modules.auth import service as auth
            auth.forgot_password({'email':email})
        else:
            from backend.modules.customers import service as customers
            customers.forgot(cd,{'email':email})
        return True
    except APIError:
        return False
