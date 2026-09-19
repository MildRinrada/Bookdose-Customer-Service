"""HTTP handler for the parts of the service report that the case list cannot tell (reports/service.py)."""
from backend.modules.reports import service


def extras(req):
    """Every member: the period's busy hours (an agent's own team). Leads also get the chatbot and the articles; the
    organization's owner also the questions no article answers."""
    return req.send(200,service.extras(req.db,req.ctx,req.query))
