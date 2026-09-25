"""แจ้งฉันเมื่อแก้แล้ว: a signed-in customer who reads a known issue on the chat page asks to hear when it is fixed,
instead of writing to the team to ask (known_issue_followers). When the owners mark it resolved, each follower is
told once: on the organization's LINE and by email as they chose for 'issue' (ตั้งค่าบัญชี → การแจ้งเตือน), and on
their notifications page. Queued inside the transaction that resolved it; the automation worker sends
(customers/notify.py)."""
from backend.database import db as D
from backend.database.db import begin, rows
from backend.exceptions.errors import APIError
from backend.utils.dates import after, now
from backend.utils.security import uid
from backend.utils.validation import require

TOLD_SHOWN_DAYS = 3          # the notifications page keeps "it is fixed" this long


def following(db, account_id):
    """Ids of the issues shown now that this customer follows."""
    return [row[0] for row in db.execute('''SELECT f.issue_id FROM known_issue_followers f JOIN known_issues i ON i.id=f.issue_id
                                             WHERE f.account_id=? AND i.status='active' ''',(account_id,))]


def set_following(db, session, issue_id, body):
    """Follow or stop following an active issue."""
    follow = body.get('follow') if isinstance(body,dict) else None
    require(isinstance(follow,bool),'ข้อมูลไม่ถูกต้อง')
    issue = db.execute("SELECT id,status FROM known_issues WHERE id=?",(issue_id,)).fetchone()
    if not issue:
        raise APIError(404,'ไม่พบประกาศนี้')
    require(issue['status']=='active' or not follow,'เรื่องนี้แก้เสร็จแล้ว',409)
    begin(db)
    if follow:
        db.execute('INSERT OR IGNORE INTO known_issue_followers(issue_id,account_id,created_at) VALUES(?,?,?)',
                   (issue_id,session['account_id'],now()))
    else:
        db.execute('DELETE FROM known_issue_followers WHERE issue_id=? AND account_id=?',(issue_id,session['account_id']))
    db.commit()
    return {'following':following(db,session['account_id'])}


def tell_resolved(db, issue):
    """The issue was just marked resolved: queue one notice per follower not told yet (inside the caller's
    transaction). Nothing is sent from here."""
    from backend.modules.customers import notify, repository as customers
    from backend.modules.platform import repository as tenants, service as platform
    waiting = rows(db,'SELECT account_id FROM known_issue_followers WHERE issue_id=? AND told_at IS NULL',(issue['id'],))
    if not waiting:
        return 0
    tenant_id = D.tenant_id_of(db)
    told = 0
    with D.control() as cd:
        org = tenants.tenant_summary(cd,tenant_id)
        mail = platform.registration_ready(cd)
        subject = f"{org['name']} แก้ปัญหา “{issue['title']}” แล้ว"
        text = (f"เรื่อง “{issue['title']}” ที่คุณติดตามไว้ {org['name']} แจ้งว่าแก้เสร็จแล้ว\n"
                'ถ้ายังใช้งานไม่ได้ เริ่มแชทใหม่กับทีมงานได้เลย')
        for row in waiting:
            account = customers.find(cd,row['account_id'])
            if not account:
                continue
            if notify.line_wanted(db,tenant_id,account,'issue'):
                notify.queue_line(cd,db,tenant_id,account['id'],subject,'/customer/chats',f"issue:{issue['id']}:{account['id']}:line")
            if mail and account['email_verified'] and notify.wants(account,'issue','email'):
                customers.insert_alert(db,uid(),account['id'],'email',subject,text,notify.link(cd,db,tenant_id,'/customer/alerts'),
                                       f"issue:{issue['id']}:{account['id']}:email")
            told += 1
    db.execute('UPDATE known_issue_followers SET told_at=? WHERE issue_id=? AND told_at IS NULL',(now(),issue['id']))
    return told


def told_alerts(db, account_id):
    """What the notifications page lists: the followed issues fixed in the last few days."""
    return rows(db,'''SELECT i.id,i.title,i.resolved_at FROM known_issue_followers f JOIN known_issues i ON i.id=f.issue_id
                      WHERE f.account_id=? AND i.status='resolved' AND i.resolved_at>=? ORDER BY i.resolved_at DESC''',
                (account_id,after(days=-TOLD_SHOWN_DAYS)))
