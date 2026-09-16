"""Backups: ZIP snapshots of the SQLite databases plus attachments, and full-platform restore."""
from contextlib import closing
import io
import json
from pathlib import Path
import re
import sqlite3
import tempfile
import zipfile

from backend.database import db as D
from backend.utils.dates import now
from backend.utils.validation import require


def make_backup(tenant_id=None):
    buffer = io.BytesIO()
    paths = [D.tenant_path(tenant_id)] if tenant_id else [D.DATA/'control.sqlite3',*sorted((D.DATA/'tenants').glob('*.sqlite3'))]
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
        archive.writestr('manifest.json',json.dumps({'app':'Bookdose Customer Service','version':1,'created_at':now(),
                            'scope':'tenant' if tenant_id else 'platform','tenant_id':tenant_id},ensure_ascii=False))
    return buffer.getvalue()


def restore_backup(archive_path):
    """Restore a platform backup into an EMPTY data directory, then sign every staff member out."""
    require(not D.DATA.exists() or not any(D.DATA.iterdir()),'โฟลเดอร์ข้อมูลต้องว่างก่อนกู้คืน')
    with zipfile.ZipFile(archive_path) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        require(manifest.get('app')=='Bookdose Customer Service' and manifest.get('scope')=='platform' and manifest.get('version')==1,'ต้องใช้ไฟล์สำรองทั้งแพลตฟอร์มรุ่น 1')
        entries = [entry for entry in archive.infolist() if entry.filename!='manifest.json']
        for entry in entries:
            require(re.fullmatch(r'control\.sqlite3|tenants/[a-f0-9]{32}\.sqlite3|files/[a-f0-9]{32}/[a-f0-9]{32}',entry.filename),'โครงสร้างไฟล์สำรองไม่ถูกต้อง')
        require(sum(e.file_size for e in entries)<=10*1024**3,'ไฟล์สำรองใหญ่เกิน 10 GB')
        require(any(e.filename=='control.sqlite3' for e in entries),'ไม่พบฐานข้อมูลแพลตฟอร์ม')
        for entry in entries:
            archive.extract(entry,D.DATA)
    with D.control() as db:
        db.execute('DELETE FROM sessions')
        if D.one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='pending_registrations'"):
            db.execute('DELETE FROM pending_registrations')
        # Customers sign in again too, and links sent before the backup no longer work.
        for table in ('customer_sessions','customer_signups','customer_resets'):
            if D.one(db,"SELECT name FROM sqlite_master WHERE type='table' AND name=?",(table,)):
                db.execute(f'DELETE FROM {table}')
