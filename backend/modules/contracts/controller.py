"""HTTP handlers for contracts / TOR and the project after them: the organization's team (req.ctx), the customer on
one organization's page (req.customer, req.org) and the platform team (req.session)."""
from backend.modules.contracts import project, service
from backend.modules.platform import repository as tenants


def _ip(req):
    return req.ip


def _agent(req):
    return req.headers.get('User-Agent','')[:200]


def _org(req):
    return tenants.tenant_summary(req.cd,req.ctx['tenant_id'])


def _ok(req, status=200):
    return req.send(status,{'ok':True})


# The organization's team
def list_contracts(req):
    return req.send(200,{'contracts':service.list_contracts(req.db,req.ctx)})


def create(req):
    return req.send(201,{'id':service.create(req.cd,req.db,req.ctx,_org(req),req.body)})


def detail(req, contract_id):
    return req.send(200,service.detail(req.db,req.ctx,contract_id))


def save(req, contract_id):
    service.save(req.db,req.ctx,contract_id,req.body)
    return _ok(req)


def send(req, contract_id):
    service.send(req.cd,req.db,req.ctx,_org(req),contract_id,_ip(req))
    return _ok(req)


def revise(req, contract_id):
    return req.send(201,{'version':service.revise(req.db,req.ctx,contract_id,req.body,_ip(req))})


def cancel(req, contract_id):
    service.cancel(req.db,req.ctx,contract_id,_ip(req))
    return _ok(req)


def add_files(req, contract_id):
    service.add_files(req.db,req.ctx,req.ctx['tenant_id'],contract_id,req.body)
    return _ok(req,201)


def remove_file(req, contract_id, file_id):
    service.remove_file(req.db,req.ctx,req.ctx['tenant_id'],contract_id,file_id)
    return _ok(req)


def download_file(req, contract_id, file_id):
    return req.send_download(*service.staff_file(req.db,req.ctx,req.ctx['tenant_id'],contract_id,file_id))


def org_otp(req, contract_id):
    return req.send(200,service.org_otp(req.cd,req.db,req.ctx,contract_id))


def org_sign(req, contract_id):
    return req.send(200,{'document_hash':service.org_sign(req.cd,req.db,req.ctx,_org(req),contract_id,req.body,_ip(req),_agent(req))})


def import_document(req):
    return req.send(200,{'body':service.import_document(req.ctx,req.body)})


def customers(req):
    return req.send(200,{'customers':service.customers_of(req.cd,req.db,req.ctx)})


def templates(req):
    return req.send(200,service.templates_for(req.cd,req.db,req.ctx))


def create_template(req):
    service._staff(req.ctx)
    return req.send(201,{'id':service.save_template(req.db,req.ctx['name'],None,req.body)})


def update_template(req, template_id):
    service._staff(req.ctx)
    service.save_template(req.db,req.ctx['name'],template_id,req.body)
    return _ok(req)


def delete_template(req, template_id):
    service._staff(req.ctx)
    service.delete_template(req.db,req.ctx['name'],template_id)
    return _ok(req)


# The team's side of the project
def start_milestone(req, contract_id, milestone_id):
    project.start(req.db,req.ctx,contract_id,milestone_id,_ip(req))
    return _ok(req)


def milestone_progress(req, contract_id, milestone_id):
    project.set_progress(req.db,req.ctx,contract_id,milestone_id,req.body)
    return _ok(req)


def deliver(req, contract_id, milestone_id):
    return req.send(201,{'id':project.deliver(req.cd,req.db,req.ctx,_org(req),contract_id,milestone_id,req.body,_ip(req))})


def issue_invoice(req, contract_id, milestone_id):
    return req.send(201,{'id':project.issue_invoice(req.cd,req.db,req.ctx,_org(req),contract_id,milestone_id)})


def staff_invoice(req, contract_id, invoice_id):
    return req.send(200,project.staff_invoice(req.db,req.ctx,contract_id,invoice_id))


