"""กู้คืนผ่านหน้าจอ: the platform console restores a full backup (database/backup.py) without the command line.

1. The file: one of the backups the console lists, or one sent from the admin's computer in pieces (upload(): up to
   CHUNK_MAX a request, as the API takes JSON) and kept in the backups folder as bookdose-upload-….zip.
2. What it would do, before anything changes (preview()): which organizations are replaced, added or would disappear,
   their cases now and in the file, who can sign in afterwards, and whether this server holds the key that opens the
   credentials in it.
3. The admin types the file's name (confirm_word) to confirm.
4. The restore (restore()): first a backup of everything as it is now (bookdose-before-….zip, never removed
   automatically), so a wrong file is undone by restoring that one; then, with every other database connection held
   (db.paused), each database is copied into place with SQLite's backup API (safe under a running server), the
   organizations the file does not have are removed, the attachments and - when this server holds their key - the
   credentials are put back, the databases are brought up to this version, and everyone is signed out: staff and
   customers sign in again with the accounts in the file.

One restore or backup at a time (backups._running). """
import base64
import binascii
from contextlib import closing
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import time
import zipfile

from backend.database import audit, backup as B, db as D
from backend.exceptions.errors import APIError
from backend.modules.platform import backups
from backend.utils import secret_box
from backend.utils.security import uid
from backend.utils.validation import require

CHUNK_MAX = 4*1024*1024
UPLOAD_MAX = 2*1024**3
UPLOAD_ID = re.compile(r'[a-f0-9]{32}')
TENANT_ENTRY = re.compile(r'tenants/([a-f0-9]{32})\.sqlite3')


def confirm_word(name):
    """What the admin types to confirm: the file's name without .zip."""
    return name[:-4]


# 1. Sending a file from the admin's computer
def _part(upload_id):
    return backups.folder()/f'.upload-{upload_id}.part'


def _sweep_parts():
    """Uploads left unfinished for a day are thrown away."""
    for path in backups.folder().glob('.upload-*.part'):
        try:
            if time.time()-path.stat().st_mtime>24*3600:
                path.unlink()
        except OSError:
            pass


def upload(cd, session, body):
    """One piece of a backup sent from the console: {upload (None for the first piece), offset, data (base64), last}.
    Returns {upload, received} until the last piece, then {name} of the checked backup, which the console lists."""
    upload_id,offset,data,last = body.get('upload'),body.get('offset'),body.get('data'),body.get('last')
    require(isinstance(offset,int) and not isinstance(offset,bool) and offset>=0 and isinstance(data,str) and isinstance(last,bool),
            'ข้อมูลการอัปโหลดไม่ถูกต้อง')
    try:
        chunk = base64.b64decode(data,validate=True)
    except (binascii.Error,ValueError):
        raise APIError(400,'ข้อมูลการอัปโหลดไม่ถูกต้อง') from None
    require(len(chunk)<=CHUNK_MAX,'ส่งไฟล์ทีละไม่เกิน 4 MB',413)
    folder = backups.folder()
    folder.mkdir(parents=True,exist_ok=True)
    if offset==0:
        require(upload_id is None,'ข้อมูลการอัปโหลดไม่ถูกต้อง')
        _sweep_parts()
        upload_id = uid()
        _part(upload_id).open('xb').close()
    else:
        require(isinstance(upload_id,str) and UPLOAD_ID.fullmatch(upload_id),'ข้อมูลการอัปโหลดไม่ถูกต้อง')
    path = _part(upload_id)
    require(path.is_file(),'ไม่พบไฟล์ที่กำลังอัปโหลด กรุณาเริ่มใหม่',404)
    require(path.stat().st_size==offset,'ลำดับการอัปโหลดไม่ตรงกัน กรุณาเริ่มใหม่',409)
    require(offset+len(chunk)<=UPLOAD_MAX,'ไฟล์ใหญ่เกิน 2 GB: วางไฟล์ในโฟลเดอร์สำรองข้อมูลแทน แล้วเลือกจากรายการ',413)
    with path.open('ab') as out:
        out.write(chunk)
    if not last:
        return {'upload':upload_id,'received':offset+len(chunk)}
    try:
        with zipfile.ZipFile(path) as archive:
            B.check_archive(archive)
    except zipfile.BadZipFile:
        path.unlink(missing_ok=True)
        raise APIError(400,'ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูล (ZIP) ของระบบ') from None
    except APIError:
        path.unlink(missing_ok=True)
        raise
    name = backups.new_name('upload')
    while (folder/name).exists():
        name = backups.new_name('upload')
    path.rename(folder/name)
    audit.record(cd,session['user_id'],'platform.backup_uploaded',name)
    cd.commit()
    return {'name':name}


