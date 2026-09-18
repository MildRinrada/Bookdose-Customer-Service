"""HTTP handlers for knowledge articles."""
from backend.middleware.auth import require_role
from backend.middleware.rate_limit import limited
from backend.modules.knowledge import service

MANAGERS_ONLY = 'เฉพาะเจ้าขององค์กรจัดการบทความได้'


def list_articles(req):
    return req.send(200,{'articles':service.list_articles(req.db,req.ctx)})


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


# Every member: using, marking and pinning articles, and reading their earlier versions.

def record_use(req, article_id):
    limited(('article-use',req.ctx['id']),300,3600)
    return req.send(200,service.record_use(req.db,req.ctx,article_id,req.body))


def vote(req, article_id):
    limited(('article-mark',req.ctx['id']),300,3600)
    return req.send(200,service.vote(req.db,req.ctx,article_id,req.body))


def set_pins(req):
    limited(('article-mark',req.ctx['id']),300,3600)
    return req.send(200,service.set_pins(req.db,req.ctx,req.body))


def revisions(req, article_id):
    return req.send(200,service.revisions(req.db,article_id))
