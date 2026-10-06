"""/api/legal/<key> for anyone; /api/platform/legal for the console (service.py)."""
from backend.database import db as D
from backend.middleware.auth import require_role
from backend.modules.legal import service


def show(req, key):
    """The published document, for a page or a window. No sign-in: a visitor reads the terms before signing up."""
    with D.control() as cd:
        return req.send(200,service.public(cd,key))


def overview(req):
    return req.send(200,service.overview(req.cd))


def version(req, key, version):
    return req.send(200,service.version_text(req.cd,key,version))


def save_draft(req, key):
    return req.send(200,service.save_draft(req.cd,key,req.session['name'],req.body))


def publish(req, key):
    return req.send(200,service.publish(req.cd,key,req.session['name']))


@require_role('admin')
def organization(req):
    """ตั้งค่าองค์กร → ข้อตกลงและเอกสาร, and the bar asking the organization's admin to agree to a new version."""
    return req.send(200,service.organization_terms(req.cd,req.ctx['tenant_id']))


@require_role('admin')
def accept_for_organization(req):
    return req.send(200,service.accept_for_organization(req.cd,req.ctx['tenant_id'],req.session,req.ip))


def account(req):
    """ตั้งค่าบัญชี: the privacy notice this staff account acknowledged."""
    return req.send(200,service.member_privacy(req.cd,req.session['email']))


def company(req):
    return req.send(200,{'company':service.company(req.cd)})


def save_company(req):
    return req.send(200,{'company':service.save_company(req.cd,req.session['name'],req.body)})


def acceptances(req, key):
    return req.send(200,service.acceptances(req.cd,key))


def acknowledge_account(req):
    """A staff account acknowledges the privacy notice in force (the bar that asks, after a new version)."""
    return req.send(200,service.acknowledge_member(req.cd,req.session,req.ip))


def acknowledge_customer(req):
    """A customer agrees to the customer privacy notice in force (the bar that asks, after a new version)."""
    return req.send(200,service.acknowledge_customer(req.cd,req.customer['account_id'],req.customer['email'],req.ip))
