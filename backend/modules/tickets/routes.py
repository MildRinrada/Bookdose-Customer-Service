from backend.modules.tickets import controller
from backend.utils.routing import ID

ROUTES = [
    ('GET',   '/api/tickets',            controller.list_tickets,   'workspace'),
    ('POST',  '/api/tickets',            controller.create_ticket,  'workspace'),
    ('POST',  '/api/tickets/next',       controller.next_task,      'workspace'),
    ('GET',   f'/api/tickets/{ID}',      controller.show_ticket,    'workspace'),
    ('PATCH', f'/api/tickets/{ID}',      controller.update_ticket,  'workspace'),
    ('DELETE',f'/api/tickets/{ID}',      controller.delete_ticket,  'workspace'),
    ('POST',  f'/api/tickets/{ID}/snooze',controller.snooze_ticket, 'workspace'),
    ('DELETE',f'/api/tickets/{ID}/snooze',controller.wake_ticket,   'workspace'),
    ('POST',  f'/api/tickets/{ID}/tags', controller.tag_ticket,     'workspace'),
    ('GET',   '/api/export/tickets.csv', controller.export_tickets, 'workspace'),
]
