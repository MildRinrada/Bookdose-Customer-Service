"""ส่งไฟล์สำรองออกนอกเครื่อง: every backup the console makes (backups.py) is copied, as soon as it is written, to a place
that does not die with this machine's disk. Two kinds of place:

  folder  a path on another disk, a network share or a cloud drive mounted on the server (Google Drive, OneDrive,
          rclone). Copied under a temporary name and renamed, so a half-copied file never looks complete.
  s3      S3-compatible storage: Amazon S3, Cloudflare R2, Backblaze B2, Wasabi, MinIO. One signed PUT per file
          (AWS Signature V4 with the standard library: nothing to install), path-style
          https://<endpoint>/<bucket>/<prefix><file>. The secret key is sealed in data/secrets like every credential.

The copy runs in its own thread, so neither the button nor the daily round waits for the network. What happened to the
last one is kept (LAST_KEY); a failure is on the overview's to-do list and emailed to the platform admins (watch.py).
When the daily round removes an old automatic backup here, the same file is removed there too, so both keep the same
number; a copy made by hand is never removed. The files are the same archives as here: databases and attachments, the
credentials inside sealed, never the key.

  backup_offsite       (platform setting) {kind: '' | 'folder' | 's3', folder, endpoint, region, bucket, prefix, access_key}
  backup_offsite_last  (platform setting) {at, ok, name, error}
  secrets/backup-offsite.json  {secret_key} (s3)"""
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import sys
import threading
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from backend.database import audit, db as D
from backend.modules.platform import repository
from backend.utils import secret_box
from backend.utils.dates import now, utc_now
from backend.utils.validation import require

SETTINGS_KEY = 'backup_offsite'
LAST_KEY = 'backup_offsite_last'
KINDS = ('','folder','s3')
FIELDS = ('kind','folder','endpoint','region','bucket','prefix','access_key')
PREFIX = re.compile(r'[A-Za-z0-9._\-/]{0,100}')
BUCKET = re.compile(r'[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]')
TEST_NAME = 'bookdose-offsite-test.txt'
TIMEOUT = 600
_sending = threading.Lock()


def _secret_path():
    return D.DATA/'secrets'/'backup-offsite.json'


def _secret_key():
    try:
        text = secret_box.read_file(_secret_path())
        return (json.loads(text) if text else {}).get('secret_key','')
    except (OSError,ValueError,AttributeError):
        return ''


def settings(cd):
    try:
        saved = json.loads(repository.setting(cd,SETTINGS_KEY) or '{}')
    except ValueError:
        saved = {}
    return {name:str(saved.get(name) or '') for name in FIELDS}


def last(cd):
    try:
        return json.loads(repository.setting(cd,LAST_KEY) or 'null')
    except ValueError:
        return None


def view(cd):
    """What the console shows: the settings (never the secret), whether the secret is in place, the last copy."""
    cfg = settings(cd)
    same_disk = False
    if cfg['kind']=='folder' and cfg['folder']:
        try:
            same_disk = os.stat(cfg['folder']).st_dev==os.stat(D.DATA).st_dev
        except OSError:
            same_disk = False
    return {'settings':cfg,'secret_saved':bool(_secret_key()),'last':last(cd),'sending':_sending.locked(),'same_disk':same_disk}


def _text(body, name, maximum):
    value = body.get(name,'')
    require(isinstance(value,str) and len(value.strip())<=maximum,'ข้อมูลปลายทางไม่ถูกต้อง')
    return value.strip()