# 2. What restoring it would do
def _counts_of_file(path):
    """{'cases','conversations'} of a tenant database file, read only; zeros for tables it does not have."""
    with closing(sqlite3.connect(f'file:{path.as_posix()}?mode=ro',uri=True)) as db:
        return {k:_count(db,t) for k,t in (('cases','tickets'),('conversations','conversations'))}


def _count(db, table):
    try:
        return db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
    except sqlite3.Error:
        return 0


def _current():
    """{tenant id: {name, slug, cases, conversations}} of the platform as it is now."""
    with D.control() as cd:
        orgs = D.rows(cd,'SELECT id,name,slug FROM tenants')
    found = {}
    for org in orgs:
        counts = {'cases':0,'conversations':0}
        if D.tenant_path(org['id']).is_file():
            with D.tenant(org['id']) as db:
                counts = {k:_count(db,t) for k,t in (('cases','tickets'),('conversations','conversations'))}
        found[org['id']] = {**org,**counts}
    return found


def _key(manifest):
    needed = manifest.get('secret_key_id')
    return needed,(not needed or needed in secret_box.available_key_ids())


def preview(name):
    """What restoring this backup would replace: nothing is changed."""
    path = backups.path_of(name)
    with zipfile.ZipFile(path) as archive, tempfile.TemporaryDirectory(prefix='bookdose-preview-') as temporary:
        manifest,entries = B.check_archive(archive)
        where = Path(temporary)
        archive.extract('control.sqlite3',where)
        with closing(sqlite3.connect((where/'control.sqlite3').as_posix())) as cd:
            orgs = [dict(zip(('id','name','slug'),r)) for r in cd.execute('SELECT id,name,slug FROM tenants')]
            admins = [r[0] for r in cd.execute('SELECT email FROM users WHERE platform_admin=1 ORDER BY email')]
        in_file = {m[1]:e for e in entries if (m := TENANT_ENTRY.fullmatch(e.filename))}
        backed = {}
        for org in orgs:
            counts = {'cases':0,'conversations':0}
            if org['id'] in in_file:
                archive.extract(in_file[org['id']],where)
                file = where/in_file[org['id']].filename
                counts = _counts_of_file(file)
                file.unlink()
            backed[org['id']] = {**org,**counts}
        attachments = sum(1 for e in entries if e.filename.startswith('files/'))
    now_orgs = _current()
    listed = []
    for org_id in {*now_orgs,*backed}:
        before,later = now_orgs.get(org_id),backed.get(org_id)
        shown = later or before
        listed.append({'id':org_id,'name':shown['name'],'slug':shown['slug'],
                       'change':'replace' if before and later else 'add' if later else 'remove',
                       'cases_now':before['cases'] if before else None,'cases_backup':later['cases'] if later else None,
                       'conversations_now':before['conversations'] if before else None,
                       'conversations_backup':later['conversations'] if later else None})
    order = {'remove':0,'replace':1,'add':2}
    listed.sort(key=lambda o:(order[o['change']],o['name']))
    needed,has_key = _key(manifest)
    return {'name':name,'confirm':confirm_word(name),'created_at':manifest.get('created_at'),'size':path.stat().st_size,
            'organizations':listed,
            'totals':{change:sum(1 for o in listed if o['change']==change) for change in order}
                     |{'cases_now':sum(o['cases'] for o in now_orgs.values()),'cases_backup':sum(o['cases'] for o in backed.values())},
            'attachments':attachments,'platform_admins':admins,
            'secrets':{'key_id':needed,'available':has_key,'files':manifest.get('secret_files',0)}}


# 4. The restore
def _copy_into(source, target):
    """A database file put in place of a live one, with SQLite's backup API (the file itself is never swapped)."""
    with closing(sqlite3.connect(source.as_posix())) as src, closing(sqlite3.connect(target.as_posix(),timeout=30)) as dst:
        src.backup(dst)
        dst.execute('PRAGMA wal_checkpoint(TRUNCATE)')


def _remove_tenant(tenant_id):
    """An organization the backup does not have (it is in the safety backup taken first)."""
    for suffix in ('.sqlite3','.sqlite3-wal','.sqlite3-shm'):
        try:
            (D.DATA/'tenants'/f'{tenant_id}{suffix}').unlink(missing_ok=True)
        except OSError as error:
            print(f'Restore: could not remove a database of {tenant_id}: {type(error).__name__}',flush=True)
    shutil.rmtree(D.DATA/'files'/tenant_id,ignore_errors=True)
    for path in (D.DATA/'secrets').glob(f'{tenant_id}.*') if (D.DATA/'secrets').is_dir() else ():
        path.unlink(missing_ok=True)


