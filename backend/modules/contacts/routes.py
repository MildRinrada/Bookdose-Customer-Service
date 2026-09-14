from backend.modules.contacts import controller
from backend.utils.routing import ID

ROUTES = [
    ('GET',   '/api/contacts',       controller.list_contacts,  'workspace'),
    ('POST',  '/api/contacts',       controller.create_contact, 'workspace'),
    ('PATCH', f'/api/contacts/{ID}', controller.update_contact, 'workspace'),
    ('POST',  f'/api/contacts/{ID}/merge', controller.merge_contacts, 'workspace'),
    ('DELETE',f'/api/contacts/{ID}', controller.delete_contact, 'workspace'),
]
