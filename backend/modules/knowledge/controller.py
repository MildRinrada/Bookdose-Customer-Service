"""HTTP handlers for knowledge articles."""
from backend.middleware.auth import require_role
from backend.modules.knowledge import service

MANAGERS_ONLY = 'เฉพาะผู้ดูแลหรือหัวหน้าทีมจัดการบทความได้'


def list_articles(req):
    return req.send(200,{'articles':service.list_articles(req.db)})


@require_role('admin','manager',message=MANAGERS_ONLY)
def create_article(req, article_id=None):
    return req.send(200,{'id':service.save_article(req.db,req.ctx,article_id,req.body,creating=True)})


@require_role('admin','manager',message=MANAGERS_ONLY)
def update_article(req, article_id=None):
    return req.send(200,{'id':service.save_article(req.db,req.ctx,article_id,req.body,creating=False)})


@require_role('admin','manager',message=MANAGERS_ONLY)
def delete_article(req, article_id=None):
    service.delete_article(req.db,req.ctx,article_id)
    return req.send(200,{'deleted':article_id})
