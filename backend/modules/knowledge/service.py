"""Knowledge base rules: creating and updating articles."""
from backend.database import audit
from backend.modules.knowledge import repository, schema
from backend.modules.trash import service as trash
from backend.utils.security import uid
from backend.utils.validation import require


def list_articles(db):
    return repository.list_all(db)


def save_article(db, ctx, article_id, body, creating):
    """Create (no id in the URL) or update (id in the URL) an article; returns its id."""
    visibility = schema.visibility(body)
    if creating:
        require(not article_id,'เส้นทางไม่ถูกต้อง',404)
        article_id = uid()
    else:
        require(article_id and repository.exists(db,article_id),'ไม่พบบทความ',404)
    title,category,text = schema.article_fields(body)
    save = repository.insert if creating else repository.update
    save(db,article_id,title,category,text,visibility,ctx['name'])
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
