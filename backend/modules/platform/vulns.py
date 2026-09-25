"""ช่องโหว่ในไลบรารี: whether a library the server runs has a vulnerability the world has already published (CVE / GHSA),
checked once a day against OSV.dev - the open database that gathers the CVE list, GitHub's advisories and PyPI's and
npm's own - and shown on the platform console's overview. A new high or critical one is emailed to the platform
admins at once.

What is checked is what really runs:
- Python: the packages in requirements.txt and everything they pull in, at the versions installed on this server
  (importlib.metadata), not the ones written down;
- the web app: every package in frontend/package-lock.json, those only used to build and test it marked as such
  (they never run on the server, so they are listed but not emailed).

Only package names and versions leave the server (to api.osv.dev); nothing about organizations or their data. When
OSV.dev cannot be reached the round says so and tries again in an hour.

  vuln_scan  (platform setting) the last round: when, what was checked, what was found, or why it failed
  vuln_told  (platform setting) the findings already emailed, so each is emailed once """
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
import importlib.metadata as metadata
import json
import math
from pathlib import Path
import re
import sys
import threading
import urllib.error
import urllib.request

from backend.database import audit, db as D
from backend.modules.platform import repository
from backend.utils.dates import after, now
from backend.utils.validation import require

OSV = 'https://api.osv.dev/v1'
SCAN_KEY = 'vuln_scan'
TOLD_KEY = 'vuln_told'
EVERY_HOURS, RETRY_HOURS = 24, 1
BATCH = 500
MAX_DETAILS = 400
TIMEOUT = 20
ROOT = Path(__file__).resolve().parents[3]
LEVELS = ('critical','high','medium','low','unknown')
URGENT = ('critical','high')
_running = threading.Lock()


def _norm(name):
    return re.sub(r'[-_.]+','-',name).lower()


# What runs
def python_packages():
    """[(name, version)] of requirements.txt and everything it pulls in, as installed here."""
    wanted = []
    try:
        lines = (ROOT/'requirements.txt').read_text(encoding='utf-8').splitlines()
    except OSError:
        lines = []
    for line in lines:
        match = re.match(r'\s*([A-Za-z0-9][A-Za-z0-9._-]*)',line.split('#')[0])
        if match:
            wanted.append(match[1])
    found,todo = {},list(wanted)
    while todo:
        name = todo.pop()
        key = _norm(name)
        if key in found:
            continue
        try:
            dist = metadata.distribution(name)
        except metadata.PackageNotFoundError:
            continue
        found[key] = (dist.metadata['Name'],dist.version)
        for requirement in dist.requires or []:
            # An optional part (extra == ...) is only installed on request.
            if 'extra ==' in requirement.replace('extra==','extra =='):
                continue
            match = re.match(r'\s*([A-Za-z0-9][A-Za-z0-9._-]*)',requirement)
            if match:
                todo.append(match[1])
    return sorted(found.values())


def npm_packages():
    """[(name, version, dev)] of the web app's lockfile, or None when there is none on this server."""
    try:
        lock = json.loads((ROOT/'frontend'/'package-lock.json').read_text(encoding='utf-8'))
    except (OSError,ValueError):
        return None
    found = {}
    for path,entry in (lock.get('packages') or {}).items():
        if not path or entry.get('link') or not entry.get('version'):
            continue
        name = entry.get('name') or path.rsplit('node_modules/',1)[-1]
        dev = bool(entry.get('dev') or entry.get('devOptional'))
        # The same version needed at run time and to build counts as run time.
        found[(name,entry['version'])] = found.get((name,entry['version']),True) and dev
    return sorted((name,version,dev) for (name,version),dev in found.items())


# OSV.dev
def _request(url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url,data=data,method='POST' if data else 'GET',
                                     headers={'Content-Type':'application/json','User-Agent':'Bookdose-Customer-Service'})
    with urllib.request.urlopen(request,timeout=TIMEOUT) as response:
        return json.loads(response.read(20_000_000))


def query(packages):
    """{index of the package: [vulnerability ids]} for [(ecosystem, name, version)]."""
    found = {}
    for start in range(0,len(packages),BATCH):
        part = packages[start:start+BATCH]
        answer = _request(OSV+'/querybatch',{'queries':[{'package':{'ecosystem':e,'name':n},'version':v} for e,n,v in part]})
        for offset,result in enumerate(answer.get('results') or []):
            ids = [v['id'] for v in (result or {}).get('vulns') or [] if isinstance(v,dict) and v.get('id')]
            if ids:
                found[start+offset] = ids
    return found


def details(vuln_id):
    return _request(OSV+'/vulns/'+urllib.request.quote(vuln_id,safe=''))


# How bad
_WEIGHTS = {'AV':{'N':.85,'A':.62,'L':.55,'P':.2},'AC':{'L':.77,'H':.44},'UI':{'N':.85,'R':.62},
            'C':{'H':.56,'L':.22,'N':0},'I':{'H':.56,'L':.22,'N':0},'A':{'H':.56,'L':.22,'N':0}}


