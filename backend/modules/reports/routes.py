from backend.modules.reports import controller

ROUTES = [
    ('GET', '/api/reports/extras', controller.extras, 'workspace'),
    ('GET', '/api/reports/dataset', controller.dataset, 'workspace'),
    ('GET', '/api/reports/staffing', controller.staffing, 'workspace'),
    ('POST', '/api/reports/goals', controller.save_goals, 'workspace'),
]
