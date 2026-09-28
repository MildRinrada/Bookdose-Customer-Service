"""ข้อมูล IP: the country an address is in, the network (ASN) it belongs to, and whether that network rents out servers
(a cloud, a hosting company, the exit of a VPN), from free databases kept on this server. No address a user comes from
is sent anywhere to be looked up.

Sources: DB-IP's IP to Country Lite and IP to ASN Lite (monthly, free, CC BY 4.0: the console credits "IP Geolocation
by DB-IP"). Nothing is downloaded until a platform admin downloads them once (คอนโซล → ความปลอดภัย → ตั้งค่า); from
then on the security worker keeps them up to date each month. Until then every lookup answers None and nothing
behaves differently.

A cloud or VPN address is a signal, never a verdict: people use VPNs at work and for privacy. It makes a guest's
daily count of new chats smaller (guest/blocks.py), and is shown beside addresses in the console and in the email
about a platform admin's sign-in from a new place (sign_in_alerts.py). Nothing is refused for it alone.

Storage: data/ip-intel/<month>-<stamp>.sqlite3, a new file for each update so a lookup in progress is never cut off
(old files go once nothing holds them), and platform_settings 'ip_intel' naming the file in use. Backups leave it out:
it can be downloaded again."""
import csv
import gzip
import io
import ipaddress
import json
import re
import socket
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request

from backend.database import audit, db as D
from backend.utils.dates import after, now, utc_now
from backend.utils.validation import require

SOURCE = 'https://download.db-ip.com/free/dbip-{kind}-lite-{month}.csv.gz'
CREDIT = 'IP Geolocation by DB-IP'
CREDIT_URL = 'https://db-ip.com'
SETTING = 'ip_intel'
TIMEOUT = 60
MAX_DOWNLOAD = 200*1024*1024
# A download this small is not the database (an error page, a cut transfer): the one in use is kept.
MIN_ROWS = 50000
RETRY_HOURS = 6
_running = threading.Lock()

# Networks that rent out servers. The well-known ones by number; the rest by words in the network's registered name.
HOSTING_ASNS = frozenset({
    16509, 14618, 8987,             # Amazon (AWS)
    15169, 396982, 19527,           # Google, Google Cloud
    8075, 8068,                     # Microsoft (Azure)
    31898,                          # Oracle Cloud
    14061,                          # DigitalOcean
    63949,                          # Linode / Akamai
    20473,                          # Vultr (Choopa)
    16276,                          # OVHcloud
    24940,                          # Hetzner
    51167,                          # Contabo
    12876,                          # Scaleway
    60781, 28753, 59253,            # Leaseweb
    45102, 37963,                   # Alibaba Cloud
    132203, 45090,                  # Tencent Cloud
    13335, 209242,                  # Cloudflare (and its WARP VPN)
    9009,                           # M247, the exit of many VPNs
    212238,                         # Datacamp (CDN77), the exit of many VPNs
    62240, 40676, 21859, 199524,    # Clouvider, Psychz, Zenlayer, G-Core
    36352, 55286, 46606, 26496,     # ColoCrossing, B2 Net (Server Mania), Unified Layer, GoDaddy
    397423, 206092, 207990, 136787, # Tier.Net, IPXO, HostRoyale, TEFINCOM (NordVPN)
})
HOSTING_WORDS = re.compile(r'\b(hosting|host|hosted|cloud|data ?cent(er|re)|datacamp|servers?|vps|colo(cation)?|dedicated|vpn|proxy)\b',re.I)


def _folder():
    return D.DATA/'ip-intel'


def _packed(text):
    """The address as 16 bytes (an IPv4 one mapped into IPv6), so both kinds sort together; None when not an address."""
    text = str(text or '').strip()
    try:
        return b'\x00'*10+b'\xff\xff'+socket.inet_aton(text) if '.' in text and ':' not in text else socket.inet_pton(socket.AF_INET6,text)
    except (OSError,ValueError):
        return None


