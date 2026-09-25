from backend.modules.reports import controller

ROUTES = [
    ('GET', '/api/reports/extras', controller.extras, 'workspace'),
    ('GET', '/api/reports/dataset', controller.dataset, 'workspace'),
]
