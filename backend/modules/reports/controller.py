"""HTTP handler for the parts of the service report that the case list cannot tell (reports/service.py)."""
from backend.middleware.auth import require_role
from backend.modules.reports import service


def extras(req):
    """Every member: the period's busy hours (an agent's own team). Leads also get the chatbot and the articles; the
    organization's owner also the questions no article answers."""
    return req.send(200,service.extras(req.db,req.ctx,req.query))


@require_role('admin')
def save_goals(req):
    """The organization's owners: เป้าหมายของทีม for the report (reports/goals.py)."""
    from backend.modules.reports import goals
    return req.send(200,goals.save(req.db,req.ctx,req.body))


def staffing(req):
    """The organization's owners: who is expected to work on each of the coming days (reports/staffing.py)."""
    from backend.modules.reports import staffing as plan
    return req.send(200,plan.overview(req.cd,req.db,req.ctx))


def dataset(req):
    """Leads: the period as tidy CSV tables in one ZIP, for analysis elsewhere (reports/dataset.py)."""
    from backend.modules.reports import dataset as tables
    content,name = tables.build(req.cd,req.db,req.ctx,req.query)
    return req.send(200,content,'application/zip',{'Content-Disposition':f'attachment; filename="{name}"'})
