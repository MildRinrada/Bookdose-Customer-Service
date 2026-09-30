"""ปิดปรับปรุง that holds the data still: while the platform team's status note (status.py) is in the 'maintenance'
state, every change from staff, customers and guests is refused with 503, and reading goes on as usual. What still
goes through:
  - the platform console itself, so the team doing the work can finish it and take the note down;
  - signing in and out, and ending other sessions, so nobody is locked out of their own account or unable to cut off
    one that is not theirs;
  - the providers' webhooks (routed before this check), so a customer's LINE or Facebook message is kept rather than
    lost while the doors are shut.
The background workers carry on too: replies already queued before the note still go out.

Every page shows why: while it lasts the in-app bar says so (health.active_announcement)."""
from backend.database import db as D
from backend.exceptions.errors import APIError
from backend.modules.platform import status

MESSAGE = 'ระบบปิดปรับปรุงชั่วคราว ยังดูข้อมูลได้ตามปกติ แต่บันทึกหรือส่งข้อมูลไม่ได้จนกว่าการปรับปรุงจะเสร็จ'
BAR = 'ระบบปิดปรับปรุงชั่วคราว ดูข้อมูลได้ แต่ยังบันทึกหรือส่งข้อมูลไม่ได้'
OPEN = {
    '/api/login','/api/sign-in','/api/login/verify','/api/sign-in/passkey/options','/api/sign-in/passkey',
    '/api/logout','/api/session/activity','/api/session/tenant','/api/accounts/switch','/api/accounts/sign-out-all',
    '/api/account/confirm-password','/api/sign-in-alerts/check','/api/sign-in-alerts/not-me',
    '/api/customer/login','/api/customer/login/verify','/api/customer/passkey/options','/api/customer/passkey/login',
    '/api/customer/logout',
}
# One other signed-in account signed out; one session ended, or all of them.
OPEN_PATTERNS = (('/api/accounts/','/sign-out'),('/api/account/security/sessions/',''))


def active(cd):
    written = status.notice(cd)
    return bool(written and written.get('state')=='maintenance')


def _open(path):
    return (path in OPEN or path.startswith('/api/platform')
            or any(path.startswith(head) and path.endswith(tail) and len(path)>len(head+tail) for head,tail in OPEN_PATTERNS))


def refuse(req, path):
    """503 for a change while the platform is under maintenance; reading and the paths above go through."""
    if req.command=='GET' or _open(path):
        return
    with D.control() as cd:
        if active(cd):
            raise APIError(503,MESSAGE)
