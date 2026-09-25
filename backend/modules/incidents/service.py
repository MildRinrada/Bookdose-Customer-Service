"""ประกาศปัญหาที่รู้แล้ว (model.py): the owners post and close them; the chat pages show them to customers."""
from backend.database import audit
from backend.database.db import begin
from backend.modules.incidents import repository
from backend.modules.incidents.model import ACTIVE_MAX, DETAIL_MAX, RESOLVED_SHOWN_MINUTES, STAFF_HISTORY_DAYS, STATUSES, TITLE_MAX
from backend.utils.dates import after
from backend.utils.security import uid
from backend.utils.validation import require

PUBLIC_FIELDS = ('id','title','detail','status','updated_at','resolved_at')


def public(db):
    """What the chat pages show: what is down now, and what came back within the hour. No names of staff."""
    return [{k:i[k] for k in PUBLIC_FIELDS} for i in repository.shown_since(db,after(minutes=-RESOLVED_SHOWN_MINUTES))]


def staff_view(db):
    return {'issues':repository.shown_since(db,after(days=-STAFF_HISTORY_DAYS)),'shown_minutes':RESOLVED_SHOWN_MINUTES}


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
    audit.record(db,ctx['name'],'issue.removed',issue_id,current['title'])
    db.commit()
    return staff_view(db)
