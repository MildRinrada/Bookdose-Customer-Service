"""Project Drive: /api/contracts/<id>/drive for the organization's team ('workspace') and
/api/public/<code>/contracts/<id>/drive for the customer ('customer'). Registered in backend/server.py."""
from backend.modules.drive import controller
from backend.utils.routing import ID

STAFF = f'/api/contracts/{ID}/drive'
PUBLIC = '/api/public/[a-z0-9-]+/contracts/'+ID+'/drive'

ROUTES = [
    ('GET',    STAFF,                    controller.staff_drive,           'workspace'),
    ('POST',   STAFF+'/folders',         controller.staff_folder,          'workspace'),
    ('POST',   STAFF+'/files',           controller.staff_upload,          'workspace'),
    ('GET',    STAFF+f'/versions/{ID}',  controller.staff_download,        'workspace'),
    ('DELETE', STAFF+f'/files/{ID}',     controller.staff_delete_file,     'workspace'),
    ('DELETE', STAFF+f'/folders/{ID}',   controller.staff_delete_folder,   'workspace'),
    ('GET',    PUBLIC,                   controller.customer_drive,        'customer'),
    ('POST',   PUBLIC+'/folders',        controller.customer_folder,       'customer'),
    ('POST',   PUBLIC+'/files',          controller.customer_upload,       'customer'),
    ('GET',    PUBLIC+f'/versions/{ID}', controller.customer_download,     'customer'),
    ('DELETE', PUBLIC+f'/files/{ID}',    controller.customer_delete_file,  'customer'),
    ('DELETE', PUBLIC+f'/folders/{ID}',  controller.customer_delete_folder,'customer'),
]
