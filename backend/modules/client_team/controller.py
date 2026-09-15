"""HTTP handlers for the client team on one organization's page (/api/public/<code>/team, and the approval flows of its
contracts): req.org, req.db and the signed-in customer req.customer. /api/customer/approvals is the account's
(req.cd and req.customer only)."""
from backend.middleware.rate_limit import limited
from backend.modules.client_team import approvals, service


def _ok(req):
    return req.send(200,{'ok':True})


def team(req):
    return req.send(200,service.team_view(req.cd,req.db,req.customer))


def invite(req):
    # Every invitation may send an email.
    limited(('customer-invite',req.ip),20,900)
    return req.send(201,{'id':service.invite(req.cd,req.db,req.org,req.customer,req.body)})


def update(req, member_id):
    service.update(req.db,req.customer,member_id,req.body)
    return _ok(req)


def remove(req, member_id):
    service.remove(req.cd,req.db,req.org,req.customer,member_id)
    return _ok(req)


def accept(req, member_id):
    service.accept(req.cd,req.db,req.org,req.customer,member_id)
    return _ok(req)


def decline(req, member_id):
    service.decline(req.cd,req.db,req.org,req.customer,member_id)
    return _ok(req)


# Approval flows
def flows(req):
    return req.send(200,approvals.flows_view(req.cd,req.db,req.customer))


def save_flows(req):
    approvals.save_flows(req.cd,req.db,req.customer,req.body)
    return _ok(req)


def project_flow(req, contract_id):
    return req.send(200,approvals.project_flow(req.cd,req.db,req.customer,contract_id))


def save_project_flow(req, contract_id):
    approvals.save_project_flow(req.cd,req.db,req.customer,contract_id,req.body)
    return _ok(req)


def review_contract(req, contract_id):
    return req.send(200,{'conversation_id':approvals.review_contract(req.cd,req.db,req.org,req.customer,contract_id,req.body,req.ip)})


def review_delivery(req, contract_id, milestone_id):
    return req.send(200,{'conversation_id':approvals.review_delivery(req.cd,req.db,req.org,req.customer,contract_id,milestone_id,req.body,req.ip)})


def waiting(req):
    return req.send(200,approvals.across(req.cd,req.customer))
