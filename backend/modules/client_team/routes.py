"""/api/public/<code>/team: the customer's own team with one organization, and the invitations sent to them; the
approval flows (the owner's defaults, one project's override) and the reviewers' decisions on a contract version or a
delivery round ('customer': the customer's session cookie, and X-Customer-CSRF on a changing request).
/api/customer/approvals: what waits for the customer's review or decision in every organization ('customer-account')."""
from backend.modules.client_team import controller
from backend.utils.routing import ID

TEAM = '/api/public/[a-z0-9-]+/team'
CONTRACT = '/api/public/[a-z0-9-]+/contracts/'+ID

ROUTES = [
    ('GET',    TEAM,                   controller.team,    'customer'),
    ('POST',   TEAM,                   controller.invite,  'customer'),
    ('GET',    TEAM+'/flows',          controller.flows,      'customer'),
    ('POST',   TEAM+'/flows',          controller.save_flows, 'customer'),
    ('PATCH',  TEAM+f'/{ID}',          controller.update,  'customer'),
    ('DELETE', TEAM+f'/{ID}',          controller.remove,  'customer'),
    ('POST',   TEAM+f'/{ID}/accept',   controller.accept,  'customer'),
    ('POST',   TEAM+f'/{ID}/decline',  controller.decline, 'customer'),
    ('GET',    CONTRACT+'/flow',       controller.project_flow,      'customer'),
    ('POST',   CONTRACT+'/flow',       controller.save_project_flow, 'customer'),
    ('POST',   CONTRACT+'/review',     controller.review_contract,   'customer'),
    ('POST',   CONTRACT+f'/milestones/{ID}/review', controller.review_delivery, 'customer'),
    ('GET',    '/api/customer/approvals', controller.waiting, 'customer-account'),
]
