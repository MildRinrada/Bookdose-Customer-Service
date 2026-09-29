"""ประกาศปัญหาที่รู้แล้ว (model.py): the owners post and close them; the chat pages show them to customers.

ฉันก็เจอ: a customer reading an active notice - signed in or not - presses that they hit it too. Everyone reading it
sees how many did (so nobody writes in only to say so), and the team sees how many customers it really touches. One
say per browser: the page's own random token (never an account or a visitor), of which only the hash is kept, as for
บทความนี้ช่วยได้ไหม (knowledge/feedback.py); pressing again takes it back."""
import re

from backend.database import audit
from backend.database.db import begin
from backend.modules.incidents import repository
from backend.modules.incidents.model import ACTIVE_MAX, DETAIL_MAX, RESOLVED_SHOWN_MINUTES, STAFF_HISTORY_DAYS, STATUSES, TITLE_MAX
from backend.utils.dates import after, now
from backend.utils.security import token_hash, uid
from backend.utils.validation import require

PUBLIC_FIELDS = ('id','title','detail','status','updated_at','resolved_at')
TOKEN = re.compile(r'[a-f0-9]{16,64}')


def _affected(db):
    """{issue_id: how many browsers said they hit it}."""
    return dict(db.execute('SELECT issue_id,COUNT(*) FROM known_issue_reports GROUP BY issue_id').fetchall())


def public(db):
    """What the chat pages show: what is down now, and what came back within the hour, with how many customers said
    they hit it. No names of staff."""
    counts = _affected(db)
    return [{**{k:i[k] for k in PUBLIC_FIELDS},'affected':counts.get(i['id'],0)}
            for i in repository.shown_since(db,after(minutes=-RESOLVED_SHOWN_MINUTES))]


def staff_view(db):
    counts = _affected(db)
    return {'issues':[{**i,'affected':counts.get(i['id'],0)} for i in repository.shown_since(db,after(days=-STAFF_HISTORY_DAYS))],
            'shown_minutes':RESOLVED_SHOWN_MINUTES}


def affected(db, issue_id, body):
    """POST /api/public/<org>/issues/<id>/affected {affected, reporter}: this browser hit the issue too, or takes that
    back. Only while it is still being fixed."""
    body = body if isinstance(body,dict) else {}
    value,reporter = body.get('affected'),body.get('reporter')
    require(type(value) is bool,'ข้อมูลไม่ถูกต้อง')
    require(isinstance(reporter,str) and TOKEN.fullmatch(reporter),'ข้อมูลไม่ถูกต้อง')
    issue = repository.find(db,issue_id)
    require(issue,'ไม่พบประกาศนี้',404)
    require(issue['status']=='active','เรื่องนี้แก้เสร็จแล้ว',409)
    begin(db)
    if value:
        db.execute('INSERT OR IGNORE INTO known_issue_reports(issue_id,reporter,created_at) VALUES(?,?,?)',(issue_id,token_hash(reporter),now()))
    else:
        db.execute('DELETE FROM known_issue_reports WHERE issue_id=? AND reporter=?',(issue_id,token_hash(reporter)))
    db.commit()
    return {'affected':_affected(db).get(issue_id,0)}


def _form(body, current=None):
    title = body.get('title',current['title'] if current else '')
    detail = body.get('detail',current['detail'] if current else '')
    status = body.get('status',current['status'] if current else 'active')
    require(isinstance(title,str) and 1<=len(title.strip())<=TITLE_MAX,f'ใส่ชื่อระบบหรือบริการที่มีปัญหา ไม่เกิน {TITLE_MAX} ตัวอักษร')
    require(isinstance(detail,str) and len(detail.strip())<=DETAIL_MAX,f'รายละเอียดไม่เกิน {DETAIL_MAX} ตัวอักษร')
    require(status in STATUSES,'สถานะไม่ถูกต้อง')
    return ' '.join(title.split()),detail.strip(),status


def post(db, ctx, body):
    title,detail,_ = _form(body)
    begin(db)
    require(repository.active_count(db)<ACTIVE_MAX,f'มีประกาศที่ยังไม่แก้ครบ {ACTIVE_MAX} เรื่องแล้ว ปิดเรื่องที่แก้เสร็จก่อน')
    issue_id = uid()
    repository.insert(db,issue_id,title,detail,ctx['name'])
    audit.record(db,ctx['name'],'issue.posted',issue_id,title)
    db.commit()
    return staff_view(db)


def change(db, ctx, issue_id, body):
    current = repository.find(db,issue_id)
    require(current,'ไม่พบประกาศนี้',404)
    title,detail,status = _form(body,current)
    begin(db)
    if status=='active' and current['status']!='active':
        require(repository.active_count(db)<ACTIVE_MAX,f'มีประกาศที่ยังไม่แก้ครบ {ACTIVE_MAX} เรื่องแล้ว')
    repository.update(db,issue_id,title,detail,status)
    event = 'issue.resolved' if status=='resolved' and current['status']!='resolved' else \
        'issue.reopened' if status=='active' and current['status']!='active' else 'issue.updated'
    if event=='issue.resolved':
        # The customers who asked to hear it are told once (follow.py).
        from backend.modules.incidents import follow
        follow.tell_resolved(db,{'id':issue_id,'title':title})
    audit.record(db,ctx['name'],event,issue_id,title)
    db.commit()
    return staff_view(db)


def remove(db, ctx, issue_id):
    current = repository.find(db,issue_id)
    require(current,'ไม่พบประกาศนี้',404)
    begin(db)
    repository.delete(db,issue_id)
    db.execute('DELETE FROM known_issue_reports WHERE issue_id=?',(issue_id,))
    audit.record(db,ctx['name'],'issue.removed',issue_id,current['title'])
    db.commit()
    return staff_view(db)