def hosting(asn, org):
    return int(asn) in HOSTING_ASNS or bool(HOSTING_WORDS.search(org or ''))


# The database in use
def _setting(cd):
    row = cd.execute('SELECT value FROM platform_settings WHERE key=?',(SETTING,)).fetchone()
    try:
        return json.loads(row[0]) if row else None
    except ValueError:
        return None


def _save(cd, value):
    cd.execute('INSERT INTO platform_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
               (SETTING,json.dumps(value,ensure_ascii=False)))
    cd.commit()


_current = {'file':None,'checked':0.0,'data':None}


def _file():
    """The database file in use, or None (read again at most every 10 seconds, and whenever the data folder moved)."""
    moment = time.monotonic()
    if moment-_current['checked']>10 or _current['data']!=D.DATA:
        with D.control() as cd:
            value = _setting(cd) or {}
        name = value.get('file')
        path = _folder()/name if name else None
        _current.update(file=path if path and path.is_file() else None,checked=moment,data=D.DATA)
    return _current['file']


def _forget_cache():
    _current.update(file=None,checked=0.0,data=None)


def _open():
    path = _file()
    return sqlite3.connect(f'file:{path.as_posix()}?mode=ro',uri=True) if path else None


def _find(db, packed):
    country = db.execute('SELECT code,end FROM country WHERE start<=? ORDER BY start DESC LIMIT 1',(packed,)).fetchone()
    network = db.execute('''SELECT a.asn,a.end,o.name,o.hosting FROM asn a LEFT JOIN org o ON o.asn=a.asn
                            WHERE a.start<=? ORDER BY a.start DESC LIMIT 1''',(packed,)).fetchone()
    code = country[0] if country and country[1]>=packed and country[0] not in ('ZZ','') else ''
    found = network if network and network[1]>=packed else None
    if not code and not found:
        return None
    return {'country':code,'asn':found[0] if found else None,'org':(found[2] or '') if found else '','hosting':bool(found and found[3])}


def lookup(ip):
    """{'country','asn','org','hosting'} of a public address, or None (no database yet, a private address, unknown)."""
    return describe([ip]).get(str(ip or '').strip())


def describe(ips):
    """{ip: info} for the addresses that are known (lookup() for many, one connection)."""
    wanted = {}
    for ip in ips:
        text = str(ip or '').strip()
        try:
            address = ipaddress.ip_address(text)
        except ValueError:
            continue
        if address.is_global:
            wanted[text] = _packed(text)
    if not wanted:
        return {}
    try:
        db = _open()
    except sqlite3.Error:
        return {}
    if not db:
        return {}
    found = {}
    try:
        for text,packed in wanted.items():
            info = _find(db,packed)
            if info:
                found[text] = info
    except sqlite3.Error:
        return {}
    finally:
        db.close()
    return found


# Downloading and building
def _month(offset=0):
    moment = utc_now()
    year,month = moment.year,moment.month-offset
    while month<1:
        year,month = year-1,month+12
    return f'{year:04d}-{month:02d}'


def _download(url):
    """The gzip file's bytes (refused beyond MAX_DOWNLOAD)."""
    request = urllib.request.Request(url,headers={'User-Agent':'Bookdose-Customer-Service'})
    with urllib.request.urlopen(request,timeout=TIMEOUT) as answer:
        data = answer.read(MAX_DOWNLOAD+1)
    require(len(data)<=MAX_DOWNLOAD,'ไฟล์ฐานข้อมูล IP ใหญ่ผิดปกติ',502)
    return data


def fetch():
    """(month, country gzip, asn gzip): this month's files, or last month's early in a month before they are out."""
    for offset in (0,1):
        month = _month(offset)
        try:
            return month,_download(SOURCE.format(kind='country',month=month)),_download(SOURCE.format(kind='asn',month=month))
        except urllib.error.HTTPError as error:
            if error.code!=404 or offset:
                raise
    raise RuntimeError('no database')


