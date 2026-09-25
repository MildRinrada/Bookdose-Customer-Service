"""ความปลอดภัยของทีม: an owner can require every member of the organization to protect their account with two-step
sign-in or a passkey. A member without either can still sign in and reach their own account settings (to turn one
on), but nothing of the organization until they do: every workspace request answers 403 with reason
'two_factor_required' (middleware/auth.require_team_security), and the web app shows them the way there.

A platform admin looking in on support access is not a member and is not held back (they only read). The owner who
turns it on must already have one, so no organization can lock its own owner out."""
from backend.database import audit
from backend.exceptions.errors import APIError
from backend.utils.validation import require

KEY = 'require_two_factor'
REQUIRED = 'องค์กรนี้กำหนดให้เจ้าหน้าที่ทุกคนเปิดการยืนยันตัวตน 2 ขั้น หรือเพิ่ม Passkey ก่อนเข้าใช้งาน'
REASON = 'two_factor_required'


def required(db):
    row = db.execute('SELECT value FROM settings WHERE key=?',(KEY,)).fetchone()
    return bool(row and row[0]=='1')


def check(req):
    """Called for every workspace request once the organization is known."""
    if req.ctx.get('read_only') or not required(req.db):
        return
    from backend.modules.staff_security import service as staff_security
    if not staff_security.protected(req.cd,req.session['user_id']):
        raise APIError(403,REQUIRED,{'reason':REASON})


def overview(cd, db, ctx):
    """The switch, and which members are protected now (those who would be held back once it is on)."""
    from backend.modules.organization import repository
    from backend.modules.staff_security import service as staff_security
    members = [m for m in repository.tenant_members(cd,ctx['tenant_id']) if m['active']]
    return {'require_two_factor':required(db),
            'members':[{'id':m['id'],'name':m['name'],'email':m['email'],'role':m['role'],
                        'protected':staff_security.protected(cd,m['id'])} for m in members]}


def save(cd, db, ctx, body):
    from backend.modules.staff_security import service as staff_security
    on = body.get('require_two_factor')
    require(type(on) is bool,'ข้อมูลไม่ถูกต้อง')
    if on:
        require(staff_security.protected(cd,ctx['id']),
                'เปิดการยืนยันตัวตน 2 ขั้นหรือเพิ่ม Passkey ให้บัญชีของคุณเองก่อน ที่ ตั้งค่าบัญชี → ความปลอดภัย',409)
    db.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(KEY,'1' if on else '0'))
    audit.record(db,ctx['name'],'settings.updated',ctx['tenant_id'],
                 'บังคับเจ้าหน้าที่ใช้การยืนยันตัวตน 2 ขั้น' if on else 'เลิกบังคับการยืนยันตัวตน 2 ขั้น')
    db.commit()
    return overview(cd,db,ctx)
