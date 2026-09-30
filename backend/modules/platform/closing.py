"""ปิดองค์กรถาวร: an organization that has stopped using the platform is removed for good, instead of lying suspended
with its customers' data kept forever (PDPA) and its files on the disk.

In this order, each step refused until the one before is done:
  1. Suspend it (service.set_tenant_status), so nobody is still working in it.
  2. Export it (export()): the organization's whole database and attachments as one archive, the same as its owner's
     own backup (database/backup.make_backup(tenant_id)), for the platform admin to hand to the owner. When it was
     made is kept (EXPORTS_KEY) and shown on the organization's page; deleting needs one from the last EXPORT_DAYS.
  3. Delete it (close()), with the organization's code typed out and the password proven again (admin_guard).

What goes: its database and attachments, its sealed credentials (LINE, email, Facebook, AI), and every row of the
platform database that belongs to it (members, invitations, join links, routes of its channels, its customers' link to
it, support requests, problem reports, feature switches). Staff accounts that belonged to no other organization go
too, with everything of theirs (sign-in methods, sessions, preferences, history).

What stays: its codes, reserved so a link its customers were given never leads to another organization (it answers
404 instead); the platform's own history (audit) and the security log, which keep only ids; customer accounts, which
belong to the customer and may be members of other organizations (a customer erases their own from their account, or
the platform does it with the PDPA tools); and the platform backups made before, until they age out (backups.py)."""
import datetime as dt
import json

from backend.database import audit, backup as B, db as D
from backend.modules.platform import backups, repository
from backend.utils.dates import now, utc_now
from backend.utils.validation import require

EXPORTS_KEY = 'closing_exports'
EXPORT_DAYS = 30
# Rows here are not the organization's to take along (see the docstring); sessions only lose it as their workspace.
KEPT_TABLES = {'security_events','tenant_slugs'}


def _tenant(cd, tenant_id):
    org = D.one(cd,'SELECT * FROM tenants WHERE id=?',(tenant_id,))
    require(org,'ไม่พบองค์กร',404)
    return org


def exports(cd):
    try:
        found = json.loads(repository.setting(cd,EXPORTS_KEY) or '{}')
    except ValueError:
        found = {}
    return found if isinstance(found,dict) else {}


def _fresh(stamp):
    try:
        moment = dt.datetime.fromisoformat(str(stamp).replace('Z','+00:00'))
    except ValueError:
        return False
    return moment.tzinfo is not None and utc_now()-moment<=dt.timedelta(days=EXPORT_DAYS)


def export(cd, session, tenant_id):
    """(file name, archive bytes) of the whole organization, recorded as exported now."""
    from backend.modules.platform import service
    org = _tenant(cd,tenant_id)
    require(tenant_id!=service.home_tenant_id(cd),'ปิดองค์กรหลักของแพลตฟอร์มไม่ได้',409)
    content = B.make_backup(tenant_id)
    found = exports(cd)
    found[tenant_id] = {'at':now(),'by':session['name'],'size':len(content)}
    repository.save_setting(cd,EXPORTS_KEY,json.dumps(found,ensure_ascii=False))
    audit.record(cd,session['name'],'tenant.exported',tenant_id,f"{org['name']} · {len(content)} ไบต์")
    cd.commit()
    stamp = utc_now().astimezone(backups.THAI).strftime('%Y%m%d')
    return f"{org['slug']}-{stamp}.zip",content


def _tables_with(cd, column):
    return [name for (name,) in cd.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            if any(col[1]==column for col in cd.execute(f'PRAGMA table_info("{name}")'))]


def _delete_rows(cd, tenant_id):
    for table in _tables_with(cd,'tenant_id'):
        if table=='sessions':
            cd.execute('UPDATE sessions SET tenant_id=NULL WHERE tenant_id=?',(tenant_id,))
        elif table not in KEPT_TABLES:
            cd.execute(f'DELETE FROM "{table}" WHERE tenant_id=?',(tenant_id,))


def _delete_lone_staff(cd, user_ids):
    """Staff accounts left with no organization (never a platform admin), with every row of theirs."""
    gone = [uid for uid in user_ids
            if not D.one(cd,'SELECT 1 FROM memberships WHERE user_id=?',(uid,))
            and not D.one(cd,'SELECT 1 FROM users WHERE id=? AND platform_admin=1',(uid,))]
    tables = _tables_with(cd,'user_id')
    for user_id in gone:
        for table in tables:
            cd.execute(f'DELETE FROM "{table}" WHERE user_id=?',(user_id,))
        cd.execute('DELETE FROM users WHERE id=?',(user_id,))
    return len(gone)


def close(cd, session, tenant_id, body):
    """Delete a suspended, exported organization for good, confirmed by its code typed out."""
    from backend.modules.platform import restore, service
    org = _tenant(cd,tenant_id)
    require(tenant_id!=service.home_tenant_id(cd),'ปิดองค์กรหลักของแพลตฟอร์มไม่ได้ เพราะลูกค้าทุกคนสมัครและเข้าสู่ระบบผ่านองค์กรนี้',409)
    require(org['status']=='suspended','ระงับองค์กรก่อน แล้วจึงปิดถาวรได้',409)
    require(_fresh((exports(cd).get(tenant_id) or {}).get('at')),
            f'ส่งออกข้อมูลขององค์กรให้เจ้าของก่อน (ต้องส่งออกภายใน {EXPORT_DAYS} วันก่อนปิด)',409)
    typed = body.get('confirmation')
    require(isinstance(typed,str) and typed.strip()==org['slug'],f"พิมพ์รหัสองค์กร {org['slug']} ให้ตรงเพื่อยืนยัน")
    require(backups._running.acquire(blocking=False),'กำลังสำรองหรือกู้คืนข้อมูลอยู่ กรุณารอให้เสร็จก่อน',409)
    try:
        members = [row['user_id'] for row in D.rows(cd,'SELECT user_id FROM memberships WHERE tenant_id=?',(tenant_id,))]
        with D.paused():
            # Its code stays reserved, like the codes it used to have.
            cd.execute('INSERT OR REPLACE INTO tenant_slugs(slug,tenant_id,changed_at) VALUES(?,?,?)',(org['slug'],tenant_id,now()))
            _delete_rows(cd,tenant_id)
            removed = _delete_lone_staff(cd,members)
            cd.execute('DELETE FROM tenants WHERE id=?',(tenant_id,))
            found = exports(cd)
            found.pop(tenant_id,None)
            repository.save_setting(cd,EXPORTS_KEY,json.dumps(found,ensure_ascii=False))
            audit.record(cd,session['name'],'tenant.closed',tenant_id,
                         f"{org['name']} ({org['slug']}) · ลบบัญชีทีมงานที่ไม่มีองค์กรอื่น {removed} บัญชี")
            cd.commit()
            restore._remove_tenant(tenant_id)
    finally:
        backups._running.release()
    return {'ok':True,'staff_removed':removed}