def _rows(data):
    with gzip.open(io.BytesIO(data),'rt',encoding='utf-8',newline='') as text:
        yield from csv.reader(text)


def build(month, country_gz, asn_gz):
    """A new database file from the two downloads; returns (file name, countries, networks). Nothing in use changes
    until it is complete and checked."""
    folder = _folder()
    folder.mkdir(parents=True,exist_ok=True)
    name = f"{month}-{utc_now().strftime('%Y%m%d%H%M%S')}.sqlite3"
    path = folder/name
    db = sqlite3.connect(path)
    try:
        db.executescript('''PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
            CREATE TABLE country(start BLOB PRIMARY KEY, end BLOB NOT NULL, code TEXT NOT NULL) WITHOUT ROWID;
            CREATE TABLE asn(start BLOB PRIMARY KEY, end BLOB NOT NULL, asn INTEGER NOT NULL) WITHOUT ROWID;
            CREATE TABLE org(asn INTEGER PRIMARY KEY, name TEXT NOT NULL, hosting INTEGER NOT NULL);''')
        countries = networks = 0
        batch = []
        for row in _rows(country_gz):
            start,end = (_packed(row[0]),_packed(row[1])) if len(row)>=3 else (None,None)
            if start and end:
                batch.append((start,end,row[2].strip().upper()[:2]))
            if len(batch)>=20000:
                db.executemany('INSERT OR REPLACE INTO country VALUES(?,?,?)',batch)
                countries += len(batch)
                batch = []
        db.executemany('INSERT OR REPLACE INTO country VALUES(?,?,?)',batch)
        countries += len(batch)
        batch,orgs = [],{}
        for row in _rows(asn_gz):
            if len(row)<3 or not row[2].strip().isdigit():
                continue
            start,end = _packed(row[0]),_packed(row[1])
            if start and end:
                number = int(row[2])
                batch.append((start,end,number))
                orgs.setdefault(number,(row[3] if len(row)>3 else '').strip()[:200])
            if len(batch)>=20000:
                db.executemany('INSERT OR REPLACE INTO asn VALUES(?,?,?)',batch)
                networks += len(batch)
                batch = []
        db.executemany('INSERT OR REPLACE INTO asn VALUES(?,?,?)',batch)
        networks += len(batch)
        db.executemany('INSERT INTO org VALUES(?,?,?)',[(n,o,int(hosting(n,o))) for n,o in orgs.items()])
        db.commit()
    finally:
        db.close()
    if countries<MIN_ROWS or networks<MIN_ROWS:
        _remove(path)
        raise RuntimeError('database too small')
    return name,countries,networks


def _remove(path):
    try:
        path.unlink()
        return True
    except OSError:
        return False


def _clean(keep):
    """Older files go; one still open by a lookup (Windows refuses) goes at a later update."""
    for path in _folder().glob('*.sqlite3'):
        if path.name!=keep:
            _remove(path)


def update(by='ระบบ'):
    """Download and build the month's database, then use it; returns the status. A failure keeps the one in use."""
    started = now()
    try:
        month,country_gz,asn_gz = fetch()
        name,countries,networks = build(month,country_gz,asn_gz)
    except Exception as error:
        print(f'[{now()}] IP database: {type(error).__name__}',file=sys.stderr,flush=True)
        with D.control() as cd:
            value = _setting(cd) or {}
            _save(cd,{**value,'enabled':True,'last_try':started,'ok':False,
                      'error':'ดาวน์โหลดหรืออ่านฐานข้อมูล IP ไม่สำเร็จ ระบบจะลองใหม่ภายหลัง'+(' และยังใช้ฉบับเดิมอยู่' if value.get('file') else '')})
        return status()
    with D.control() as cd:
        _save(cd,{'enabled':True,'file':name,'month':month,'updated_at':now(),'last_try':started,'ok':True,'error':'',
                  'countries':countries,'networks':networks})
        audit.record(cd,by,'platform.ip_data_updated',name,f'{month} ประเทศ {countries} ช่วง ผู้ให้บริการ {networks} ช่วง')
        cd.commit()
    _forget_cache()
    _clean(name)
    return status()


