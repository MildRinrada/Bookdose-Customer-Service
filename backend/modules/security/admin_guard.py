"""ความปลอดภัยของผู้ดูแลแพลตฟอร์ม: a platform admin's account reaches every organization, so the console asks more of
it than an organization asks of its members.

- Two-step sign-in on a production server. A platform admin without a second factor or a passkey signs in and
  reaches ตั้งค่าบัญชี (to add one), but nothing of the console: every /api/platform request answers 403 with reason
  'platform_two_factor_required' (backend/http/dispatch.py), and the web app shows the way there. The server owner's
  way back in for a lost phone (python -m backend.modules.staff_security reset <email>) leaves the account at this
  gate again. BOOKDOSE_PLATFORM_2FA=on / off decides; unset, it is on where the server runs in production (HTTPS
  cookies, or Render) and off on a developer's computer, where nobody should have to set up an authenticator to try
  the console.
- The password again before a dangerous act: restoring or downloading a backup, the PDPA tools, suspending an
  organization, exporting or closing one for good, resetting a staff member's two-step sign-in, making an organization
  admin, adding or removing platform admins, the platform's email, SMS and
  Turnstile, and the security settings. The session must have proven its password within CONFIRM_SECONDS (signing in
  counts), else 403 with reason 'reauth_required'; the web app asks for the password (POST
  /api/account/confirm-password) and sends the request again. A console left open on a borrowed computer can be
  looked at, not used. MAX_WRONG wrong passwords in a row sign that session out."""
import datetime as dt
import functools
import threading

from config import settings
from backend.database import db as D
from backend.exceptions.errors import APIError
from backend.utils.dates import now
from backend.utils.security import password_ok
from backend.utils.validation import existing_password

CONFIRM_SECONDS = 300
MAX_WRONG = 5
TWO_FACTOR_REQUIRED = 'ผู้ดูแลแพลตฟอร์มต้องเปิดการยืนยันตัวตน 2 ขั้น หรือเพิ่ม Passkey ก่อนใช้คอนโซลระบบกลาง'
TWO_FACTOR_REASON = 'platform_two_factor_required'
CONFIRM_REQUIRED = 'กรุณายืนยันรหัสผ่านอีกครั้งก่อนทำรายการนี้'
CONFIRM_REASON = 'reauth_required'
WRONG = 'รหัสผ่านไม่ถูกต้อง'
SIGNED_OUT = 'ใส่รหัสผ่านไม่ถูกต้องหลายครั้ง ระบบจึงออกจากระบบให้เพื่อความปลอดภัย กรุณาเข้าสู่ระบบใหม่'
_wrong = {}
_wrong_lock = threading.Lock()


# Two-step sign-in
def two_factor_enforced(server=None):
    """BOOKDOSE_PLATFORM_2FA when set; else whether this server runs in production (HTTPS cookies, or Render)."""
    chosen = settings.platform_two_factor()
    if chosen is not None:
        return chosen
    return settings.on_render() or settings.SECURE_COOKIES or bool(getattr(server,'secure_cookies',False))


def console_locked(cd, session, server=None):
    """A platform admin whose account has neither a second factor nor a passkey, on a server that asks for one."""
    from backend.modules.staff_security import service as staff_security
    return (bool(session and session['platform_admin']) and two_factor_enforced(server)
            and not staff_security.protected(cd,session['user_id']))


def require_protected(req):
    if console_locked(req.cd,req.session,req.server):
        raise APIError(403,TWO_FACTOR_REQUIRED,{'reason':TWO_FACTOR_REASON})


# The password again
def _moment(value):
    return dt.datetime.fromisoformat(value)


def confirmed_until(session):
    """Until when the session counts as having just proven its password (its sign-in or its last confirmation)."""
    return (_moment(session.get('confirmed_at') or session['created_at'])+dt.timedelta(seconds=CONFIRM_SECONDS)).isoformat(timespec='seconds')


def confirm_first(controller):
    """Controller decorator: a dangerous act, allowed only within CONFIRM_SECONDS of proving the password."""
    @functools.wraps(controller)
    def guarded(req, *args):
        if confirmed_until(req.session)<=now():
            raise APIError(403,CONFIRM_REQUIRED,{'reason':CONFIRM_REASON})
        return controller(req,*args)
    return guarded


def confirm_password(req):
    """POST /api/account/confirm-password: the session proves its password again. Each wrong one is written in the
    account's history and recorded; the MAX_WRONG-th in a row ends the session."""
    from backend.modules.security import events
    from backend.modules.staff_security import service as staff_security
    session,cd = req.session,req.cd
    password = existing_password(req.body)
    client = staff_security.client_info(req)
    user = D.one(cd,'SELECT password FROM users WHERE id=?',(session['user_id'],))
    actor = 'platform' if session['platform_admin'] else 'staff'
    if not user or not password_ok(password,user['password']):
        with _wrong_lock:
            count = _wrong[session['id']] = _wrong.get(session['id'],0)+1
            if count>=MAX_WRONG:
                _wrong.pop(session['id'],None)
        staff_security.note(cd,session['user_id'],'reauth_failed',client=client)
        if count>=MAX_WRONG:
            cd.execute('DELETE FROM sessions WHERE token=?',(session['token'],))
            staff_security.note(cd,session['user_id'],'reauth_signed_out',client=client)
        cd.commit()
        events.record('reauth_failed',actor=actor,subject=session['email'],ip=client.get('ip',''),user_agent=client.get('user_agent',''),
                      detail={'signed_out':count>=MAX_WRONG})
        if count>=MAX_WRONG:
            raise APIError(401,SIGNED_OUT)
        raise APIError(403,WRONG)
    with _wrong_lock:
        _wrong.pop(session['id'],None)
    moment = now()
    cd.execute('UPDATE sessions SET confirmed_at=? WHERE token=?',(moment,session['token']))
    staff_security.note(cd,session['user_id'],'reauth',client=client)
    cd.commit()
    return {'confirmed_until':confirmed_until({**session,'confirmed_at':moment})}
