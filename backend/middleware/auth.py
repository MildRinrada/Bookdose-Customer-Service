"""Authentication and role checks: who is calling, and whether their role may use an endpoint."""
import functools
import secrets

from backend.utils.validation import require


def signed_in_session(req, optional=False):
    """The staff session from the cookie; 401 unless optional."""
    from backend.modules.auth.service import read_session
    return read_session(req.cd,req.headers.get('Cookie',''),optional)


def check_csrf(req):
    """Every change must carry the CSRF token of the session."""
    if req.command!='GET':
        require(secrets.compare_digest(req.headers.get('X-CSRF-Token',''),req.session['csrf']),'เซสชันไม่ถูกต้อง กรุณารีเฟรชหน้า',403)


def require_platform_admin(req):
    require(req.session['platform_admin'],'เฉพาะผู้ดูแลแพลตฟอร์ม',403)


def select_workspace(req):
    """The signed-in member's context in the session's organization."""
    from backend.modules.auth.service import workspace_context
    ctx = workspace_context(req.cd,req.session)
    # A tab must declare its selected tenant, preventing writes after another tab switches the session.
    require(req.headers.get('X-Tenant-ID')==ctx['tenant_id'],'องค์กรที่เลือกเปลี่ยนไป กรุณารีเฟรชหน้า',409)
    return ctx


def portal_visitor(req):
    """The support-page conversation identified by the visitor's X-Portal-Token."""
    from backend.modules.portal.service import conversation_for_token
    return conversation_for_token(req.db,req.headers.get('X-Portal-Token',''))


def require_role(*roles, message='เฉพาะผู้ดูแลองค์กร'):
    """Controller decorator: only members with one of `roles` may call it."""
    def decorate(controller):
        @functools.wraps(controller)
        def guarded(req, *args):
            require(req.ctx['role'] in roles,message,403)
            return controller(req,*args)
        return guarded
    return decorate
