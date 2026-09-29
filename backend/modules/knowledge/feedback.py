"""บทความนี้ช่วยได้ไหม: customers - signed in or not - say whether a published article answered them, from the FAQ page
and from the answers offered while they write to the team. The organization's owner reads it in the service report
(หัวข้อ AI และคลังความรู้), next to the team's own marks, to find the articles to rewrite.

- One say per browser and article: the page keeps a random token of its own (never an account or a visitor id), sent
  with each press; saying it again changes it. Only the token's hash is kept.
- Only an article the organization publishes can be marked; a platform article or an internal one cannot.
- A press is counted at most VOTES_PER_IP_HOUR times an hour from one address, so nobody can press an article down."""
import re

from backend.database.db import rows
from backend.utils.dates import now
from backend.utils.security import token_hash
from backend.utils.validation import require

VOTES_PER_IP_HOUR = 60
UNHELPFUL_SHOWN = 5
TOKEN = re.compile(r'[a-f0-9]{16,64}')

TABLE = '''
CREATE TABLE IF NOT EXISTS knowledge_feedback (
    article_id TEXT NOT NULL, voter TEXT NOT NULL, helpful INTEGER NOT NULL CHECK(helpful IN (0,1)),
    updated_at TEXT NOT NULL, PRIMARY KEY(article_id,voter)
);
CREATE INDEX IF NOT EXISTS knowledge_feedback_time ON knowledge_feedback(updated_at);
'''


def vote(db, article_id, body):
    """POST /api/public/<org>/articles/<id>/feedback {helpful, voter}."""
    body = body if isinstance(body,dict) else {}
    helpful,voter = body.get('helpful'),body.get('voter')
    require(type(helpful) is bool,'เลือกว่าช่วยได้หรือไม่')
    require(isinstance(voter,str) and TOKEN.fullmatch(voter),'ข้อมูลไม่ถูกต้อง')
    found = db.execute("SELECT 1 FROM knowledge_articles WHERE id=? AND visibility='public'",(article_id,)).fetchone()
    require(found,'ไม่พบบทความนี้',404)
    db.execute('''INSERT INTO knowledge_feedback VALUES(?,?,?,?) ON CONFLICT(article_id,voter) DO UPDATE SET
                  helpful=excluded.helpful,updated_at=excluded.updated_at''',(article_id,token_hash(voter),int(helpful),now()))
    db.commit()
    return {'ok':True}


def report(db, since, until):
    """The period's customer says: how many helped and did not, and the articles that most did not help."""
    total = db.execute('SELECT COALESCE(SUM(helpful=1),0),COALESCE(SUM(helpful=0),0) FROM knowledge_feedback WHERE updated_at>=? AND updated_at<?',
                       (since,until)).fetchone()
    worst = rows(db,'''SELECT a.id,a.title,a.category,SUM(f.helpful=1) AS helpful,SUM(f.helpful=0) AS unhelpful
                       FROM knowledge_feedback f JOIN knowledge_articles a ON a.id=f.article_id
                       WHERE f.updated_at>=? AND f.updated_at<? GROUP BY a.id HAVING SUM(f.helpful=0)>0
                       ORDER BY SUM(f.helpful=0)-SUM(f.helpful=1) DESC,SUM(f.helpful=0) DESC,a.title LIMIT ?''',(since,until,UNHELPFUL_SHOWN))
    return {'helpful':total[0],'unhelpful':total[1],'unhelpful_articles':worst}
