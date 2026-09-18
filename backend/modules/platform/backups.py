"""Backups from the platform console: the same full backup as `python app.py --backup` (every organization, the files
they point at, and the sealed credentials - never the key; database/backup.py), made on request or automatically once
a day, and the oldest automatic ones removed so only the last N stay.

Where they go: BOOKDOSE_BACKUP_DIR, else a `backups` folder beside the data folder (never inside it, and ignored by
Git). A backup on the same disk as the data does not survive that disk; the console says so, and copying the folder
elsewhere stays the owner's job.

  backup_settings  (platform setting) {enabled, hour (Thai time, 0-23), keep (automatic backups kept)}
  backup_last      (platform setting) the last attempt: when, which, how big, or why it failed
"""
import datetime as dt
import json
import os
from pathlib import Path
import re
import threading

from backend.database import audit, db as D
from backend.modules.platform import repository
from backend.utils.dates import iso, now, utc_now
from backend.utils.validation import require

THAI = dt.timezone(dt.timedelta(hours=7))
SETTINGS_KEY = 'backup_settings'
LAST_KEY = 'backup_last'
DEFAULTS = {'enabled':False,'hour':2,'keep':14}
NAME = re.compile(r'bookdose-(auto|manual)-(\d{8})-(\d{6})\.zip')
# One backup at a time: the button and the daily round never write two archives at once.
_running = threading.Lock()


def folder():
    return Path(os.environ.get('BOOKDOSE_BACKUP_DIR') or D.DATA.resolve().parent/'backups').resolve()


def settings(cd):
    try:
        saved = json.loads(repository.setting(cd,SETTINGS_KEY) or '{}')
    except ValueError:
        saved = {}
    return {**DEFAULTS,**{k:v for k,v in saved.items() if k in DEFAULTS}}


def save_settings(cd, session, body):
    enabled,hour,keep = body.get('enabled'),body.get('hour'),body.get('keep')
    require(isinstance(enabled,bool),'ข้อมูลการสำรองอัตโนมัติไม่ถูกต้อง')
    require(isinstance(hour,int) and not isinstance(hour,bool) and 0<=hour<=23,'เวลาสำรองต้องเป็นชั่วโมง 0-23')
    require(isinstance(keep,int) and not isinstance(keep,bool) and 1<=keep<=90,'เก็บไฟล์สำรองอัตโนมัติได้ 1-90 ชุด')
    value = {'enabled':enabled,'hour':hour,'keep':keep}
    repository.save_setting(cd,SETTINGS_KEY,json.dumps(value))
    audit.record(cd,session['user_id'],'platform.backup_settings',
                 f"{'เปิด' if enabled else 'ปิด'} สำรองอัตโนมัติ · {hour:02d}:00 · เก็บ {keep} ชุด")
    cd.commit()
    return overview(cd)


def last(cd):
    try:
        return json.loads(repository.setting(cd,LAST_KEY) or 'null')
    except ValueError:
        return None


def files():
    """The backups in the folder, newest first."""
    where = folder()
    if not where.is_dir():
        return []
    found = []
    for path in where.iterdir():
        match = NAME.fullmatch(path.name)
        if match and path.is_file():
            stat = path.stat()
            found.append({'name':path.name,'kind':match[1],'size':stat.st_size,
                          'created_at':iso(dt.datetime.fromtimestamp(stat.st_mtime,dt.timezone.utc))})
    return sorted(found,key=lambda f:f['name'][-19:],reverse=True)


def overview(cd):
    from backend.utils import secret_box
    where = folder()
    data = D.DATA.resolve()
    return {'folder':str(where),'inside_data':data in where.parents or where==data,
            'same_disk':_same_disk(where,data),'from_environment':bool(os.environ.get('BOOKDOSE_BACKUP_DIR')),
            'settings':settings(cd),'last':last(cd),'files':files(),'running':_running.locked(),
            'key_id':secret_box.current_key_id()}


def _same_disk(where, data):
    probe = where if where.exists() else where.parent
    try:
        return os.stat(probe).st_dev==os.stat(data).st_dev
    except OSError:
        return True


def run(kind, by):
    """Make one backup now ('manual' or 'auto'); returns the result recorded as the last backup. Old automatic
    backups beyond `keep` go afterwards (manual ones are never removed)."""
    from backend.database.backup import make_backup
    require(_running.acquire(blocking=False),'กำลังสำรองข้อมูลอยู่ กรุณารอให้เสร็จก่อน',409)
    try:
        moment = utc_now().astimezone(THAI)
        name = f"bookdose-{kind}-{moment.strftime('%Y%m%d-%H%M%S')}.zip"
        where = folder()
        try:
            where.mkdir(parents=True,exist_ok=True)
            content = make_backup()
            with (where/name).open('xb') as out:
                out.write(content)
            result = {'at':now(),'ok':True,'name':name,'size':len(content),'kind':kind,'by':by}
        except (OSError,ValueError) as error:
            result = {'at':now(),'ok':False,'error':type(error).__name__,'kind':kind,'by':by}
        with D.control() as cd:
            repository.save_setting(cd,LAST_KEY,json.dumps(result,ensure_ascii=False))
            audit.record(cd,by,'platform.backup' if result['ok'] else 'platform.backup_failed',result.get('name',''),
                         f"{'อัตโนมัติ' if kind=='auto' else 'สั่งจากคอนโซล'}")
            cd.commit()
            keep = settings(cd)['keep']
        if result['ok']:
            for old in [f for f in files() if f['kind']=='auto'][keep:]:
                (where/old['name']).unlink(missing_ok=True)
        return result
    finally:
        _running.release()


def run_now(cd, session):
    result = run('manual',session['user_id'])
    require(result['ok'],f"สำรองข้อมูลไม่สำเร็จ ({result.get('error','')}) ตรวจพื้นที่ดิสก์และสิทธิ์เขียนโฟลเดอร์ {folder()}",500)
    return overview(cd)


def due(cd, moment=None):
    """An automatic backup is due: switched on, past today's hour (Thai time), and none made yet today."""
    cfg = settings(cd)
    if not cfg['enabled']:
        return False
    moment = (moment or utc_now()).astimezone(THAI)
    if moment.hour<cfg['hour']:
        return False
    today = moment.strftime('%Y%m%d')
    return not any(f['kind']=='auto' and NAME.fullmatch(f['name'])[2]==today for f in files())


def busy():
    return _running.locked()


def auto_round():
    """The day's automatic backup, started by the security worker once it is due (in its own thread)."""
    with D.control() as cd:
        if not due(cd):
            return None
    try:
        return run('auto','ระบบ')
    except Exception as error:      # a backup already running, or anything else: the next round tries again
        print(f'Automatic backup: {type(error).__name__}',flush=True)
        return None


def path_of(name):
    """The archive to download; only a backup this console lists."""
    require(isinstance(name,str) and NAME.fullmatch(name),'ไม่พบไฟล์สำรอง',404)
    path = folder()/name
    require(path.is_file(),'ไม่พบไฟล์สำรอง',404)
    return path
