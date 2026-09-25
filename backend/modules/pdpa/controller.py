"""/api/platform/pdpa: the PDPA tool of the platform console (service.py). Platform admins only."""
from backend.middleware.rate_limit import limited
from backend.modules.pdpa import service


def overview(req):
    return req.send(200,service.overview(req.cd))


def search(req):
    limited(('pdpa-search',req.session['user_id']),120,3600)
    return req.send(200,service.search(req.cd,req.body))


def export(req):
    limited(('pdpa-export',req.session['user_id']),30,3600)
    content,name = service.export(req.cd,req.session,req.body)
    return req.send(200,content,'application/zip',{'Content-Disposition':f'attachment; filename="{name}"'})


def erase(req):
    limited(('pdpa-erase',req.session['user_id']),20,3600)
    return req.send(200,service.erase(req.cd,req.session,req.body))