def status():
    """What the console shows: whether it is on, the month in use, how big, the last try, the credit."""
    with D.control() as cd:
        value = _setting(cd) or {}
    return {'enabled':bool(value.get('enabled')),'month':value.get('month') if value.get('file') else None,
            'updated_at':value.get('updated_at') if value.get('file') else None,'countries':value.get('countries',0),
            'networks':value.get('networks',0),'last_try':value.get('last_try'),'ok':value.get('ok',True),
            'error':value.get('error',''),'running':_running.locked(),'credit':CREDIT,'credit_url':CREDIT_URL}


def start_update(by):
    """The console's button: the download runs on its own thread (it takes a minute); the page asks again."""
    require(not _running.locked(),'กำลังดาวน์โหลดฐานข้อมูล IP อยู่ กรุณารอให้เสร็จก่อน',409)
    with D.control() as cd:
        value = _setting(cd) or {}
        _save(cd,{**value,'enabled':True})
    threading.Thread(target=auto_round,args=(by,),name='bookdose-ip-intel',daemon=True).start()
    return {**status(),'running':True}


def stop_using(by):
    """No more lookups or monthly downloads; the files go."""
    require(not _running.locked(),'กำลังดาวน์โหลดฐานข้อมูล IP อยู่ กรุณารอให้เสร็จก่อน',409)
    with D.control() as cd:
        cd.execute('DELETE FROM platform_settings WHERE key=?',(SETTING,))
        audit.record(cd,by,'platform.ip_data_removed','ip_intel')
        cd.commit()
    _forget_cache()
    _clean(None)
    return status()


def due(cd):
    """Once turned on: a month newer than the one in use, tried at most every RETRY_HOURS."""
    value = _setting(cd) or {}
    if not value.get('enabled'):
        return False
    if value.get('file') and value.get('month')==_month():
        return False
    return not value.get('last_try') or value['last_try']<after(hours=-RETRY_HOURS)


def busy():
    return _running.locked()


def auto_round(by='ระบบ'):
    if not _running.acquire(blocking=False):
        return None
    try:
        return update(by)
    finally:
        _running.release()


