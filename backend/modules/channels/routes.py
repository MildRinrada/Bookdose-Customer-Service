from backend.modules.channels import controller
from backend.modules.channels.email_oauth import CALLBACK
from backend.utils.routing import ID

ROUTES = [
    ('GET',   CALLBACK,                                           controller.oauth_callback_page,  'page'),
    ('GET',   r'/api/channel-files/([a-f0-9]{32})/([A-Za-z0-9_-]{43})', controller.download_file_link, 'page'),
    ('GET',   f'/api/webhooks/facebook/{ID}',                     controller.verify_facebook_webhook, 'page'),
    ('POST',  f'/api/webhooks/line/{ID}',                         controller.receive_line_webhook, 'webhook'),
    ('POST',  f'/api/webhooks/facebook/{ID}',                     controller.receive_facebook_webhook, 'webhook'),
    ('GET',   '/api/channels/facebook',                           controller.facebook_overview,    'workspace'),
    ('PATCH', '/api/channels/facebook',                           controller.save_facebook,        'workspace'),
    ('POST',  '/api/channels/facebook/test',                      controller.test_facebook,        'workspace'),
    ('POST',  '/api/channels/email/oauth/start',                  controller.start_email_oauth,    'workspace'),
    ('POST',  '/api/channels/email/oauth/complete',               controller.complete_email_oauth, 'workspace'),
    ('GET',   '/api/channels',                                    controller.overview,             'workspace'),
    ('PATCH', '/api/channels/(line|email)',                       controller.save_channel,         'workspace'),
    ('POST',  '/api/channels/(line|email)/test',                  controller.test_channel,         'workspace'),
    ('POST',  '/api/channels/email/sync',                         controller.sync_email,           'workspace'),
    ('POST',  f'/api/messages/{ID}/retry',                        controller.retry_delivery,       'workspace'),
    ('POST',  f'/api/messages/{ID}/revoke-files',                 controller.revoke_files,         'workspace'),
]