def save(cd, session, body):
    """{kind, folder | endpoint, region, bucket, prefix, access_key, secret_key (blank keeps the saved one)}."""
    kind = body.get('kind','')
    require(kind in KINDS,'เลือกปลายทางไม่ถูกต้อง')
    cfg = {name:'' for name in FIELDS}
    cfg['kind'] = kind
    secret = None
    if kind=='folder':
        folder = _text(body,'folder',500)
        require(folder and Path(folder).is_absolute(),'ใส่ตำแหน่งโฟลเดอร์แบบเต็ม เช่น D:\\bookdose-backups หรือ /mnt/backup')
        where,data = Path(folder).resolve(),D.DATA.resolve()
        require(where!=data and data not in where.parents,'โฟลเดอร์ปลายทางต้องไม่อยู่ในโฟลเดอร์ข้อมูล')
        from backend.modules.platform import backups
        require(where!=backups.folder(),'โฟลเดอร์ปลายทางต้องไม่ใช่โฟลเดอร์สำรองเดิม')
        require(where.is_dir(),'ไม่พบโฟลเดอร์นี้บนเซิร์ฟเวอร์ สร้างหรือเชื่อมต่อไดรฟ์ก่อน')
        cfg['folder'] = str(where)
    elif kind=='s3':
        endpoint = _text(body,'endpoint',300).rstrip('/')
        parts = urlsplit(endpoint)
        require(parts.scheme=='https' and parts.netloc and parts.path in ('',),'Endpoint ต้องขึ้นต้นด้วย https:// และไม่มีส่วนต่อท้าย เช่น https://s3.ap-southeast-1.amazonaws.com')
        bucket,prefix = _text(body,'bucket',63),_text(body,'prefix',100).lstrip('/')
        require(BUCKET.fullmatch(bucket),'ชื่อ Bucket ใช้ a-z ตัวเลข จุด และขีดกลาง 3-63 ตัว')
        require(PREFIX.fullmatch(prefix),'โฟลเดอร์ใน Bucket ใช้ได้เฉพาะ A-Z a-z ตัวเลข . _ - /')
        if prefix and not prefix.endswith('/'):
            prefix += '/'
        access = _text(body,'access_key',200)
        require(access,'ใส่ Access key')
        typed = body.get('secret_key','')
        require(isinstance(typed,str) and len(typed)<=200,'Secret key ไม่ถูกต้อง')
        require(typed.strip() or _secret_key(),'ใส่ Secret key')
        secret = typed.strip() or None
        cfg.update(endpoint=endpoint,region=_text(body,'region',40) or 'auto',bucket=bucket,prefix=prefix,access_key=access)
    if secret:
        secret_box.write_file(_secret_path(),json.dumps({'secret_key':secret}))
    elif kind!='s3':
        _secret_path().unlink(missing_ok=True)
    repository.save_setting(cd,SETTINGS_KEY,json.dumps(cfg,ensure_ascii=False))
    # A new place starts without a result: the old one's failure is not this one's.
    repository.save_setting(cd,LAST_KEY,'null')
    audit.record(cd,session['user_id'],'platform.backup_offsite',
                 {'folder':f"โฟลเดอร์ {cfg['folder']}",'s3':f"S3 {cfg['endpoint']}/{cfg['bucket']}/{cfg['prefix']}"}.get(kind,'ปิด'))
    cd.commit()
    return view(cd)


# Sending
def _sign(method, url, payload_hash, cfg, secret):
    """The headers of an AWS Signature V4 request (service s3) for url."""
    parts = urlsplit(url)
    stamp = utc_now().astimezone(dt.timezone.utc)
    amz_date,day = stamp.strftime('%Y%m%dT%H%M%SZ'),stamp.strftime('%Y%m%d')
    region = cfg['region'] or 'auto'
    headers = {'host':parts.netloc,'x-amz-content-sha256':payload_hash,'x-amz-date':amz_date}
    signed = ';'.join(sorted(headers))
    canonical = '\n'.join([method,parts.path or '/','',''.join(f'{k}:{headers[k]}\n' for k in sorted(headers)),signed,payload_hash])
    scope = f'{day}/{region}/s3/aws4_request'
    to_sign = '\n'.join(['AWS4-HMAC-SHA256',amz_date,scope,hashlib.sha256(canonical.encode()).hexdigest()])
    key = ('AWS4'+secret).encode()
    for part in (day,region,'s3','aws4_request'):
        key = hmac.new(key,part.encode(),hashlib.sha256).digest()
    signature = hmac.new(key,to_sign.encode(),hashlib.sha256).hexdigest()
    return {'x-amz-content-sha256':payload_hash,'x-amz-date':amz_date,
            'Authorization':f"AWS4-HMAC-SHA256 Credential={cfg['access_key']}/{scope}, SignedHeaders={signed}, Signature={signature}"}


def _url(cfg, name):
    return f"{cfg['endpoint']}/{cfg['bucket']}/{cfg['prefix']}{name}"