def _roundup(value):
    whole = round(value*100000)
    return whole/100000 if whole%10000==0 else (math.floor(whole/10000)+1)/10


def cvss3(vector):
    """The CVSS 3.x base score of a vector ('CVSS:3.1/AV:N/AC:L/...'), or None when it cannot be read."""
    try:
        parts = dict(p.split(':',1) for p in vector.split('/')[1:])
        changed = parts['S']=='C'
        pr = {'N':.85,'L':.68 if changed else .62,'H':.5 if changed else .27}[parts['PR']]
        c,i,a = (_WEIGHTS[k][parts[k]] for k in ('C','I','A'))
        exploit = 8.22*_WEIGHTS['AV'][parts['AV']]*_WEIGHTS['AC'][parts['AC']]*pr*_WEIGHTS['UI'][parts['UI']]
    except (KeyError,ValueError):
        return None
    base = 1-(1-c)*(1-i)*(1-a)
    impact = 7.52*(base-.029)-3.25*(base-.02)**15 if changed else 6.42*base
    if impact<=0:
        return 0.0
    return _roundup(min((1.08 if changed else 1)*(impact+exploit),10))


def level_of(score):
    return 'unknown' if score is None else 'critical' if score>=9 else 'high' if score>=7 else 'medium' if score>=4 else 'low'


def severity(vuln):
    """(level, score or None): the advisory's own rating when it has one, else its CVSS 3 vector's score."""
    score = None
    for item in vuln.get('severity') or []:
        if isinstance(item,dict) and str(item.get('type','')).startswith('CVSS_V3'):
            score = cvss3(str(item.get('score','')))
            if score is not None:
                break
    # A vector that reads as no impact at all says nothing next to the advisory's own rating.
    score = score or None
    named = str((vuln.get('database_specific') or {}).get('severity','')).upper()
    named = {'CRITICAL':'critical','HIGH':'high','MODERATE':'medium','MEDIUM':'medium','LOW':'low'}.get(named)
    return named or level_of(score),score


def fixed_in(vuln, ecosystem, name):
    """The versions the advisory says fix it, for this package."""
    found = []
    for affected in vuln.get('affected') or []:
        package = affected.get('package') or {}
        if package.get('ecosystem')!=ecosystem or _norm(package.get('name',''))!=_norm(name):
            continue
        for span in affected.get('ranges') or []:
            for event in span.get('events') or []:
                if event.get('fixed') and event['fixed'] not in found:
                    found.append(event['fixed'])
    return found[:3]


def _merge(vulns):
    """One finding per issue: an advisory and its aliases (a PYSEC entry and the GHSA of the same CVE) count once; the
    one with a rating stands for the group."""
    groups = []
    for vuln in vulns:
        names = {vuln['id'],*vuln.get('aliases',[])}
        home = next((g for g in groups if g['names']&names),None)
        if home:
            home['names'] |= names
            home['members'].append(vuln)
        else:
            groups.append({'names':names,'members':[vuln]})
    merged = []
    for group in groups:
        rated = sorted(group['members'],key=lambda v:(LEVELS.index(severity(v)[0]),not v['id'].startswith('GHSA')))
        merged.append((rated[0],sorted(n for n in group['names'] if n.startswith('CVE-'))))
    return merged


# A round
def scan(by='ระบบ'):
    """Check every package now; returns the round as stored (vuln_scan)."""
    python,npm = python_packages(),npm_packages()
    packages = [('PyPI',n,v,False) for n,v in python]+[('npm',n,v,dev) for n,v,dev in npm or []]
    try:
        hits = query([(e,n,v) for e,n,v,_ in packages])
        ids = sorted({i for found in hits.values() for i in found})[:MAX_DETAILS]
        known = {}
        for vuln_id in ids:
            vuln = details(vuln_id)
            if not vuln.get('withdrawn'):
                known[vuln_id] = vuln
        findings = []
        for index,found in hits.items():
            ecosystem,name,version,dev = packages[index]
            for vuln,cves in _merge([known[i] for i in found if i in known]):
                level,score = severity(vuln)
                findings.append({'ecosystem':ecosystem,'name':name,'version':version,'dev':dev,'id':vuln['id'],'cves':cves,
                                 'summary':(vuln.get('summary') or (vuln.get('details') or '').split('\n')[0])[:300],
                                 'level':level,'score':score,'fixed':fixed_in(vuln,ecosystem,name),
                                 'url':'https://osv.dev/vulnerability/'+vuln['id']})
        findings.sort(key=lambda f:(f['dev'],LEVELS.index(f['level']),f['ecosystem'],f['name']))
        result = {'at':now(),'ok':True,'python':len(python),'npm':None if npm is None else len(npm),'findings':findings}
    except (urllib.error.URLError,OSError,ValueError,KeyError,TypeError) as error:
        result = {'at':now(),'ok':False,'error':type(error).__name__,'python':len(python),'npm':None if npm is None else len(npm),
                  'findings':last(None).get('findings',[]) if last(None) else []}
    with D.control() as cd:
        repository.save_setting(cd,SCAN_KEY,json.dumps(result,ensure_ascii=False))
        # A failed round is on the console and tried again within the hour: not a row in the log each time.
        if result['ok']:
            audit.record(cd,by,'platform.vuln_scan',f"พบ {len(result['findings'])} รายการ")
        cd.commit()
    if result['ok']:
        tell(result['findings'])
    return result