def _put_back(archive, entries, temporary, with_secrets):
    databases = [e for e in entries if e.filename=='control.sqlite3']+[e for e in entries if TENANT_ENTRY.fullmatch(e.filename)]
    kept = {TENANT_ENTRY.fullmatch(e.filename)[1] for e in databases if e.filename!='control.sqlite3'}
    for entry in databases:
        archive.extract(entry,temporary)
        source,target = temporary/entry.filename,D.DATA/entry.filename
        if target.is_file():
            _copy_into(source,target)
        else:
            target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(source,target)
            target.chmod(0o600)
        source.unlink()
    for path in (D.DATA/'tenants').glob('*.sqlite3'):
        if path.stem not in kept:
            _remove_tenant(path.stem)
    # Attachments are named by random ids: one already here is the same file.
    for entry in entries:
        if entry.filename.startswith('files/') and not (D.DATA/entry.filename).is_file():
            archive.extract(entry,D.DATA)
    if with_secrets:
        names = {e.filename[len('secrets/'):] for e in entries if e.filename.startswith('secrets/')}
        folder = D.DATA/'secrets'
        for path in folder.glob('*') if folder.is_dir() else ():
            if path.is_file() and re.fullmatch(B.SECRET_NAME,path.name) and path.name not in names:
                path.unlink()
        for entry in entries:
            if entry.filename.startswith('secrets/'):
                archive.extract(entry,D.DATA)
                (D.DATA/entry.filename).chmod(0o600)


def _forget_caches():
    from backend.modules.ai import insights
    from backend.modules.conversations import queue
    insights._cache.clear()
    queue._cache.clear()


def restore(cd, session, body):
    """Restore a backup the console lists, confirmed by its name typed out. Everyone is signed out afterwards,
    including the admin who restored it."""
    name,typed,without = body.get('name'),body.get('confirm'),body.get('without_secrets',False)
    path = backups.path_of(name)
    require(isinstance(typed,str) and typed.strip()==confirm_word(name),f'พิมพ์ {confirm_word(name)} ให้ตรงเพื่อยืนยัน')
    require(isinstance(without,bool),'ข้อมูลการกู้คืนไม่ถูกต้อง')
    require(backups._running.acquire(blocking=False),'กำลังสำรองหรือกู้คืนข้อมูลอยู่ กรุณารอให้เสร็จก่อน',409)
    try:
        with zipfile.ZipFile(path) as archive:
            manifest,entries = B.check_archive(archive)
            needed,has_key = _key(manifest)
            require(has_key or without,f'ไฟล์นี้เข้ารหัส Token ด้วยกุญแจ {needed} ซึ่งเซิร์ฟเวอร์นี้ไม่มี: ตั้ง BOOKDOSE_SECRET_KEY เดิมก่อน '
                                        'หรือเลือกกู้คืนโดยไม่มี Token (ต้องใส่ LINE อีเมล Facebook OpenAI และ SMS ใหม่)')
            # The request's own read of the platform database ends here: the file changes under it next.
            cd.commit()
            safety = backups.write('before',session['user_id'])
            require(safety['ok'],f"สำรองข้อมูลปัจจุบันก่อนกู้คืนไม่สำเร็จ ({safety.get('error','')}) จึงยังไม่ได้กู้คืน "
                                 f'ตรวจพื้นที่ดิสก์และสิทธิ์เขียนโฟลเดอร์ {backups.folder()}',500)
            with tempfile.TemporaryDirectory(prefix='bookdose-restore-') as temporary, D.paused():
                try:
                    _put_back(archive,entries,Path(temporary),has_key)
                    B.sign_everyone_out()
                    # A backup from an earlier version is brought up to this one, as a restart would.
                    D.init()
                except Exception as error:
                    print(f'Restore failed: {type(error).__name__}',flush=True)
                    raise APIError(500,f"กู้คืนไม่สำเร็จระหว่างทาง ข้อมูลอาจไม่ครบ: กู้คืนจากไฟล์ {safety['name']} "
                                       'เพื่อกลับไปเป็นเหมือนก่อนกู้') from None
        _forget_caches()
        with D.control() as after_cd:
            audit.record(after_cd,session['user_id'],'platform.restored',name,f"ข้อมูลก่อนกู้เก็บไว้ที่ {safety['name']}")
        return {'ok':True,'safety_backup':safety['name'],'secrets_restored':bool(has_key and manifest.get('secret_files')),
                'secrets_skipped':not has_key}
    finally:
        backups._running.release()