def _s3(method, cfg, name, path=None, content=b''):
    secret = _secret_key()
    require(secret,'ยังไม่ได้ใส่ Secret key')
    if path is not None:
        digest = hashlib.sha256()
        with open(path,'rb') as source:
            for chunk in iter(lambda: source.read(1024*1024),b''):
                digest.update(chunk)
        payload_hash,size = digest.hexdigest(),os.path.getsize(path)
    else:
        payload_hash,size = hashlib.sha256(content).hexdigest(),len(content)
    url = _url(cfg,name)
    headers = _sign(method,url,payload_hash,cfg,secret)
    if method=='PUT':
        headers['Content-Length'] = str(size)
    body = open(path,'rb') if path is not None else (content if method=='PUT' else None)
    try:
        request = urllib.request.Request(url,data=body,method=method,headers=headers)
        with urllib.request.urlopen(request,timeout=TIMEOUT) as answer:
            answer.read()
    except urllib.error.HTTPError as error:
        raise OSError(f'HTTP {error.code}') from None
    finally:
        if hasattr(body,'close'):
            body.close()


def _copy(cfg, path):
    if cfg['kind']=='folder':
        target = Path(cfg['folder'])/path.name
        partial = target.with_name(target.name+'.part')
        shutil.copyfile(path,partial)
        os.replace(partial,target)
    else:
        _s3('PUT',cfg,path.name,path=path)


def _remove(cfg, name):
    if cfg['kind']=='folder':
        (Path(cfg['folder'])/name).unlink(missing_ok=True)
    else:
        _s3('DELETE',cfg,name)


def _error(error):
    text = str(error) if str(error).startswith('HTTP ') else type(error).__name__
    return text[:120]


def send(path):
    """Copy one backup file there now (in the caller's thread); records and returns the result, None when off."""
    with D.control() as cd:
        cfg = settings(cd)
    if not cfg['kind']:
        return None
    with _sending:
        try:
            _copy(cfg,path)
            result = {'at':now(),'ok':True,'name':path.name}
        except Exception as error:
            result = {'at':now(),'ok':False,'name':path.name,'error':_error(error)}
            print(f'[{now()}] Offsite backup: {result["error"]}',file=sys.stderr,flush=True)
    with D.control() as cd:
        repository.save_setting(cd,LAST_KEY,json.dumps(result,ensure_ascii=False))
        if not result['ok']:
            audit.record(cd,'ระบบ','platform.backup_offsite_failed',path.name,result['error'])
    return result


def send_later(path):
    """send() in its own thread: the backup is finished here already, the network can take its time."""
    threading.Thread(target=send,args=(path,),name='bookdose-offsite',daemon=True).start()


def forget_later(names):
    """The old automatic backups removed here go there too (best effort; a miss only leaves a file there)."""
    def run():
        with D.control() as cd:
            cfg = settings(cd)
        if not cfg['kind']:
            return
        for name in names:
            try:
                _remove(cfg,name)
            except Exception as error:
                print(f'[{now()}] Offsite backup removal: {_error(error)}',file=sys.stderr,flush=True)
    if names:
        threading.Thread(target=run,name='bookdose-offsite-prune',daemon=True).start()


def test(cd):
    """Write a small file there and remove it: proves the place is reachable and writable, before a real backup."""
    cfg = settings(cd)
    require(cfg['kind'],'ยังไม่ได้เลือกปลายทาง')
    try:
        if cfg['kind']=='folder':
            probe = Path(cfg['folder'])/TEST_NAME
            probe.write_text('Bookdose offsite test\n')
            probe.unlink()
        else:
            _s3('PUT',cfg,TEST_NAME,content=b'Bookdose offsite test\n')
            _s3('DELETE',cfg,TEST_NAME)
    except Exception as error:
        require(False,f'ส่งไปปลายทางไม่สำเร็จ ({_error(error)}) ตรวจตำแหน่ง สิทธิ์เขียน หรือกุญแจ',502)
    return {'ok':True}


def send_newest(cd):
    """ส่งไฟล์ล่าสุดตอนนี้: the newest backup here, in the background."""
    from backend.modules.platform import backups
    require(settings(cd)['kind'],'ยังไม่ได้เลือกปลายทาง')
    require(not _sending.locked(),'กำลังส่งไฟล์อยู่ กรุณารอให้เสร็จก่อน',409)
    found = [f for f in backups.files() if f['kind'] in ('auto','manual','before')]
    require(found,'ยังไม่มีไฟล์สำรอง กดสำรองตอนนี้ก่อน',409)
    send_later(backups.folder()/found[0]['name'])
    return {'ok':True,'name':found[0]['name']}