def last(cd):
    """The last round, or None."""
    if cd is None:
        with D.control() as own:
            return last(own)
    try:
        return json.loads(repository.setting(cd,SCAN_KEY) or 'null')
    except ValueError:
        return None


def _key(finding):
    return f"{finding['ecosystem']}:{finding['name']}:{finding['version']}:{finding['id']}"


def tell(findings):
    """Email the platform admins each new high or critical finding in what runs on the server; once each. Nothing is
    marked as told while the platform's mailbox is not set up: it goes out once it is."""
    from backend.modules.platform import service as platform
    urgent = [f for f in findings if f['level'] in URGENT and not f['dev']]
    with D.control() as cd:
        try:
            told = set(json.loads(repository.setting(cd,TOLD_KEY) or '[]'))
        except ValueError:
            told = set()
        fresh = [f for f in urgent if _key(f) not in told]
        if not fresh or not platform.registration_ready(cd):
            return []
        # What is no longer found is forgotten: should it come back, it is news again.
        repository.save_setting(cd,TOLD_KEY,json.dumps(sorted({_key(f) for f in urgent})))
        cd.commit()
        recipients = [a['email'] for a in repository.platform_admins(cd)]
        cfg,secret = platform.registration_config(cd),platform.registration_secret()
    _send(recipients,cfg,secret,fresh)
    return fresh


LEVEL_WORDS = {'critical':'วิกฤต','high':'สูง','medium':'กลาง','low':'ต่ำ','unknown':'ไม่ระบุ'}


def _send(recipients, cfg, secret, fresh):
    from backend.extensions import channel_transport as T
    lines = '\n'.join(f"- {f['name']} {f['version']} ({f['ecosystem']}): {', '.join(f['cves']) or f['id']} ระดับ{LEVEL_WORDS[f['level']]}"
                      +(f" · แก้แล้วในเวอร์ชัน {', '.join(f['fixed'])}" if f['fixed'] else ' · ยังไม่มีเวอร์ชันที่แก้')
                      +(f"\n  {f['summary']}" if f['summary'] else '')+f"\n  {f['url']}" for f in fresh)
    for recipient in recipients:
        try:
            mail = EmailMessage()
            mail['Subject'] = f'พบช่องโหว่ระดับสูงในไลบรารีของ Bookdose ({len(fresh)} รายการ)'
            mail['From'],mail['To'] = cfg['address'],recipient
            mail['Date'],mail['Message-ID'],mail['Auto-Submitted'] = formatdate(localtime=False,usegmt=True),make_msgid(),'auto-generated'
            mail.set_content(f"การตรวจไลบรารีเทียบฐานข้อมูลช่องโหว่ (OSV.dev: CVE, GitHub Advisory) พบรายการใหม่ที่ต้องอัปเดต\n\n{lines}\n\n"
                             f"ดูทั้งหมดที่ คอนโซลระบบกลาง → ความปลอดภัย → ช่องโหว่:\n{cfg.get('public_base_url','').rstrip('/')}/platform/security?tab=vulns\n\n"
                             'อีเมลนี้ส่งถึงผู้ดูแลแพลตฟอร์มทุกคน แต่ละรายการแจ้งครั้งเดียว\n')
            T.send_email(cfg,secret,recipient,mail)
        except Exception as error:
            print(f'[{now()}] Vulnerability mail: {type(error).__name__}',file=sys.stderr,flush=True)


# When
def due(cd):
    """A round is due: none yet, the last one a day old, or the last one failed an hour ago."""
    found = last(cd)
    if not found:
        return True
    return found['at']<after(hours=-(EVERY_HOURS if found.get('ok') else RETRY_HOURS))


def busy():
    return _running.locked()


def auto_round():
    """The day's round, started by the security worker once it is due (in its own thread)."""
    if not _running.acquire(blocking=False):
        return None
    try:
        return scan()
    except Exception as error:
        print(f'Vulnerability scan: {type(error).__name__}',flush=True)
        return None
    finally:
        _running.release()


def scan_now(session):
    require(_running.acquire(blocking=False),'กำลังตรวจอยู่ กรุณารอให้เสร็จก่อน',409)
    try:
        found = scan(session['user_id'])
    finally:
        _running.release()
    return overview(found)


def overview(found=None):
    """For the console: the last round with its findings, most serious first."""
    found = found if found is not None else last(None)
    return {'last':found,'running':busy(),'every_hours':EVERY_HOURS}
