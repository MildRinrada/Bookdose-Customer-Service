"""Knowledge article queries."""
from backend.database.db import one, rows
from backend.utils.dates import now
from backend.utils.security import uid


def list_all(db):
    return rows(db,'SELECT * FROM knowledge_articles ORDER BY updated_at DESC')


def list_public(db):
    return rows(db,"SELECT id,title,category,body,updated_at FROM knowledge_articles WHERE visibility='public' ORDER BY updated_at DESC")


def exists(db, article_id):
    return bool(one(db,'SELECT id FROM knowledge_articles WHERE id=?',(article_id,)))


def find(db, article_id):
    return one(db,'SELECT * FROM knowledge_articles WHERE id=?',(article_id,))


def insert(db, article_id, title, category, body, visibility, author):
    db.execute('INSERT INTO knowledge_articles VALUES(?,?,?,?,?,?,?)',(article_id,title,category,body,visibility,author,now()))


def update(db, article_id, title, category, body, visibility, author):
    db.execute('UPDATE knowledge_articles SET title=?,category=?,body=?,visibility=?,author=?,updated_at=? WHERE id=?',(title,category,body,visibility,author,now(),article_id))


def delete(db, article_id):
    db.execute('DELETE FROM knowledge_articles WHERE id=?',(article_id,))


# How the team uses the articles (model.py: knowledge_uses, knowledge_marks).

def activity(db, user_id):
    """{article_id: {uses, used_at, helpful, unhelpful, my_vote, pin_order}} for the articles anyone used or marked."""
    found = {}
    def entry(article_id):
        return found.setdefault(article_id,{'uses':0,'used_at':None,'helpful':0,'unhelpful':0,'my_vote':0,'pin_order':0})
    for row in db.execute('SELECT article_id,COUNT(*),MAX(created_at) FROM knowledge_uses GROUP BY article_id'):
        item = entry(row[0])
        item['uses'],item['used_at'] = row[1],row[2]
    for row in db.execute('''SELECT article_id,SUM(vote=1),SUM(vote=-1),MAX(CASE WHEN user_id=? THEN vote END),
                             MAX(CASE WHEN user_id=? THEN pin_order END) FROM knowledge_marks GROUP BY article_id''',(user_id,user_id)):
        item = entry(row[0])
        item['helpful'],item['unhelpful'],item['my_vote'],item['pin_order'] = row[1] or 0,row[2] or 0,row[3] or 0,row[4] or 0
    return found


def used_recently(db, article_id, user_id, kind, since):
    return bool(one(db,'SELECT 1 AS x FROM knowledge_uses WHERE article_id=? AND user_id=? AND kind=? AND created_at>=?',(article_id,user_id,kind,since)))


def add_use(db, article_id, user_id, kind):
    db.execute('INSERT INTO knowledge_uses VALUES(?,?,?,?,?)',(uid(),article_id,user_id,kind,now()))


def set_vote(db, article_id, user_id, vote):
    db.execute('''INSERT INTO knowledge_marks(article_id,user_id,vote,updated_at) VALUES(?,?,?,?)
                  ON CONFLICT(article_id,user_id) DO UPDATE SET vote=excluded.vote,updated_at=excluded.updated_at''',(article_id,user_id,vote,now()))


def set_pins(db, user_id, article_ids):
    """The member's pinned articles become exactly `article_ids`, in that order."""
    stamp = now()
    db.execute('UPDATE knowledge_marks SET pin_order=0,updated_at=? WHERE user_id=? AND pin_order>0',(stamp,user_id))
    for order,article_id in enumerate(article_ids,1):
        db.execute('''INSERT INTO knowledge_marks(article_id,user_id,pin_order,updated_at) VALUES(?,?,?,?)
                      ON CONFLICT(article_id,user_id) DO UPDATE SET pin_order=excluded.pin_order,updated_at=excluded.updated_at''',
                   (article_id,user_id,order,stamp))


def existing_ids(db, article_ids):
    marks = ','.join('?'*len(article_ids))
    return {row[0] for row in db.execute(f'SELECT id FROM knowledge_articles WHERE id IN ({marks})',tuple(article_ids))} if article_ids else set()


# Earlier versions (model.py: knowledge_revisions).

def keep_revision(db, article, replaced_by, kept):
    """Keep `article` (the row before a save) as a revision, and only the latest `kept` of that article."""
    db.execute('INSERT INTO knowledge_revisions VALUES(?,?,?,?,?,?,?,?,?,?)',
               (uid(),article['id'],article['title'],article['category'],article['body'],article['visibility'],article['author'],
                article['updated_at'],replaced_by,now()))
    db.execute('''DELETE FROM knowledge_revisions WHERE article_id=? AND id NOT IN
                  (SELECT id FROM knowledge_revisions WHERE article_id=? ORDER BY replaced_at DESC,rowid DESC LIMIT ?)''',
               (article['id'],article['id'],kept))


def revisions(db, article_id):
    return rows(db,'''SELECT id,title,category,body,visibility,author,saved_at,replaced_by,replaced_at FROM knowledge_revisions
                      WHERE article_id=? ORDER BY replaced_at DESC,rowid DESC''',(article_id,))


def revision_counts(db):
    return dict(db.execute('SELECT article_id,COUNT(*) FROM knowledge_revisions GROUP BY article_id').fetchall())
