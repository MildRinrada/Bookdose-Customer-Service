from backend.modules.invitations import controller
from backend.utils.routing import ID

INVITATIONS = '/api/invitations'

ROUTES = [
    # The invited colleague opens these signed out (the link is the proof).
    ('GET',    '/api/invitation',            controller.view,        'public'),
    ('POST',   '/api/invitation/accept',     controller.accept,      'public'),
    # The organization's admins.
    ('GET',    INVITATIONS,                  controller.invitations, 'workspace'),
    ('POST',   INVITATIONS,                  controller.invite,      'workspace'),
    ('POST',   INVITATIONS+f'/{ID}/resend',  controller.resend,      'workspace'),
    ('DELETE', INVITATIONS+f'/{ID}',         controller.cancel,      'workspace'),
]
