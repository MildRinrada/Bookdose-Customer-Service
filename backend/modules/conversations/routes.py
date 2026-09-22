from backend.modules.conversations import controller
from backend.utils.routing import ID

CONVERSATION = f'/api/conversations/{ID}'

ROUTES = [
    ('GET',   '/api/conversations',        controller.list_conversations,  'workspace'),
    ('GET',   CONVERSATION,                controller.show_conversation,   'workspace'),
    ('PATCH', CONVERSATION,                controller.update_status,       'workspace'),
    ('POST',  CONVERSATION+'/messages',    controller.post_message,        'workspace'),
    # Correcting or taking back a message sent to the wrong place.
    ('PATCH', CONVERSATION+f'/messages/{ID}', controller.edit_message,    'workspace'),
    ('DELETE',CONVERSATION+f'/messages/{ID}', controller.delete_message,  'workspace'),
    ('POST',  CONVERSATION+'/ticket',      controller.link_ticket,         'workspace'),
    ('POST',  CONVERSATION+'/ai-draft',    controller.request_ai_draft,    'workspace'),
    ('POST',  CONVERSATION+'/ai-mode',     controller.set_ai_mode,         'workspace'),
    ('GET',   f'/api/attachments/{ID}',    controller.download_attachment, 'workspace'),
]
