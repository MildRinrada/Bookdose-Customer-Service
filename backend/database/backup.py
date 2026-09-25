"""Backups: ZIP snapshots of the SQLite databases plus attachments, and full-platform restore.

A platform backup also carries the private secret files (data/secrets: the tokens of LINE, Facebook, email and OpenAI,
the platform's SMTP password, the SMS provider's credentials), but only sealed with the platform's secret key
(utils/secret_box) and never the key itself: the backup alone gives no token away, and the manifest names the key's id
so a restore can tell before writing anything whether this server holds the key that opens them. The same key opens
the two-factor secrets kept in the databases. An organization's own backup (downloaded by its admin) has no secrets.

Keep the key apart from the backups: BOOKDOSE_SECRET_KEY on the server (or a copy of data/keys/secret.key) in a
password manager or a safe. Without it a restore still works with --new-key, but every token must be entered again."""
from contextlib import closing
import io
import json
from pathlib import Path
import re
import sqlite3
import tempfile
import zipfile

from backend.database import db as D
from backend.utils import secret_box
from backend.utils.dates import now
from backend.utils.validation import require

# The names data/secrets holds: '<tenant>.<kind>.json', '<tenant>.openai-key', 'registration-smtp.json', 'sms.json'.
SECRET_NAME = r'(?:[a-f0-9]{32}\.)?[a-z]+(?:-[a-z]+)*(?:\.json)?'
ENTRY = re.compile(r'control\.sqlite3|tenants/[a-f0-9]{32}\.sqlite3|files/[a-f0-9]{32}/[a-f0-9]{32}|secrets/'+SECRET_NAME)


def sealed_secret_files():
    """[(name, sealed text)] of data/secrets, each sealed with the current key (anything older is sealed again first).
    A file that still cannot be sealed - it does not open with any key this server has - is left out."""
    folder = D.DATA/'secrets'
    if not folder.is_dir():
        return []
    secret_box.seal_existing_files()
    current = secret_box.current_key_id()
    found = []
    for path in sorted(folder.iterdir()):
        if not path.is_file() or not re.fullmatch(SECRET_NAME,path.name):
            continue
        text = path.read_text().strip()
        if secret_box.is_sealed(text) and text.split('.',2)[1]==current:
            found.append((path.name,text))
    return found


def make_backup(tenant_id=None):
    buffer = io.BytesIO()
    paths = [D.tenant_path(tenant_id)] if tenant_id else [D.DATA/'control.sqlite3',*sorted((D.DATA/'tenants').glob('*.sqlite3'))]
    secrets = [] if tenant_id else sealed_secret_files()
    with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as archive:
        with tempfile.TemporaryDirectory(prefix='bookdose-backup-') as temporary:
            for index,path in enumerate(paths):
                target = Path(temporary)/f'{index}.sqlite3'
                with D.connect(path) as source:
                    with closing(sqlite3.connect(target)) as destination:
                        source.backup(destination)
                archive.write(target,str(path.relative_to(D.DATA)))
                # Use attachment references from the snapshot so later new uploads are not mixed in.
                if path.name!='control.sqlite3':
                    with closing(sqlite3.connect(target)) as snapshot:
                        keys = [r[0] for r in snapshot.execute('SELECT storage_key FROM attachments')]
                    for key in keys:
                        file = D.DATA/'files'/path.stem/key
                        if not file.is_file():
                            raise RuntimeError('A referenced attachment is missing; backup aborted')
                        archive.write(file,str(file.relative_to(D.DATA)))
        for name,text in secrets:
            archive.writestr('secrets/'+name,text+'\n')
        manifest = {'app':'Bookdose Customer Service','version':1,'created_at':now(),
                    'scope':'tenant' if tenant_id else 'platform','tenant_id':tenant_id}
        if not tenant_id:
            # Which key opens the sealed values of this backup (files and database columns alike); never the key.
            manifest.update(secret_key_id=secret_box.current_key_id(),secret_files=len(secrets))
        archive.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False))
    return buffer.getvalue()


def _empty_data_folder():
    """Nothing in the data folder yet, apart from the key put back before restoring (keys/secret.key)."""
    if not D.DATA.exists():
        return True
    for item in D.DATA.iterdir():
        if item.name=='keys' and item.is_dir() and all(p.name=='secret.key' for p in item.iterdir()):
            continue
        return False
    return True


def check_archive(archive):
    """(manifest, entries) of an open platform backup, or a refusal saying what is wrong with it. Reads nothing but the
    list of entries and the manifest."""
    try:
        manifest = json.loads(archive.read('manifest.json'))
    except (KeyError,ValueError):
        manifest = {}
    require(isinstance(manifest,dict) and manifest.get('app')=='Bookdose Customer Service' and manifest.get('scope')=='platform'
            and manifest.get('version')==1,'ต้องใช้ไฟล์สำรองทั้งแพลตฟอร์มรุ่น 1')
    entries = [entry for entry in archive.infolist() if entry.filename!='manifest.json']
    for entry in entries:
        require(ENTRY.fullmatch(entry.filename),'โครงสร้างไฟล์สำรองไม่ถูกต้อง')
    require(sum(e.file_size for e in entries)<=10*1024**3,'ไฟล์สำรองใหญ่เกิน 10 GB')
    require(any(e.filename=='control.sqlite3' for e in entries),'ไม่พบฐานข้อมูลแพลตฟอร์ม')
    return manifest,entries


def sign_everyone_out():
    """After a restore: every staff member and customer signs in again, and links sent before the backup stop working."""
    with D.control() as db:
        db.execute('DELETE FROM sessions')
        if D.one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='pending_registrations'"):
            db.execute('DELETE FROM pending_registrations')
        for table in ('customer_sessions','customer_signups','customer_resets'):
            if D.one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name=?",(table,)):
                db.execute(f'DELETE FROM {table}')


def restore_backup(archive_path, new_key=False):
    """Restore a platform backup into an EMPTY data directory, then sign every staff member out. Returns what the
    operator should know. The sealed secrets are restored only when this server holds the key they were sealed with
    (BOOKDOSE_SECRET_KEY / _OLD, or keys/secret.key put back in the data folder); otherwise nothing is written unless
    new_key says to go on without them."""
    require(_empty_data_folder(),'โฟลเดอร์ข้อมูลต้องว่างก่อนกู้คืน (วางไว้ได้เฉพาะ keys/secret.key)')
    with zipfile.ZipFile(archive_path) as archive:
        manifest,entries = check_archive(archive)
        needed = manifest.get('secret_key_id')
        has_key = not needed or needed in secret_box.available_key_ids()
        require(has_key or new_key,
                f'ไฟล์สำรองนี้เข้ารหัสค่าลับด้วยกุญแจรหัส {needed} ซึ่งเซิร์ฟเวอร์นี้ไม่มี: ตั้ง BOOKDOSE_SECRET_KEY เดิม '
                'หรือวางไฟล์ keys/secret.key เดิมในโฟลเดอร์ข้อมูลก่อน (ถ้ากุญแจหายจริง ใช้ --new-key เพื่อกู้คืนโดยไม่มีค่าลับ)')
        skipped = 0
        for entry in entries:
            if entry.filename.startswith('secrets/') and not has_key:
                skipped += 1
                continue
            archive.extract(entry,D.DATA)
    for path in (D.DATA/'secrets').glob('*') if (D.DATA/'secrets').is_dir() else ():
        path.chmod(0o600)
    sign_everyone_out()
    if has_key:
        return {'secrets':manifest.get('secret_files',0),'skipped':0,'key':needed}
    return {'secrets':0,'skipped':skipped,'key':needed}
