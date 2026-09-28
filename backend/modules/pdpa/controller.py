"""/api/platform/pdpa: the PDPA tool of the platform console (service.py). Platform admins only; exporting and erasing
need the password proven within the last minutes (security/admin_guard.py)."""
from backend.middleware.rate_limit import limited
from backend.modules.pdpa import service
from backend.modules.security.admin_guard import confirm_first


def overview(req):
    return req.send(200,service.overview(req.cd))


def search(req):
    limited(('pdpa-search',req.session['user_id']),120,3600)
    return req.send(200,service.search(req.cd,req.body))


@confirm_first
def export(req):
    limited(('pdpa-export',req.session['user_id']),30,3600)
    content,name = service.export(req.cd,req.session,req.body)
    return req.send(200,content,'application/zip',{'Content-Disposition':f'attachment; filename="{name}"'})


@confirm_first
def erase(req):
    limited(('pdpa-erase',req.session['user_id']),20,3600)
    return req.send(200,service.erase(req.cd,req.session,req.body))
