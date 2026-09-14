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


def job(req, job_id):
    return req.send(200,service.job_view(req.db,req.ctx,job_id))