# Words for the email about a sign-in (the web pages name countries themselves, in the reader's language)
COUNTRY_NAMES = dict(pair.split(':') for pair in (
    'TH:ไทย,US:สหรัฐอเมริกา,CN:จีน,JP:ญี่ปุ่น,KR:เกาหลีใต้,KP:เกาหลีเหนือ,TW:ไต้หวัน,HK:ฮ่องกง,MO:มาเก๊า,SG:สิงคโปร์,'
    'MY:มาเลเซีย,ID:อินโดนีเซีย,PH:ฟิลิปปินส์,VN:เวียดนาม,LA:ลาว,KH:กัมพูชา,MM:เมียนมา,BN:บรูไน,TL:ติมอร์-เลสเต,IN:อินเดีย,'
    'BD:บังกลาเทศ,PK:ปากีสถาน,LK:ศรีลังกา,NP:เนปาล,BT:ภูฏาน,MV:มัลดีฟส์,AF:อัฟกานิสถาน,MN:มองโกเลีย,KZ:คาซัคสถาน,'
    'UZ:อุซเบกิสถาน,AE:สหรัฐอาหรับเอมิเรตส์,SA:ซาอุดีอาระเบีย,QA:กาตาร์,KW:คูเวต,BH:บาห์เรน,OM:โอมาน,YE:เยเมน,IR:อิหร่าน,'
    'IQ:อิรัก,IL:อิสราเอล,PS:ปาเลสไตน์,JO:จอร์แดน,LB:เลบานอน,SY:ซีเรีย,TR:ตุรกี,CY:ไซปรัส,GB:สหราชอาณาจักร,IE:ไอร์แลนด์,'
    'FR:ฝรั่งเศส,DE:เยอรมนี,NL:เนเธอร์แลนด์,BE:เบลเยียม,LU:ลักเซมเบิร์ก,CH:สวิตเซอร์แลนด์,AT:ออสเตรีย,IT:อิตาลี,ES:สเปน,'
    'PT:โปรตุเกส,SE:สวีเดน,NO:นอร์เวย์,DK:เดนมาร์ก,FI:ฟินแลนด์,IS:ไอซ์แลนด์,PL:โปแลนด์,CZ:เช็กเกีย,SK:สโลวาเกีย,HU:ฮังการี,'
    'RO:โรมาเนีย,BG:บัลแกเรีย,GR:กรีซ,HR:โครเอเชีย,SI:สโลวีเนีย,RS:เซอร์เบีย,UA:ยูเครน,BY:เบลารุส,RU:รัสเซีย,MD:มอลโดวา,'
    'LT:ลิทัวเนีย,LV:ลัตเวีย,EE:เอสโตเนีย,GE:จอร์เจีย,AM:อาร์มีเนีย,AZ:อาเซอร์ไบจาน,MT:มอลตา,CA:แคนาดา,MX:เม็กซิโก,BR:บราซิล,'
    'AR:อาร์เจนตินา,CL:ชิลี,CO:โคลอมเบีย,PE:เปรู,VE:เวเนซุเอลา,EC:เอกวาดอร์,UY:อุรุกวัย,PA:ปานามา,CR:คอสตาริกา,PR:เปอร์โตริโก,'
    'AU:ออสเตรเลีย,NZ:นิวซีแลนด์,ZA:แอฟริกาใต้,EG:อียิปต์,NG:ไนจีเรีย,KE:เคนยา,MA:โมร็อกโก,SC:เซเชลส์,MU:มอริเชียส'
).split(','))


def country_name(code):
    return COUNTRY_NAMES.get(code or '',code or 'ไม่ทราบ')


# The country a browser's time zone says (the IANA tables that come with Python's tzdata, or the system's)
_zones = {'loaded':False,'map':{}}
# Names some browsers still report for zones renamed since.
ZONE_ALIASES = {'Asia/Calcutta':'IN','Asia/Saigon':'VN','Asia/Rangoon':'MM','Asia/Katmandu':'NP','Asia/Dacca':'BD',
                'Asia/Ulan_Bator':'MN','Europe/Kiev':'UA','Asia/Thimbu':'BT','Asia/Macao':'MO','Asia/Chungking':'CN',
                'America/Buenos_Aires':'AR','Pacific/Truk':'FM','Atlantic/Faeroe':'FO','Asia/Vientiane':'LA',
                'Asia/Phnom_Penh':'KH'}


def _zone_files():
    from pathlib import Path
    found = []
    try:
        import importlib.util
        spec = importlib.util.find_spec('tzdata')
        if spec and spec.origin:
            found.append(Path(spec.origin).parent/'zoneinfo')
    except (ImportError,ValueError):
        pass
    found += [Path('/usr/share/zoneinfo'),Path('/usr/lib/zoneinfo')]
    return found


def zone_countries(zone):
    """The countries a time zone name is used in (empty when not known)."""
    if not _zones['loaded']:
        table = {}
        for folder in _zone_files():
            for name,multi in (('zone1970.tab',True),('zone.tab',False)):
                path = folder/name
                if not path.is_file():
                    continue
                for line in path.read_text(encoding='utf-8',errors='replace').splitlines():
                    parts = line.split('\t')
                    if line.startswith('#') or len(parts)<3:
                        continue
                    table.setdefault(parts[2],set()).update(parts[0].split(',') if multi else [parts[0]])
            if table:
                break
        for name,code in ZONE_ALIASES.items():
            table.setdefault(name,set()).add(code)
        _zones.update(loaded=True,map=table)
    return _zones['map'].get(str(zone or ''),set())
