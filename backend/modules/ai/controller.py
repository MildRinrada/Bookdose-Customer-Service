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


def ask(req):
    """ผู้ช่วย AI: any member of the organization's team; not a platform admin looking in with support access."""
    from backend.modules.ai import assistant
    from backend.utils.validation import require
    require(not req.ctx.get('read_only'),'ผู้ช่วย AI ใช้ได้เฉพาะทีมงานขององค์กร',403)
    limited(('ai-ask',req.ctx['id']),30,3600)
    job_id,gathered = assistant.request(req.cd,req.db,req.ctx,req.body)
    return req.send(201,{'id':job_id,'status':'pending','gathered':gathered})


def stop_ask(req, job_id):
    """หยุดรอ: the member stops waiting for one of their questions."""
    from backend.modules.ai import assistant
    return req.send(200,assistant.stop(req.db,req.ctx,job_id))


def run_actions(req, job_id):
    """ทำเลย: what the assistant proposed in one answer, done with the member's own rights (ai/assistant_actions.py)."""
    from backend.modules.ai import assistant_actions
    limited(('ai-run',req.ctx['id']),30,3600)
    return req.send(200,assistant_actions.run(req.cd,req.db,req.ctx,job_id,req.body))


def job(req, job_id):
    return req.send(200,service.job_view(req.db,req.ctx,job_id))