def confirm_payment(req, contract_id, invoice_id):
    return req.send(200,{'receipt':project.confirm_payment(req.cd,req.db,req.ctx,_org(req),contract_id,invoice_id,_ip(req))})


def reject_slip(req, contract_id, invoice_id):
    project.reject_slip(req.db,req.ctx,contract_id,invoice_id,req.body,_ip(req))
    return _ok(req)


def void_invoice(req, contract_id, invoice_id):
    project.void_invoice(req.db,req.ctx,contract_id,invoice_id,req.body,_ip(req))
    return _ok(req)


def billing_settings(req):
    service._staff(req.ctx)
    return req.send(200,{'settings':project.billing_settings(req.db),'can_edit':req.ctx['role']=='admin'})


def save_billing_settings(req):
    project.save_billing_settings(req.db,req.ctx,req.body)
    return _ok(req)


# The customer
def customer_view(req, contract_id):
    return req.send(200,service.customer_view(req.db,req.customer,contract_id,_ip(req)))


def customer_otp(req, contract_id):
    return req.send(200,service.customer_otp(req.cd,req.db,req.customer,contract_id))


def customer_sign(req, contract_id):
    service.customer_sign(req.cd,req.db,req.customer,contract_id,req.body,_ip(req),_agent(req))
    return _ok(req)


def ask(req, contract_id):
    return req.send(201,{'conversation_id':service.ask(req.cd,req.db,req.org,req.customer,contract_id,req.body)})


def request_changes(req, contract_id):
    return req.send(201,{'conversation_id':service.request_changes(req.cd,req.db,req.org,req.customer,contract_id,req.body,_ip(req))})


def customer_file(req, contract_id, file_id):
    return req.send_download(*service.customer_file(req.db,req.customer,req.org['id'],contract_id,file_id))


def accept_delivery(req, contract_id, milestone_id):
    return req.send(200,{'invoice_id':project.accept(req.db,req.org,req.customer,contract_id,milestone_id,req.body,_ip(req))})


def reject_delivery(req, contract_id, milestone_id):
    return req.send(200,{'conversation_id':project.reject(req.cd,req.db,req.org,req.customer,contract_id,milestone_id,req.body,_ip(req))})


def customer_invoice(req, contract_id, invoice_id):
    return req.send(200,project.customer_invoice(req.db,req.customer,contract_id,invoice_id))


def customer_invoice_by_id(req, invoice_id):
    return req.send(200,project.customer_invoice_by_id(req.db,req.customer,invoice_id))


def upload_slip(req, contract_id, invoice_id):
    project.upload_slip(req.db,req.customer,req.org['id'],contract_id,invoice_id,req.body,_ip(req))
    return _ok(req,201)


def save_buyer(req, contract_id):
    project.save_buyer(req.db,req.customer,contract_id,req.body)
    return _ok(req)


def open_issue(req, contract_id):
    return req.send(201,project.open_issue(req.cd,req.db,req.org,req.customer,contract_id,req.body,_ip(req)))


def request_renewal(req, contract_id):
    return req.send(201,{'conversation_id':project.request_renewal(req.cd,req.db,req.org,req.customer,contract_id,req.body,_ip(req))})


# The platform team
def platform_templates(req):
    from backend.modules.contracts import repository
    return req.send(200,{'templates':repository.templates(req.cd),'placeholders':list(service.PLACEHOLDERS)})


def create_platform_template(req):
    return req.send(201,{'id':service.save_template(req.cd,req.session['name'],None,req.body)})


def update_platform_template(req, template_id):
    service.save_template(req.cd,req.session['name'],template_id,req.body)
    return _ok(req)


def delete_platform_template(req, template_id):
    service.delete_template(req.cd,req.session['name'],template_id)
    return _ok(req)


def verify(req):
    return req.send(200,service.verify_hash(req.cd,req.body))
