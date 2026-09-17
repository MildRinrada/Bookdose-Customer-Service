"""Authentication and role checks: who is calling, and whether their role may use an endpoint."""
import functools
import secrets

from backend.utils.validation import require


def client(req):
    return {'ip':getattr(req,'ip','') or '','user_agent':(req.headers.get('User-Agent') or '')[:300]}


def signed_in_session(req, optional=False):
    """The staff session from the cookie; 401 unless optional ({reason: idle|absolute} when it has just run out; with
    optional, req.session_expired holds that reason instead)."""
    from backend.modules.auth.service import load_session
    from backend.modules.security import sessions
    session,reason = load_session(req.cd,req.headers.get('Cookie',''),client(req))
    req.session_expired = reason
    if not optional:
        if reason:
            raise sessions.expired_error(reason)
        require(session,'กรุณาเข้าสู่ระบบ',401)
    return session


def _csrf_refused(req, actor, subject, header):
    from backend.modules.security import events
    events.from_request(req,'csrf_rejected',actor=actor,subject=subject,detail={'header':header,'missing':not req.headers.get(header)})
    require(False,'เซสชันไม่ถูกต้อง กรุณารีเฟรชหน้า',403)


def check_csrf(req):
    """Every change must carry the CSRF token of the session. A change that does is real use of the session: its idle
    time starts again (reading never does)."""
    if req.command!='GET':
        if not secrets.compare_digest(req.headers.get('X-CSRF-Token',''),req.session['csrf']):
            from backend.modules.security import events
            _csrf_refused(req,events.staff_actor(req.session),req.session['email'],'X-CSRF-Token')
        from backend.modules.auth.service import touch_session
        touch_session(req.cd,req.session)


def require_platform_admin(req):
    require(req.session['platform_admin'],'เฉพาะผู้ดูแลแพลตฟอร์ม',403)


def select_workspace(req):
    """The signed-in member's context in the session's organization."""
    from backend.modules.auth.service import workspace_context
    ctx = workspace_context(req.cd,req.session)
    # A tab must declare its selected tenant, preventing writes after another tab switches the session.
    require(req.headers.get('X-Tenant-ID')==ctx['tenant_id'],'องค์กรที่เลือกเปลี่ยนไป กรุณารีเฟรชหน้า',409)
    return ctx


def customer_session(req):
    """The signed-in customer (session cookie, control database). A changing request must also carry the session's
    X-Customer-CSRF token."""
    from backend.modules.customers.service import load_session, touch_session
    from backend.modules.security import sessions
    session,reason = load_session(req.cd,req.headers.get('Cookie',''),client(req))
    if reason:
        raise sessions.expired_error(reason)
    require(session,'กรุณาเข้าสู่ระบบบัญชีลูกค้า',401)
    if req.command!='GET':
        if not secrets.compare_digest(req.headers.get('X-Customer-CSRF',''),session['csrf']):
            _csrf_refused(req,'customer',session['email'],'X-Customer-CSRF')
        touch_session(req.cd,session)
    return session


def guest_session(req):
    """The guest of this organization from the browser's g_<org> cookie (guest web chat): {'visitor','device','token'}
    or None. An unknown or malformed cookie counts as no guest and the answer clears it. A changing request must carry
    the device's X-Guest-CSRF; without it the guest is not used and req.guest_stale holds it instead (a 'guest' route
    then answers 403; opening a follow link, which proves itself, still replaces that browser's device). A remembered cookie is sent again when the browser was last seen more than a day ago."""
    from backend.modules.guest import controller, service
    token,present = service.cookie_token(req.headers.get('Cookie',''),req.org['slug'])
    found = service.read_guest(req.db,token) if token else None
    if not found:
        if present:
            req.response_headers.update(controller.cookie_header(req,req.org['slug'],'',False,clear=True))
        return None
    if req.command!='GET' and not secrets.compare_digest(req.headers.get('X-Guest-CSRF','').encode(),found['device']['csrf'].encode()):
        req.guest_stale = found
        return None
    if service.touch(req.db,found) and found['device']['remember']:
        req.response_headers.update(controller.cookie_header(req,req.org['slug'],token,True))
    return found


def refuse_stale_guest(req):
    """403 for a guest cookie sent on a change without its X-Guest-CSRF (recorded as 'csrf_rejected')."""
    if req.guest_stale:
        from backend.modules.security import events
        events.from_request(req,'csrf_rejected',actor='guest',tenant_id=req.org['id'],
                            detail={'header':'X-Guest-CSRF','missing':not req.headers.get('X-Guest-CSRF')})
        require(False,'เซสชันไม่ถูกต้อง กรุณารีเฟรชหน้า',403)


def require_role(*roles, message='เฉพาะผู้ดูแลองค์กร'):
    """Controller decorator: only members with one of `roles` may call it."""
    def decorate(controller):
        @functools.wraps(controller)
        def guarded(req, *args):
            require(req.ctx['role'] in roles,message,403)
            return controller(req,*args)
        return guarded
    return decorate
