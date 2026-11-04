"""HTTP handlers for knowledge articles."""
from backend.middleware.auth import require_role
from backend.middleware.rate_limit import limited
from backend.modules.knowledge import importer, service

MANAGERS_ONLY = 'เฉพาะหัวหน้าทีมจัดการบทความได้'


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


def set_pins(req):
    limited(('article-mark',req.ctx['id']),300,3600)
    return req.send(200,service.set_pins(req.db,req.ctx,req.body))


def revisions(req, article_id):
    return req.send(200,service.revisions(req.db,article_id))


def article_templates(req):
    """คลังบทความแม่แบบ: what the platform team has written that this organization may take a copy of."""
    return req.send(200,service.templates(req.cd,req.db))


@require_role('admin','manager',message=MANAGERS_ONLY)
def use_template(req, template_id):
    return req.send(201,service.use_template(req.cd,req.db,req.ctx,template_id,req.body))


# นำเข้าบทความ: like writing an article, the หัวหน้าทีม's (knowledge/importer.py).

@require_role('admin','manager',message=MANAGERS_ONLY)
def list_imports(req):
    return req.send(200,importer.open_imports(req.db))


@require_role('admin','manager',message=MANAGERS_ONLY)
def start_import(req):
    limited(('article-import',req.ctx['id']),30,3600)
    return req.send(201,importer.start(req.db,req.ctx,req.body))


@require_role('admin','manager',message=MANAGERS_ONLY)
def get_import(req, import_id):
    return req.send(200,importer.get(req.db,req.ctx,import_id))


@require_role('admin','manager',message=MANAGERS_ONLY)
def discard_import(req, import_id):
    return req.send(200,importer.discard(req.db,req.ctx,import_id))


@require_role('admin','manager',message=MANAGERS_ONLY)
def skip_import_ai(req, import_id):
    return req.send(200,importer.skip_ai(req.db,req.ctx,import_id))


@require_role('admin','manager',message=MANAGERS_ONLY)
def save_import(req, import_id):
    return req.send(200,importer.save(req.db,req.ctx,import_id,req.body))


@require_role('admin','manager',message=MANAGERS_ONLY)
def set_import_draft(req, import_id, draft_id):
    return req.send(200,importer.set_draft(req.db,req.ctx,import_id,draft_id,req.body))


@require_role('admin','manager',message=MANAGERS_ONLY)
def rewrite_import_draft(req, import_id, draft_id):
    limited(('article-rewrite',req.ctx['id']),120,3600)
    return req.send(200,importer.rewrite(req.db,req.ctx,import_id,draft_id))
