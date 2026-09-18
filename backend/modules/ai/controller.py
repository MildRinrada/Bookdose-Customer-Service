"""HTTP handlers for AI settings, the connection test and job status."""
from backend.middleware.auth import require_role
from backend.middleware.rate_limit import limited
from backend.modules.ai import service

ADMINS_ONLY = 'เฉพาะผู้ดูแลองค์กรจัดการ AI ได้'


@require_role('admin',message=ADMINS_ONLY)
def settings(req):
    return req.send(200,service.overview(req.db,req.ctx['tenant_id']))


@require_role('admin',message=ADMINS_ONLY)
def save_settings(req):
    return req.send(200,service.save_settings(req.db,req.ctx,req.body))


@require_role('admin')
def test_connection(req):
    limited(('ai-test',req.ctx['tenant_id']),3,60)
    return req.send(201,{'id':service.queue_connection_test(req.db,req.ctx),'status':'pending'})


OWNERS_ONLY = 'เฉพาะเจ้าขององค์กร'


@require_role('admin',message=OWNERS_ONLY)
def draft_article(req):
    """The overview's "ให้ AI ร่างบทความ" for one group of unanswered questions (ai/insights.py)."""
    from backend.modules.ai import insights
    limited(('ai-owner',req.ctx['id']),10,3600)
    return req.send(201,{'id':insights.request_article(req.db,req.ctx,req.body),'status':'pending'})


@require_role('admin',message=OWNERS_ONLY)
def brief(req):
    """The overview's "สรุปสถานการณ์วันนี้": made only when the owner asks (it costs a request to the provider)."""
    from backend.modules.ai import insights
    from backend.modules.automation import schema as automation_schema, service as automation
    limited(('ai-owner',req.ctx['id']),10,3600)
    day = automation._local_day_start(automation_schema.tz_offset(req.query))
    return req.send(201,{'id':insights.request_brief(req.db,req.ctx,day),'status':'pending'})


def job(req, job_id):
    return req.send(200,service.job_view(req.db,req.ctx,job_id))
