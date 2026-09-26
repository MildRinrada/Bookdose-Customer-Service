"""HTTP handlers for automation: rules, macros, escalation/CSAT settings, running a macro, follow-ups, mentions
and the dashboard's own data."""
from backend.middleware.auth import require_role
from backend.modules.automation import schema, service

LEADS = ('admin','manager')
LEADS_ONLY = 'เฉพาะเจ้าขององค์กร'


@require_role(*LEADS,message=LEADS_ONLY)
def automation_page(req):
    return req.send(200,service.automation_page(req.cd,req.db,req.ctx))


@require_role('admin',message=LEADS_ONLY)
def save_distribution(req):
    return req.send(200,{'settings':service.save_distribution(req.cd,req.db,req.ctx,req.body)})


@require_role(*LEADS,message=LEADS_ONLY)
def create_rule(req):
    return req.send(201,{'id':service.save_rule(req.cd,req.db,req.ctx,None,req.body)})


@require_role(*LEADS,message=LEADS_ONLY)
def update_rule(req, rule_id):
    return req.send(200,{'id':service.save_rule(req.cd,req.db,req.ctx,rule_id,req.body)})


@require_role(*LEADS,message=LEADS_ONLY)
def delete_rule(req, rule_id):
    service.delete_rule(req.db,req.ctx,rule_id)
    return req.send(200,{'deleted':rule_id})


@require_role(*LEADS,message=LEADS_ONLY)
def create_macro(req):
    return req.send(201,{'id':service.save_macro(req.db,req.ctx,None,req.body)})


@require_role(*LEADS,message=LEADS_ONLY)
def update_macro(req, macro_id):
    return req.send(200,{'id':service.save_macro(req.db,req.ctx,macro_id,req.body)})


@require_role(*LEADS,message=LEADS_ONLY)
def delete_macro(req, macro_id):
    service.delete_macro(req.db,req.ctx,macro_id)
    return req.send(200,{'deleted':macro_id})


@require_role(*LEADS,message=LEADS_ONLY)
def save_settings(req):
    service.save_settings(req.db,req.ctx,req.body)
    return req.send(200,{'ok':True})


def run_macro(req, macro_id):
    return req.send(200,service.run_macro(req.cd,req.db,req.ctx,macro_id,req.body))


def add_followup(req, ticket_id):
    return req.send(201,{'id':service.add_followup(req.db,req.ctx,ticket_id,req.body)})


def finish_followup(req, followup_id):
    service.finish_followup(req.db,req.ctx,followup_id)
    return req.send(200,{'ok':True})


def read_mentions(req):
    service.read_mentions(req.db,req.ctx,req.body)
    return req.send(200,{'ok':True})


def alerts(req):
    return req.send(200,service.my_alerts(req.db,req.ctx))


def hide_setup(req):
    from backend.modules.automation import setup
    return req.send(200,setup.hide(req.cd,req.ctx,req.body))


def overview(req):
    return req.send(200,service.overview(req.cd,req.db,req.ctx,schema.tz_offset(req.query)))
