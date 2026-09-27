"""/api/achievements: ผลงานของฉัน, the member's own monthly summary and badges in the organization selected."""
from backend.modules.achievements import controller

ROUTES = [
    ('GET',  '/api/achievements',              controller.overview,    'workspace'),
    ('GET',  '/api/achievements/recap',        controller.month,       'workspace'),
    ('POST', '/api/achievements/recap/seen',   controller.recap_seen,  'workspace'),
    ('POST', '/api/achievements/badges/seen',  controller.badges_seen, 'workspace'),
]
