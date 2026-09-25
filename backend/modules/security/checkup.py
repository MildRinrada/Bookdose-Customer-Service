"""ตรวจสุขภาพความปลอดภัย (ความปลอดภัย → ตรวจสุขภาพ): the settings nobody should have to remember to look at, checked
when the platform admin opens the tab. Each check says ok, warning or critical (info: cannot apply here), why it
matters and where to fix it:

  headers    the security headers a browser receives from the web site's own page (fetched from the site, as a visitor)
  https      the HTTPS certificate: valid, and how many days are left
  key        the key that seals every channel's tokens is set apart from the data folder (BOOKDOSE_SECRET_KEY)
  turnstile  the bot check on the public chat form is on and has both keys
  admins     active organizations nobody can run (no admin of their own)
  quota      active organizations without a storage ceiling

The site is the platform's public address (ตั้งค่า → อีเมล: public_base_url); a copy on this machine without one is
checked at the address the admin is using. Only the page's headers and certificate are read, nothing is sent."""
import http.client
import socket
import ssl
import time
from urllib.parse import urlsplit

from backend.utils.dates import now

TIMEOUT = 5
PAGE = '/login'
HSTS_MIN_SECONDS = 180*24*3600
CERT_WARN_DAYS = 30
CERT_URGENT_DAYS = 14
LOCAL = ('localhost','127.0.0.1')
SAFE_REFERRER = ('no-referrer','same-origin','strict-origin','strict-origin-when-cross-origin')


def _check(key, level, title, detail, action=None, items=None):
    return {'key':key,'level':level,'title':title,'detail':detail,'action':action,'items':items or []}


def _action(label, href):
    return {'label':label,'href':href}


def site(cd, hint=''):
    """The address checked: the platform's public one, else `hint` (the local address the admin is using)."""
    from backend.modules.platform import service
    return (service.registration_config(cd).get('public_base_url') or '').strip().rstrip('/') or hint


def fetch(base):
    """(status, headers with lower-case names, certificate or None) of the site's sign-in page."""
    url = urlsplit(base)
    secure = url.scheme=='https'
    port = url.port or (443 if secure else 80)
    conn = (http.client.HTTPSConnection(url.hostname,port,timeout=TIMEOUT,context=ssl.create_default_context()) if secure
            else http.client.HTTPConnection(url.hostname,port,timeout=TIMEOUT))
    try:
        conn.request('GET',PAGE,headers={'User-Agent':'Bookdose security checkup','Accept':'text/html'})
        response = conn.getresponse()
        cert = conn.sock.getpeercert() if secure else None
        headers = {name.lower():value for name,value in response.getheaders()}
        return response.status,headers,cert
    finally:
        conn.close()


def _hsts_ok(value):
    for part in value.split(';'):
        name,_,number = part.strip().partition('=')
        if name.lower()=='max-age':
            return number.strip().isdigit() and int(number)>=HSTS_MIN_SECONDS
    return False


def _headers(headers, secure):
    wanted = [
        ('Content-Security-Policy','content-security-policy',lambda v:'frame-ancestors' in v,
         'กันสคริปต์แปลกปลอม และการนำหน้าเว็บไปฝังในเว็บอื่น'),
        ('X-Content-Type-Options','x-content-type-options',lambda v:v.strip().lower()=='nosniff',
         'กันเบราว์เซอร์เดาชนิดไฟล์เองจนไฟล์กลายเป็นสคริปต์'),
        ('Referrer-Policy','referrer-policy',lambda v:v.strip().lower() in SAFE_REFERRER,
         'ไม่ส่งที่อยู่หน้า (ซึ่งอาจมีลิงก์ลับ) ไปให้เว็บอื่น'),
        ('X-Frame-Options','x-frame-options',lambda v:v.strip().upper() in ('DENY','SAMEORIGIN'),
         'กันการหลอกให้กดปุ่มในหน้าที่ถูกซ้อนไว้ (clickjacking) ในเบราว์เซอร์รุ่นเก่า'),
    ]
    if secure:
        wanted.append(('Strict-Transport-Security','strict-transport-security',_hsts_ok,
                       'บังคับให้เบราว์เซอร์ใช้ HTTPS ทุกครั้ง อย่างน้อย 180 วัน'))
    items = []
    for label,name,good,why in wanted:
        value = headers.get(name,'')
        items.append({'label':label,'ok':bool(value) and good(value),'note':why,'value':value[:300]})
    missing = [i['label'] for i in items if not i['ok']]
    if not missing:
        return _check('headers','ok',f'Security header ครบ {len(items)} ตัว','เบราว์เซอร์ได้รับ header ป้องกันครบทุกตัวจากหน้าเว็บ',items=items)
    hint = ('ตั้งที่ reverse proxy หน้าเว็บ (เช่น Nginx หรือ Cloudflare)' if 'Strict-Transport-Security' in missing and len(missing)==1
            else 'ตรวจว่า reverse proxy หน้าเว็บไม่ได้ลบ header ที่เว็บส่งมา')
    return _check('headers','warning',f'Security header ขาดหรือไม่ถูกต้อง {len(missing)} ตัว',
                  f"{', '.join(missing)} · {hint}",items=items)


