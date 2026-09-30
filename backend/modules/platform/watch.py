"""Emails the platform admins when the server needs someone, so nobody has to keep the console open: a background
worker stopped, the disk is nearly full, requests suddenly fail, or the last backup failed. Checked every minute by the security worker; each
kind is emailed at most once every COOLDOWN_HOURS while it lasts, and again once it comes back after clearing. Only
when the platform's mailbox is set up."""
import json
import shutil
import sys
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from backend.database import db as D
from backend.extensions import monitor
from backend.modules.platform import repository
from backend.utils.dates import now, utc_now

STATE = 'system_alert_mail'
COOLDOWN_HOURS = 6
ERROR_MINUTES = 15
ERROR_LIMIT = 20              # server errors within ERROR_MINUTES that count as a spike
DISK_SHARE = 0.1              # free space below this share of the disk
WORKERS = {'ai':'งาน AI','channels':'ส่งข้อความ LINE / Facebook','email':'รับ-ส่งอีเมล','automation':'ระบบอัตโนมัติ',
           'security':'ความปลอดภัยและการสำรองข้อมูล'}


def conditions(cd):
    """{kind: sentence} of what is wrong right now."""
    from backend.modules.platform import backups
    found = {}
    # The last backup attempt failed (made by hand, daily, or before a restore); clears once one succeeds.
    last = backups.last(cd)
    if last and not last.get('ok'):
        kind = {'auto':'อัตโนมัติ','before':'ก่อนกู้คืน'}.get(last.get('kind'),'ที่สั่งจากคอนโซล')
        found['backup'] = f"สำรองข้อมูล{kind}ไม่สำเร็จ ({last.get('error') or 'ไม่ทราบสาเหตุ'}) ตรวจพื้นที่ดิสก์และสิทธิ์เขียนโฟลเดอร์ {backups.folder()}"
    snap = monitor.snapshot()
    stopped = [w['name'] for w in snap['workers'] if not w['running']]
    if stopped:
        found['workers'] = 'งานเบื้องหลังหยุด: '+', '.join(WORKERS.get(name,name) for name in stopped)
    disk = shutil.disk_usage(D.DATA)
    if disk.free<disk.total*DISK_SHARE:
        found['disk'] = f'พื้นที่ดิสก์เหลือ {disk.free/1024**3:.1f} GB จาก {disk.total/1024**3:.1f} GB (น้อยกว่า 10%)'
    errors = monitor.server_errors_since(ERROR_MINUTES)
    if errors>=ERROR_LIMIT:
        found['errors'] = f'คำขอผิดพลาดจากเซิร์ฟเวอร์ {errors} ครั้งใน {ERROR_MINUTES} นาทีล่าสุด'
    return found


def run():
    """One round: email what newly needs someone; returns the kinds emailed."""
    from backend.modules.platform import service as platform
    from backend.modules.security.events import parse
    with D.control() as cd:
        found = conditions(cd)
        try:
            state = json.loads(repository.setting(cd,STATE) or '{}')
        except ValueError:
            state = {}
        # A condition that cleared may be emailed again the next time it happens.
        state = {kind:at for kind,at in state.items() if kind in found}
        due = {}
        # Without the mailbox nothing is marked as told: it goes out once the mailbox is set up.
        if platform.registration_ready(cd):
            for kind,sentence in found.items():
                last = parse(state.get(kind))
                if not last or (utc_now()-last).total_seconds()>=COOLDOWN_HOURS*3600:
                    due[kind] = sentence
                    state[kind] = now()
        repository.save_setting(cd,STATE,json.dumps(state))
        cd.commit()
        if not due:
            return []
        recipients = [a['email'] for a in repository.platform_admins(cd)]
        cfg,secret = platform.registration_config(cd),platform.registration_secret()
    _send(recipients,cfg,secret,due)
    return sorted(due)


def _send(recipients, cfg, secret, due):
    from backend.extensions import channel_transport as T
    lines = '\n'.join(f'- {sentence}' for sentence in due.values())
    for recipient in recipients:
        try:
            mail = EmailMessage()
            mail['Subject'] = 'เซิร์ฟเวอร์ Bookdose ต้องการการดูแล'
            mail['From'],mail['To'] = cfg['address'],recipient
            mail['Date'],mail['Message-ID'],mail['Auto-Submitted'] = formatdate(localtime=False,usegmt=True),make_msgid(),'auto-generated'
            mail.set_content(f"ระบบพบสิ่งที่ต้องตรวจสอบ\n\n{lines}\n\n"
                             f"ดูรายละเอียดที่ คอนโซลระบบกลาง → ภาพรวมระบบ:\n{cfg.get('public_base_url','').rstrip('/')}/platform/system\n\n"
                             f"อีเมลนี้ส่งถึงผู้ดูแลแพลตฟอร์มทุกคน เรื่องเดิมจะแจ้งซ้ำไม่เกินทุก {COOLDOWN_HOURS} ชั่วโมง\n")
            T.send_email(cfg,secret,recipient,mail)
        except Exception as error:
            print(f'[{now()}] System alert mail: {type(error).__name__}',file=sys.stderr,flush=True)
