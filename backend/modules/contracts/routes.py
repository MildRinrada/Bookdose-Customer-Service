"""Contracts / TOR and the project after them: the organization's team (/api/contracts, 'workspace'), the customer on
one organization's page (/api/public/<code>/contracts and /invoices, 'customer') and the platform team
(/api/platform/contract-templates, 'platform')."""
from backend.modules.contracts import controller
from backend.utils.routing import ID

CONTRACT = f'/api/contracts/{ID}'
PUBLIC = '/api/public/[a-z0-9-]+/contracts/'+ID
MILESTONE = f'/milestones/{ID}'
INVOICE = f'/invoices/{ID}'

ROUTES = [
    ('GET',    '/api/contracts',                  controller.list_contracts,  'workspace'),
    ('POST',   '/api/contracts',                  controller.create,          'workspace'),
    ('POST',   '/api/contracts/import',           controller.import_document, 'workspace'),
    ('GET',    '/api/contract-customers',         controller.customers,       'workspace'),
    ('GET',    '/api/contract-templates',         controller.templates,       'workspace'),
    ('POST',   '/api/contract-templates',         controller.create_template, 'workspace'),
    ('PATCH',  f'/api/contract-templates/{ID}',   controller.update_template, 'workspace'),
    ('DELETE', f'/api/contract-templates/{ID}',   controller.delete_template, 'workspace'),
    ('GET',    '/api/contract-billing',           controller.billing_settings,      'workspace'),
    ('POST',   '/api/contract-billing',           controller.save_billing_settings, 'workspace'),
    ('GET',    CONTRACT,                          controller.detail,          'workspace'),
    ('PATCH',  CONTRACT,                          controller.save,            'workspace'),
    ('POST',   CONTRACT+'/send',                  controller.send,            'workspace'),
    ('POST',   CONTRACT+'/revise',                controller.revise,          'workspace'),
    ('POST',   CONTRACT+'/cancel',                controller.cancel,          'workspace'),
    ('POST',   CONTRACT+'/files',                 controller.add_files,       'workspace'),
    ('DELETE', CONTRACT+f'/files/{ID}',           controller.remove_file,     'workspace'),
    ('GET',    CONTRACT+f'/files/{ID}',           controller.download_file,   'workspace'),
    ('POST',   CONTRACT+'/otp',                   controller.org_otp,         'workspace'),
    ('POST',   CONTRACT+'/sign',                  controller.org_sign,        'workspace'),
    ('POST',   CONTRACT+MILESTONE+'/start',       controller.start_milestone,    'workspace'),
    ('POST',   CONTRACT+MILESTONE+'/progress',    controller.milestone_progress, 'workspace'),
    ('POST',   CONTRACT+MILESTONE+'/deliver',     controller.deliver,            'workspace'),
    ('POST',   CONTRACT+MILESTONE+'/invoice',     controller.issue_invoice,      'workspace'),
    ('GET',    CONTRACT+INVOICE,                  controller.staff_invoice,      'workspace'),
    ('POST',   CONTRACT+INVOICE+'/confirm',       controller.confirm_payment,    'workspace'),
    ('POST',   CONTRACT+INVOICE+'/reject',        controller.reject_slip,        'workspace'),
    ('POST',   CONTRACT+INVOICE+'/void',          controller.void_invoice,       'workspace'),
    ('GET',    PUBLIC,                            controller.customer_view,   'customer'),
    ('POST',   PUBLIC+'/otp',                     controller.customer_otp,    'customer'),
    ('POST',   PUBLIC+'/sign',                    controller.customer_sign,   'customer'),
    ('POST',   PUBLIC+'/ask',                     controller.ask,             'customer'),
    ('POST',   PUBLIC+'/changes',                 controller.request_changes, 'customer'),
    ('GET',    PUBLIC+f'/files/{ID}',             controller.customer_file,   'customer'),
    ('POST',   PUBLIC+MILESTONE+'/accept',        controller.accept_delivery, 'customer'),
    ('POST',   PUBLIC+MILESTONE+'/reject',        controller.reject_delivery, 'customer'),
    ('GET',    PUBLIC+INVOICE,                    controller.customer_invoice,'customer'),
    ('POST',   PUBLIC+INVOICE+'/slip',            controller.upload_slip,     'customer'),
    ('POST',   PUBLIC+'/buyer',                   controller.save_buyer,      'customer'),
    ('POST',   PUBLIC+'/issues',                  controller.open_issue,      'customer'),
    ('POST',   PUBLIC+'/renewal',                 controller.request_renewal, 'customer'),
    ('GET',    '/api/public/[a-z0-9-]+'+INVOICE,  controller.customer_invoice_by_id, 'customer'),
    ('GET',    '/api/platform/contract-templates',       controller.platform_templates,       'platform'),
    ('POST',   '/api/platform/contract-templates',       controller.create_platform_template, 'platform'),
    ('PATCH',  f'/api/platform/contract-templates/{ID}', controller.update_platform_template, 'platform'),
    ('DELETE', f'/api/platform/contract-templates/{ID}', controller.delete_platform_template, 'platform'),
    ('POST',   '/api/platform/contracts/verify',         controller.verify,                   'platform'),
]