def _certificate(cert):
    left = int((ssl.cert_time_to_seconds(cert['notAfter'])-time.time())//86400)
    issuer = dict(x[0] for x in cert.get('issuer',()) if x).get('organizationName','')
    until = cert['notAfter']
    by = f' · ออกโดย {issuer}' if issuer else ''
    if left<0:
        return _check('https','critical','ใบรับรอง HTTPS หมดอายุแล้ว',f'หมดเมื่อ {until}{by} · ผู้ใช้จะเข้าเว็บไม่ได้ ต่ออายุทันที')
    if left<CERT_URGENT_DAYS:
        return _check('https','critical',f'ใบรับรอง HTTPS เหลือ {left} วัน',f'หมดอายุ {until}{by} · ต่ออายุก่อนหมด ถ้าต่ออัตโนมัติอยู่ ตรวจว่ายังทำงาน')
    if left<CERT_WARN_DAYS:
        return _check('https','warning',f'ใบรับรอง HTTPS เหลือ {left} วัน',f'หมดอายุ {until}{by} · ใกล้หมดแล้ว ตรวจว่าการต่ออายุอัตโนมัติทำงาน')
    return _check('https','ok',f'ใบรับรอง HTTPS เหลือ {left} วัน',f'หมดอายุ {until}{by}')


def _website(base):
    """The headers and HTTPS checks, from one visit to the site."""
    if not base:
        missing = _check('headers','warning','ยังไม่ได้ตั้งโดเมนเว็บไซต์','ตั้งโดเมนเว็บไซต์ในการตั้งค่าอีเมลของระบบ แล้วระบบจะตรวจ header และใบรับรองจากโดเมนนั้น',
                         _action('ตั้งโดเมน','/platform/settings#email'))
        return [missing,_check('https','warning','ตรวจใบรับรอง HTTPS ไม่ได้','ยังไม่ได้ตั้งโดเมนเว็บไซต์')]
    url = urlsplit(base)
    secure = url.scheme=='https'
    local = url.hostname in LOCAL
    try:
        status,headers,cert = fetch(base)
    except ssl.SSLCertVerificationError as error:
        reason = error.verify_message or 'ใบรับรองไม่ถูกต้อง'
        return [_check('headers','warning','ตรวจ security header ไม่ได้','เปิดหน้าเว็บผ่าน HTTPS ไม่ได้เพราะใบรับรองไม่ผ่าน'),
                _check('https','critical','ใบรับรอง HTTPS ไม่ผ่านการตรวจ',f'{base}: {reason} · เบราว์เซอร์จะเตือนผู้ใช้ว่าเว็บไม่ปลอดภัย')]
    except (OSError,http.client.HTTPException,socket.timeout) as error:
        why = f'เปิด {base}{PAGE} ไม่ได้ ({type(error).__name__}) · ตรวจว่าโดเมนชี้มาที่เซิร์ฟเวอร์นี้ และเซิร์ฟเวอร์ออกอินเทอร์เน็ตได้'
        return [_check('headers','warning','ตรวจ security header ไม่ได้',why),_check('https','warning','ตรวจใบรับรอง HTTPS ไม่ได้',why)]
    found = [_headers(headers,secure)]
    if status>=400:
        found[0]['detail'] += f' · หน้าเว็บตอบ {status}'
    if secure and cert:
        found.append(_certificate(cert))
    elif local:
        found.append(_check('https','info','เครื่องนี้ใช้ HTTP บน localhost','ตรวจใบรับรองได้เมื่อเปิดใช้ด้วยโดเมน HTTPS จริง'))
    else:
        found.append(_check('https','critical','เว็บไซต์ยังไม่ได้ใช้ HTTPS','รหัสผ่านและข้อความของลูกค้าส่งผ่านอินเทอร์เน็ตโดยไม่เข้ารหัส',
                            _action('ตั้งโดเมน','/platform/settings#email')))
    return found


def _key(cd):
    from backend.modules.platform import health, repository
    from backend.utils import secret_box
    if secret_box.key_source()=='environment':
        return _check('key','ok','กุญแจเข้ารหัสตั้งแยกจากโฟลเดอร์ข้อมูลแล้ว',
                      f'ใช้ BOOKDOSE_SECRET_KEY (รหัส {secret_box.current_key_id()}) ใครได้โฟลเดอร์ข้อมูลหรือไฟล์สำรองไปก็เปิด token ไม่ได้')
    saved = repository.setting(cd,health.KEY_SAVED)==secret_box.current_key_id()
    return _check('key','warning','กุญแจเข้ารหัสอยู่ในโฟลเดอร์ข้อมูล',
                  f'ไฟล์ data/keys/secret.key (รหัส {secret_box.current_key_id()}) อยู่ที่เดียวกับข้อมูลที่มันเข้ารหัส ใครได้โฟลเดอร์นี้ไปก็เปิด token ได้ · '
                  'ตั้ง BOOKDOSE_SECRET_KEY ในสภาพแวดล้อมของเซิร์ฟเวอร์แทน'+(' · คุณยืนยันแล้วว่าเก็บสำเนากุญแจไว้นอกเครื่อง' if saved else ''))


def _turnstile(cd):
    from backend.extensions import turnstile
    cfg = turnstile.config(cd)
    action = _action('ตั้งค่า Turnstile','/platform/settings#turnstile')
    if turnstile.ready(cd):
        return _check('turnstile','ok','Turnstile เปิดอยู่','ฟอร์มเริ่มแชทของลูกค้าทั่วไปต้องผ่านการตรวจบอทก่อนส่ง')
    if cfg['enabled']:
        return _check('turnstile','warning','Turnstile เปิดไว้แต่คีย์ไม่ครบ','ยังไม่ได้ตรวจบอทจริง ใส่ Site Key และ Secret Key ให้ครบ',action)
    return _check('turnstile','warning','Turnstile ยังไม่เปิด','ใครก็ส่งฟอร์มเริ่มแชทได้โดยไม่ต้องผ่านการตรวจบอท มีแค่การจำกัดจำนวนครั้งต่อ IP',action)


def _organizations(cd):
    from backend.modules.organization import repository as organization
    from backend.modules.platform import repository
    active = [o for o in repository.list_with_member_count(cd) if o['status']=='active']
    lonely = [o for o in active if not organization.organization_admins(cd,o['id'])]
    open_ended = [o for o in active if not int(o['quota_mb'] or 0)]
    admins = (_check('admins','critical',f'องค์กรที่ไม่มีผู้ดูแล {len(lonely)} แห่ง',
                     'ไม่มีใครตั้งค่าช่องทาง ทีม หรือปิดสิทธิ์ของสมาชิกที่ลาออกได้ เชิญผู้ดูแลให้แต่ละองค์กร',
                     items=[{'label':o['name'],'ok':False,'href':f"/platform/organizations?admin={o['id']}",'link':'เชิญผู้ดูแล'} for o in lonely])
              if lonely else _check('admins','ok','ทุกองค์กรมีผู้ดูแล',f'องค์กรที่ใช้งานอยู่ {len(active)} แห่ง มีผู้ดูแลของตัวเองทุกแห่ง'))
    quota = (_check('quota','warning',f'องค์กรที่ไม่มีโควตาพื้นที่ {len(open_ended)} แห่ง',
                    'องค์กรที่ไม่มีโควตาใช้ดิสก์ได้ไม่จำกัด แห่งเดียวก็ทำให้ดิสก์เต็มจนทุกองค์กรเขียนข้อมูลไม่ได้',
                    items=[{'label':o['name'],'ok':False,'href':f"/platform/organizations/{o['id']}",'link':'กำหนดโควตา'} for o in open_ended])
             if open_ended else _check('quota','ok','ทุกองค์กรมีโควตาพื้นที่',f'องค์กรที่ใช้งานอยู่ {len(active)} แห่ง มีเพดานพื้นที่ทุกแห่ง'))
    return [admins,quota]


def run(cd, hint=''):
    base = site(cd,hint)
    checks = [*_website(base),_key(cd),_turnstile(cd),*_organizations(cd)]
    counts = {level:sum(1 for c in checks if c['level']==level) for level in ('ok','warning','critical','info')}
    return {'checked_at':now(),'site':base,'checks':checks,'counts':counts}
