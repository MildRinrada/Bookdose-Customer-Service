"""HTTP handlers for the Project Drive: the organization's team (req.ctx) and the customer on one organization's page
(req.customer, req.org). Both sides share the service; only who is acting differs."""
from backend.modules.drive import service
from backend.modules.platform import repository as tenants


def _ok(req):
    return req.send(200,{'ok':True})


# The organization's team
def _staff(req, contract_id):
    return service.staff(req.db,req.ctx,contract_id)


def staff_drive(req, contract_id):
    return req.send(200,service.view(req.db,*_staff(req,contract_id)))


def staff_folder(req, contract_id):
    return req.send(201,{'id':service.create_folder(req.db,*_staff(req,contract_id),req.body)})


def staff_upload(req, contract_id):
    contract,who = _staff(req,contract_id)
    org = tenants.tenant_summary(req.cd,req.ctx['tenant_id'])
    return req.send(201,service.upload(req.cd,req.db,org,contract,who,req.ctx['tenant_id'],req.body,req.ip))


def staff_download(req, contract_id, version_id):
    contract,_ = _staff(req,contract_id)
    return req.send_download(*service.download(req.db,contract,req.ctx['tenant_id'],version_id))


def staff_delete_file(req, contract_id, file_id):
    service.delete_file(req.db,*_staff(req,contract_id),file_id,req.ip)
    return _ok(req)


def staff_delete_folder(req, contract_id, folder_id):
    service.delete_folder(req.db,*_staff(req,contract_id),folder_id)
    return _ok(req)


# The customer
def _customer(req, contract_id):
    return service.customer(req.db,req.customer,req.org['slug'],contract_id)


def customer_drive(req, contract_id):
    return req.send(200,service.view(req.db,*_customer(req,contract_id)))


def customer_folder(req, contract_id):
    return req.send(201,{'id':service.create_folder(req.db,*_customer(req,contract_id),req.body)})


def customer_upload(req, contract_id):
    contract,who = _customer(req,contract_id)
    return req.send(201,service.upload(req.cd,req.db,req.org,contract,who,req.org['id'],req.body,req.ip))


def customer_download(req, contract_id, version_id):
    contract,_ = _customer(req,contract_id)
    return req.send_download(*service.download(req.db,contract,req.org['id'],version_id))


def customer_delete_file(req, contract_id, file_id):
    service.delete_file(req.db,*_customer(req,contract_id),file_id,req.ip)
    return _ok(req)


def customer_delete_folder(req, contract_id, folder_id):
    service.delete_folder(req.db,*_customer(req,contract_id),folder_id)
    return _ok(req)
