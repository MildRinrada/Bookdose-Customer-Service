"""Knowledge base rules: creating and updating articles, how the team uses them, and their earlier versions."""
from backend.database import audit
from backend.database.db import begin
from backend.modules.knowledge import repository, schema
from backend.modules.knowledge.model import REVISIONS_KEPT, USE_REPEAT_MINUTES
from backend.modules.trash import service as trash
from backend.utils.dates import after
from backend.utils.security import uid
from backend.utils.validation import require

NO_ACTIVITY = {'uses':0,'used_at':None,'helpful':0,'unhelpful':0,'my_vote':0,'pin_order':0}


def list_articles(db, ctx):
    """Every article with how often the team used it, its helpful / not helpful marks, the member's own mark and pin,
    and how many earlier versions it has."""
    activity = repository.activity(db,ctx['id'])
    revisions = repository.revision_counts(db)
    articles = repository.list_all(db)
    for article in articles:
        article.update(activity.get(article['id'],NO_ACTIVITY))
        article['revisions'] = revisions.get(article['id'],0)
    return articles


def save_article(db, ctx, article_id, body, creating):
    """Create (no id in the URL) or update (id in the URL) an article; returns its id. An update that changes the
    article keeps the version before it (knowledge_revisions)."""
    visibility = schema.visibility(body)
    if creating:
        require(not article_id,'เส้นทางไม่ถูกต้อง',404)
        article_id = uid()
    else:
        require(article_id,'ไม่พบบทความ',404)
    title,category,text = schema.article_fields(body)
    if creating:
        repository.insert(db,article_id,title,category,text,visibility,ctx['name'])
    else:
        before = repository.find(db,article_id)
        require(before,'ไม่พบบทความ',404)
        if (before['title'],before['category'],before['body'],before['visibility'])!=(title,category,text,visibility):
            repository.keep_revision(db,before,ctx['name'],REVISIONS_KEPT)
        repository.update(db,article_id,title,category,text,visibility,ctx['name'])
    audit.record(db,ctx['name'],'article.saved',article_id)
    db.commit()
    # The overview's "คำถามที่ยังไม่มีบทความตอบ" is counted again with this article.
    from backend.modules.ai import insights
    insights.forget(ctx['tenant_id'])
    return article_id


def delete_article(db, ctx, article_id):
    """Remove an article from the knowledge base. Nothing else points at it, so the row simply moves to the
    recycle bin, where it can be put back until it is cleared."""
    article = repository.find(db,article_id)
    require(article,'ไม่พบบทความ',404)
    trash.capture(db,ctx,'article',article_id,article['title'],{'knowledge_articles':[article]},detail=article['category'])
    repository.delete(db,article_id)
    audit.record(db,ctx['name'],'article.deleted',article_id,article['title'])
    db.commit()


def _article(db, article_id):
    require(article_id and repository.exists(db,article_id),'ไม่พบบทความ',404)


def record_use(db, ctx, article_id, body):
    """The member copied the article, put it in a reply or sent its link. The same again within a few minutes is
    the same use."""
    kind = schema.use_kind(body)
    begin(db)
    _article(db,article_id)
    if not repository.used_recently(db,article_id,ctx['id'],kind,after(minutes=-USE_REPEAT_MINUTES)):
        repository.add_use(db,article_id,ctx['id'],kind)
    return _activity(db,ctx,article_id)


def vote(db, ctx, article_id, body):
    value = schema.vote(body)
    begin(db)
    _article(db,article_id)
    repository.set_vote(db,article_id,ctx['id'],value)
    return _activity(db,ctx,article_id)


def set_pins(db, ctx, body):
    """The member's pinned articles, in the order they arranged them."""
    ids = schema.pins(body)
    begin(db)
    require(repository.existing_ids(db,ids)==set(ids),'ไม่พบบทความบางรายการ อาจถูกลบไปแล้ว',404)
    repository.set_pins(db,ctx['id'],ids)
    return {'pins':ids}


def _activity(db, ctx, article_id):
    return {'id':article_id,**repository.activity(db,ctx['id']).get(article_id,NO_ACTIVITY)}


def revisions(db, article_id):
    _article(db,article_id)
    return {'revisions':repository.revisions(db,article_id)}
