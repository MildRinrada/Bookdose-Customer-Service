"""ฟีเจอร์ของระบบ: what the platform admin turns on or off for the whole platform at once (platform console → ตั้งค่า
ระบบ #features). Unlike tenant_features (model.FEATURES), which is one organization at a time, these change every
organization and every customer together.

- org_signup: anyone may create an organization from the sign-up page. Kept where it always was, the registration
  mail's `signup_enabled` (service.signup_open also needs the mailbox), and shown here with the others.
- customer_accounts: customers sign up and sign in with an account of their own (customers/, portal/). Off, every
  customer writes in as a guest from /support/<org>; accounts already made are kept, unused, until it is on again.
- no_rush: the ไม่รีบ button (portal/no_rush.py). Off, the button is not offered and promises already given stop
  moving anyone in the queue or any deadline.
- translate: แปลภาษาสองทาง (ai/translate.py). Off, no organization translates, whatever its own AI settings say; what
  each owner chose is kept for when it is on again.
- polish: เกลาข้อความ (ai/polish.py), the button in the composer. On unless the platform admin turns it off.
- work_status: สถานะการทำงาน (staff_prefs: status, working hours, leave). Off, everyone counts as available for new
  work and nobody sets a status; what members set is kept for when it is on again.

  platform_settings 'platform_switches'  JSON {key: bool}; a key never saved is its default (DEFAULT_ON, else off)."""
import json
import threading
import time

from backend.database import audit, db as D
from backend.modules.platform import repository
from backend.utils.validation import require

KEY = 'platform_switches'

# key: (what it is called, what it does)
SWITCHES = {
    'org_signup': ('สมัครสมาชิกองค์กรเอง',
                   'ใครก็สร้างองค์กรได้จากหน้าสมัครสมาชิก ปิดแล้วสร้างองค์กรได้จากหน้าองค์กรในคอนโซลนี้อย่างเดียว'),
    'customer_accounts': ('บัญชีลูกค้า',
                          'ลูกค้าสมัครและเข้าสู่ระบบด้วยบัญชีของตัวเอง ปิดแล้วลูกค้าติดต่อได้แบบไม่ต้องเข้าสู่ระบบอย่างเดียว บัญชีเดิมยังเก็บไว้'),
    'no_rush': ('ปุ่ม "ไม่รีบ"',
                'ลูกค้าที่รอคิวกดบอกได้ว่าตอบพรุ่งนี้ก็ได้ แล้วไปต่อท้ายคิว ปิดแล้วปุ่มหายและทุกคนกลับไปเรียงตามคิวปกติ'),
    'translate': ('แปลภาษาสองทาง (AI)',
                  'ลูกค้าพิมพ์ภาษาอื่น ทีมเห็นเป็นภาษาไทย และคำตอบแปลเป็นภาษาของลูกค้าก่อนส่ง เปิดแล้วแต่ละองค์กรยังต้องเปิดเองในตั้งค่า AI'),
    'work_status': ('สถานะการทำงานของทีม',
                    'สมาชิกตั้งสถานะพร้อมรับเรื่อง ไม่อยู่ หรือออฟไลน์ เวลาทำงาน และวันลา ระบบใช้แจกงานและบอกลูกค้าว่ามีคนอยู่ไหม ปิดแล้วถือว่าทุกคนพร้อมรับเรื่องเสมอ'),
    'polish': ('เกลาข้อความ (AI)',
               'ปุ่มในช่องพิมพ์ให้ AI ช่วยให้คำตอบสุภาพขึ้น สั้นลง หรือแก้คำผิดก่อนส่ง ใช้ได้เมื่อองค์กรเชื่อม AI และเปิด AI ช่วยร่างไว้'),
}
# Already in use everywhere before it had a switch: on until it is turned off.
DEFAULT_ON = {'polish'}

# Read on hot paths (every inbox list, every queue); the control database is opened again at most once a second.
_cache = {'at':0.0,'value':None}
_lock = threading.Lock()


def _saved(cd):
    value = repository.setting(cd,KEY)
    try:
        saved = json.loads(value) if value else {}
    except ValueError:
        saved = {}
    return {key:saved.get(key,key in DEFAULT_ON) is True for key in SWITCHES if key!='org_signup'}


def state(cd):
    """{key: on} for every switch."""
    from backend.modules.platform import service
    return {'org_signup':bool(service.registration_config(cd).get('signup_enabled')),**_saved(cd)}


def on(key):
    """Whether a switch is on, from anywhere (a tenant's code has no control connection of its own)."""
    with _lock:
        if _cache['value'] is None or time.monotonic()-_cache['at']>1:
            with D.control() as cd:
                _cache['value'] = state(cd)
            _cache['at'] = time.monotonic()
        return bool(_cache['value'].get(key))


def view(cd):
    from backend.modules.platform import service
    current = state(cd)
    return {'items':[{'key':key,'label':label,'detail':detail,'enabled':current[key]} for key,(label,detail) in SWITCHES.items()],
            # สมัครสมาชิกองค์กรเอง finishes with a link sent by email: it is only open once the mailbox works as well.
            'mail_ready':service.registration_ready(cd)}


def save(cd, session, body):
    key,enabled = body.get('key'),body.get('enabled')
    require(key in SWITCHES,'ไม่รู้จักฟีเจอร์นี้')
    require(enabled is True or enabled is False,'ค่าเปิด/ปิดไม่ถูกต้อง')
    D.begin(cd)
    if key=='org_signup':
        from backend.modules.platform import service
        cfg = service.registration_config(cd)
        repository.save_registration_mail(cd,json.dumps({**cfg,'signup_enabled':enabled}))
    else:
        repository.save_setting(cd,KEY,json.dumps({**_saved(cd),key:enabled}))
    audit.record(cd,session['user_id'],'platform.switch',key,'เปิด' if enabled else 'ปิด')
    cd.commit()
    with _lock:
        _cache['value'] = None
    return view(cd)
