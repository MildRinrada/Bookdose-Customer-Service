"""What the platform console's overview (ภาพรวมระบบ) shows beyond the server's own numbers:

  checklist        what is missing or broken now, most urgent first, each with where to fix it (ต้องจัดการ)
  channel_health   which organization's LINE / Email / Facebook is failing and why, and sending its failed replies again
  org_usage        how each organization is doing: its health score and the four signals behind it (orghealth.py),
                   plus how busy it is - open cases, messages in 7 days, storage against its quota, last activity
  security_summary failed sign-ins, locked accounts, blocked addresses, trap hits and open alerts at a glance
  announcement     one message every organization's staff (and, when chosen, customers) see until it ends

Everything is read across organizations by the platform admin only (routes 'platform'); nothing here reads a case's
or a conversation's content."""
import datetime as dt
import json

from backend.database import audit, db as D
from backend.database.db import one, rows
from backend.exceptions.errors import APIError, ChannelError, CHANNEL_ERRORS
from backend.modules.platform import model, orghealth, repository
from backend.utils.dates import after, now, utc_now
from backend.utils.validation import require

CHANNEL_NAMES = {'line':'LINE','email':'อีเมล','facebook':'Facebook','instagram':'Instagram'}
STUCK_MINUTES = 15            # a reply still waiting to go out after this long is worth a look
KEY_SAVED = 'secret_key_saved'
LEVELS = {'critical':0,'warning':1,'info':2}


def _active_orgs(cd):
    return [o for o in repository.list_with_member_count(cd) if o['status']=='active']


def _tenant_exists(tenant_id):
    return D.tenant_path(tenant_id).is_file()


# Channels
def _outbox(db, kind):
    counts = {status:count for status,count in db.execute('SELECT status,COUNT(*) FROM channel_outbox WHERE kind=? GROUP BY status',(kind,))}
    oldest = one(db,"SELECT MIN(created_at) AS at FROM channel_outbox WHERE kind=? AND status IN ('queued','sending')",(kind,))['at']
    failure = one(db,"SELECT error,updated_at FROM channel_outbox WHERE kind=? AND status IN ('failed','unknown') ORDER BY updated_at DESC LIMIT 1",(kind,))
    return {'waiting':counts.get('queued',0)+counts.get('sending',0),'failed':counts.get('failed',0),'unknown':counts.get('unknown',0),
            'oldest_waiting':oldest,'last_failure':CHANNEL_ERRORS.get(failure['error'],failure['error']) if failure else '',
            'last_failure_at':failure['updated_at'] if failure else None}


def _channel(kind, row, box):
    enabled = bool(row and row['enabled'])
    error = CHANNEL_ERRORS.get(row['last_error'],row['last_error']) if row and row['last_error'] else ''
    stuck = bool(box['oldest_waiting'] and box['oldest_waiting']<after(minutes=-STUCK_MINUTES))
    status = ('error' if (enabled and error) or box['failed'] else 'warning' if box['unknown'] or stuck else 'ok')
    return {'kind':kind,'name':CHANNEL_NAMES[kind],'enabled':enabled,'error':error,'status':status,'stuck':stuck,
            'last_received':row['last_received'] if row else None,**box}


def tenant_channels(db):
    """One organization's LINE, Email and Facebook that are switched on or still have replies in their queue (also
    the organization's own overview, ตั้งค่าองค์กรให้ครบ)."""
    from backend.modules.channels import repository as channels
    items = [_channel(kind,channels.find_setting(db,kind),_outbox(db,kind)) for kind in ('line','email')]
    page = channels.find_facebook_setting(db)
    items.append(_channel('facebook',page,_outbox(db,'facebook')))
    # Instagram rides on the Page's connection: on when the Page is on and Instagram is turned on.
    instagram = dict(page,enabled=int(bool(page['enabled'] and page['config'].get('instagram_enabled')))) if page else None
    items.append(_channel('instagram',instagram,_outbox(db,'instagram')))
    return [c for c in items if c['enabled'] or c['waiting'] or c['failed'] or c['unknown']]


def channel_health(cd):
    """Each active organization with a channel switched on (or replies left in its queue), worst first."""
    found = []
    for org in _active_orgs(cd):
        if not _tenant_exists(org['id']):
            continue
        with D.tenant(org['id']) as db:
            items = tenant_channels(db)
        if not items:
            continue
        worst = min((c['status'] for c in items),key=lambda s:{'error':0,'warning':1,'ok':2}[s])
        found.append({'id':org['id'],'name':org['name'],'slug':org['slug'],'status':worst,'channels':items})
    return sorted(found,key=lambda o:({'error':0,'warning':1,'ok':2}[o['status']],o['name']))


def retry_failed(cd, session, tenant_id):
    """Send every reply of one organization that surely failed once more, as it was first sent (the member who wrote
    it stays its sender: the send checks they may still act there). A reply that may already have gone out
    ('unknown') is never repeated automatically; one that cannot go again says why."""
    from backend.modules.channels import service as channels
    require(repository.is_active(cd,tenant_id) and _tenant_exists(tenant_id),'ไม่พบองค์กร หรือองค์กรถูกระงับ',404)
    sent,reasons = 0,[]
    with D.tenant(tenant_id) as db:
        for job in rows(db,"SELECT * FROM channel_outbox WHERE status='failed' ORDER BY created_at"):
            ctx = {'tenant_id':tenant_id,'id':job['actor_id'],'name':f"{session['name']} (ส่งซ้ำจากคอนโซลระบบกลาง)",
                   'role':'admin','team_id':None}
            D.begin(db)
            try:
                channels.retry_message(db,ctx,job['message_id'])
            except ChannelError as error:
                db.rollback()
                reasons.append(CHANNEL_ERRORS.get(error.code,error.code))
                continue
            except APIError as error:
                db.rollback()
                reasons.append(error.message)
                continue
            db.commit()
            sent += 1
    audit.record(cd,session['user_id'],'platform.channel_retry',tenant_id,f'ส่งซ้ำ {sent} รายการ · ส่งซ้ำไม่ได้ {len(reasons)}')
    cd.commit()
    return {'retried':sent,'skipped':len(reasons),'reasons':sorted(set(reasons))[:5]}


# How busy each organization is
def org_usage(cd):
    moment = after(days=-7)
    found = []
    for org in repository.list_with_member_count(cd):
        # What this organization takes on the shared disk, against the ceiling it was given (platform/storage.py).
        # The folder is walked here rather than summed from the database: a person is looking, and the disk is what
        # matters. quota_mb 0 means no ceiling, and share stays 0.
        files = _folder_bytes(D.DATA/'files'/org['id'])
        database = _tenant_bytes(org['id'])
        quota = int(org['quota_mb'] or 0)*1024*1024
        entry = {'id':org['id'],'name':org['name'],'slug':org['slug'],'status':org['status'],'members':org['member_count'],
                 'open_cases':0,'messages_7d':0,'storage_bytes':files,'database_bytes':database,
                 'used_bytes':files+database,'quota_mb':int(org['quota_mb'] or 0),
                 'share':round((files+database)/quota,4) if quota else 0,'last_active':None}
        # How this organization is actually doing: answering time, what customers said, the backlog and the channels
        # (platform/orghealth.py). Without it a list of organizations says who is busy, never who is in trouble.
        entry['health'] = orghealth.of_tenant(org['id'],now())
        if _tenant_exists(org['id']):
            with D.tenant(org['id']) as db:
                entry['open_cases'] = db.execute("SELECT COUNT(*) FROM tickets WHERE status NOT IN ('resolved','closed')").fetchone()[0]
                entry['messages_7d'] = db.execute('SELECT COUNT(*) FROM messages WHERE created_at>=?',(moment,)).fetchone()[0]
                seen = [db.execute('SELECT MAX(last_seen) FROM agent_activity').fetchone()[0],
                        db.execute('SELECT MAX(created_at) FROM messages').fetchone()[0]]
                entry['last_active'] = max([s for s in seen if s],default=None)
        found.append(entry)
    return sorted(found,key=lambda o:(o['status']!='active',-(o['messages_7d']),o['name']))


def _folder_bytes(path):
    try:
        return sum(p.stat().st_size for p in path.rglob('*') if p.is_file())
    except OSError:
        return 0


def _tenant_bytes(tenant_id):
    """The organization's own database file, with the journal files SQLite keeps beside it."""
    try:
        path = D.tenant_path(tenant_id)
        return sum(p.stat().st_size for p in path.parent.glob(path.name+'*') if p.is_file())
    except (OSError, ValueError):
        return 0


# Security at a glance
def security_summary(cd):
    from backend.modules.security import repository as security
    from backend.modules.security.model import FAILED_LOGIN_KINDS, TRAP_EVENT_KINDS
    since = after(hours=-24)

    def total(kinds):
        marks = ','.join('?'*len(kinds))
        return cd.execute(f'SELECT COALESCE(SUM(count),0) FROM security_events WHERE at>=? AND kind IN ({marks})',(since,*kinds)).fetchone()[0]
    return {'failed_sign_ins':total(FAILED_LOGIN_KINDS),'locked_accounts':len(security.locked(cd,now())),
            'blocked_ips':len(security.live_blocks(cd)),'trap_hits':total(TRAP_EVENT_KINDS),
            'open_alerts':security.count_open_alerts(cd)}


# What needs doing
def _item(key, level, title, detail, label, href, action=None):
    return {'key':key,'level':level,'title':title,'detail':detail,'action':{'label':label,'href':href,**({'do':action} if action else {})}}


def checklist(cd, session, snapshot):
    """Everything missing or broken now, most urgent first. `snapshot` is the server's monitor snapshot."""
    from backend.extensions import sms
    from backend.modules.organization import repository as organization
    from backend.modules.platform import backups, service
    from backend.modules.security import repository as security
    from backend.modules.staff_security import service as staff_security
    from backend.utils import secret_box
    items = []
    for org in _active_orgs(cd):
        if not organization.organization_admins(cd,org['id']):
            items.append(_item(f"org-admin-{org['id']}",'critical',f"{org['name']} ยังไม่มีผู้ดูแลองค์กร",
                               'เรื่องจากลูกค้ารอโดยไม่มีใครรับ และไม่มีใครตั้งค่าช่องทางหรือทีมขององค์กรนี้ได้',
                               'เชิญผู้ดูแล',f"/platform/organizations?admin={org['id']}"))
    stopped = [w['name'] for w in snapshot['workers'] if not w['running']]
    if stopped:
        items.append(_item('workers','critical',f'งานเบื้องหลังหยุด {len(stopped)} อย่าง',
                           'ข้อความ อีเมล หรือ AI อาจค้างอยู่ในคิว ตรวจ log ของเซิร์ฟเวอร์แล้วเปิดโปรแกรมใหม่',
                           'ดูงานเบื้องหลัง','#workers'))
    server = snapshot.get('disk') or {}
    if server and server['free']<server['total']*0.1:
        items.append(_item('disk','critical','พื้นที่ดิสก์เหลือน้อยกว่า 10%','ฐานข้อมูลจะเขียนไม่ได้เมื่อดิสก์เต็ม ลบไฟล์สำรองเก่าหรือขยายดิสก์',
                           'ดูพื้นที่ดิสก์','#health'))
    for org in channel_health(cd):
        if org['status']=='error':
            broken = ', '.join(c['name'] for c in org['channels'] if c['status']=='error')
            items.append(_item(f"channels-{org['id']}",'warning',f"ช่องทาง {broken} ของ {org['name']} มีปัญหา",
                               '; '.join(filter(None,[c['error'] or c['last_failure'] for c in org['channels'] if c['status']=='error']))[:200],
                               'ดูสถานะช่องทาง','#channels'))
    if not service.registration_ready(cd):
        items.append(_item('mail','warning','ยังไม่ได้ตั้งค่าอีเมลของระบบ',
                           'ส่งคำเชิญทีมงาน ลิงก์ตั้งรหัสผ่านใหม่ ลิงก์ยืนยันสมาชิก และการแจ้งเตือนทางอีเมลไม่ได้',
                           'ตั้งค่าอีเมล','/platform/settings#email'))
    last = backups.last(cd)
    if last and not last.get('ok'):
        items.append(_item('backup-failed','critical','สำรองข้อมูลครั้งล่าสุดไม่สำเร็จ',f"เมื่อ {last['at']} ({last.get('error','')})",
                           'สำรองตอนนี้','#backups'))
    else:
        good = [f for f in backups.files()]
        newest = good[0]['created_at'] if good else None
        if not newest or newest<after(hours=-48):
            items.append(_item('backup','warning','ยังไม่มีการสำรองข้อมูลใน 2 วันที่ผ่านมา' if newest else 'ยังไม่เคยสำรองข้อมูล',
                               'เปิดการสำรองอัตโนมัติรายวัน หรือกดสำรองตอนนี้ แล้วคัดลอกไฟล์ไปเก็บนอกเครื่อง',
                               'สำรองตอนนี้','#backups'))
    if secret_box.key_source()=='file' and repository.setting(cd,KEY_SAVED)!=secret_box.current_key_id():
        items.append(_item('key','warning','กุญแจเข้ารหัสยังอยู่ในโฟลเดอร์ข้อมูลเท่านั้น',
                           f"คัดลอกไฟล์ data/keys/secret.key (รหัส {secret_box.current_key_id()}) ไปเก็บนอกเครื่อง เช่น ตัวจัดการรหัสผ่าน "
                           'หรือตั้ง BOOKDOSE_SECRET_KEY ถ้าไฟล์หาย token ของทุกช่องทางจะเปิดไม่ได้',
                           'ฉันเก็บกุญแจไว้แล้ว','#key','key-saved'))
    unprotected = [a for a in repository.platform_admins(cd) if not staff_security.protected(cd,a['id'])]
    if unprotected:
        mine = any(a['id']==session['user_id'] for a in unprotected)
        items.append(_item('two-factor','warning',f'ผู้ดูแลแพลตฟอร์ม {len(unprotected)} คนยังไม่เปิดการยืนยันสองขั้นตอน',
                           ', '.join(a['name'] for a in unprotected)+' · บัญชีเหล่านี้เข้าถึงทุกองค์กรได้',
                           'เปิดของฉัน' if mine else 'ดูทีมผู้ดูแล','/account?tab=security' if mine else '/platform/team'))
    from backend.modules.platform import dormant
    asleep = dormant.listing(cd)['organizations']
    if asleep:
        items.append(_item('dormant','info',f'องค์กรที่ไม่มีการใช้งาน {dormant.DAYS} วัน {len(asleep)} แห่ง',
                           ', '.join(o['name'] for o in asleep[:5])+(' และอื่นๆ' if len(asleep)>5 else '')+
                           ' · ไม่มีทีมงานเข้าใช้และไม่มีเคสใหม่ ติดต่อเจ้าของหรือระงับเพื่อปิดช่องโหว่',
                           'ดูองค์กรที่หลับ','/platform/organizations?tab=dormant'))
    from backend.modules.platform import vulns
    scan = vulns.last(cd)
    urgent = [f for f in (scan or {}).get('findings',[]) if f['level'] in vulns.URGENT and not f['dev']]
    if urgent:
        # A published hole in what runs is urgent whether rated high or critical: it is emailed at once too.
        names = ', '.join(dict.fromkeys(f"{f['name']} {f['version']}" for f in urgent))
        items.append(_item('vulns','critical',f'ไลบรารีมีช่องโหว่ระดับสูง {len(urgent)} รายการ',f'อัปเดต {names}'[:200],
                           'ดูช่องโหว่','/platform/security?tab=vulns'))
    elif scan and not scan.get('ok') and scan['at']<after(hours=-48):
        items.append(_item('vulns-failed','info','ตรวจช่องโหว่ในไลบรารีไม่ได้มา 2 วัน',
                           'เซิร์ฟเวอร์ติดต่อ api.osv.dev ไม่ได้ ตรวจการเชื่อมต่ออินเทอร์เน็ตหรือไฟร์วอลล์','ดูช่องโหว่','/platform/security?tab=vulns'))
    alerts = security.count_open_alerts(cd)
    if alerts:
        items.append(_item('alerts','warning',f'การแจ้งเตือนความปลอดภัยรอตรวจ {alerts} รายการ','ตรวจแล้วกดรับทราบในหน้าความปลอดภัย',
                           'ดูความปลอดภัย','/platform/security'))
    if sms.config(cd)['provider']=='off':
        items.append(_item('sms','info','ยังไม่ได้ตั้งค่า SMS','ลูกค้าที่ไม่มีอีเมลขอลิงก์ติดตามแชททาง SMS ไม่ได้',
                           'ตั้งค่า SMS','/platform/settings#sms'))
    return sorted(items,key=lambda i:LEVELS[i['level']])


SUPPORT_NEWS_HOURS = 72     # a denied or ended support access stays in the bell this long
SUPPORT_TEXT = {
    'pending':  ('info',    'clock', 'รอ {org} อนุมัติสิทธิ์เข้าช่วยเหลือ', 'เจ้าขององค์กรได้รับอีเมลและแถบแจ้งในหน้าจอแล้ว'),
    'approved': ('info',    'lock',  '{org} อนุมัติสิทธิ์เข้าช่วยเหลือแล้ว', 'เปิดดูข้อมูลขององค์กรได้อย่างเดียว'),
    'denied':   ('warning', 'close', '{org} ไม่อนุมัติสิทธิ์เข้าช่วยเหลือ', 'ติดต่อเจ้าขององค์กรถ้ายังต้องการตรวจสอบ'),
    'expired':  ('info',    'clock', 'สิทธิ์เข้าช่วยเหลือ {org} สิ้นสุดแล้ว', 'หมดเวลาหรือไม่มีใครตอบใน 24 ชั่วโมง ขอใหม่ได้จากหน้าจัดการองค์กร'),
}


def notifications(cd, session, snapshot):
    """The console's bell: what needs doing now (the checklist), then the admin's own support access requests, waiting,
    in force or answered in the last three days. `notify` marks what the bell counts: a to-do that is not only advice,
    and an organization's answer."""
    from backend.modules.support_access import repository as support, service as support_service
    found = []
    for item in checklist(cd,session,snapshot):
        href = item['action']['href']
        found.append({'key':item['key'],'kind':'system','level':item['level'],'icon':'bolt' if item['level']=='critical' else 'shield',
                      'title':item['title'],'detail':item['detail'],'href':'/platform/system'+href if href.startswith('#') else href,
                      'at':None,'until':None,'notify':item['level']!='info'})
    support_service.tidy(cd)
    cd.commit()
    for row in support.recent_of_user(cd,session['user_id'],after(hours=-SUPPORT_NEWS_HOURS)):
        level,icon,title,detail = SUPPORT_TEXT[row['status']]
        note = f" · {row['decided_by_name']}: {row['note']}" if row['status']=='denied' and row['note'] else ''
        found.append({'key':f"support-{row['id']}",'kind':'support','level':level,'icon':icon,
                      'title':title.format(org=row['tenant_name']),'detail':detail+note,
                      'href':'/platform/organizations',
                      'at':row['ended_at'] or row['decided_at'] or row['created_at'],
                      'until':row['expires_at'] if row['status']=='approved' else None,
                      'notify':row['status'] in ('approved','denied')})
    # Storage: an organization close to its ceiling, and organizations that have none. The disk-wide "less than 10%
    # left" line below is the last warning there is, and by then every organization is already about to stop writing;
    # these two come early enough to do something about.
    usage = org_usage(cd)
    tight = [o for o in usage if o['quota_mb'] and o['share']>=model.QUOTA_WARN and o['status']=='active']
    for org in sorted(tight,key=lambda o:-o['share'])[:5]:
        full = org['share']>=model.QUOTA_FULL
        found.append({'key':f"quota-{org['id']}",'kind':'storage','level':'critical' if full else 'warning','icon':'chart',
                      'title':f"{org['name']} ใช้พื้นที่ {round(org['share']*100)}% ของโควตา",
                      'detail':'อัปโหลดไฟล์ใหม่ไม่ได้แล้ว กดที่พื้นที่ของ องค์กรนี้ในตารางการใช้งาน เพื่อเพิ่มโควตา' if full
                               else 'ใกล้เต็ม ถ้าไม่เพิ่มโควตา องค์กรนี้จะอัปโหลดไฟล์ใหม่ไม่ได้',
                      'href':'/platform/system#usage','at':None,'until':None,'notify':True})
    unlimited = [o for o in usage if not o['quota_mb'] and o['status']=='active']
    if unlimited:
        found.append({'key':'quota-missing','kind':'storage','level':'warning','icon':'shield',
                      'title':f'ยังไม่ได้กำหนดโควตาพื้นที่ {len(unlimited)} องค์กร',
                      'detail':'องค์กรที่ไม่มีโควตาใช้ดิสก์ได้ไม่จำกัด และทำให้ทุกองค์กรเขียนข้อมูลไม่ได้เมื่อดิสก์เต็ม',
                      'href':'/platform/system#usage','at':None,'until':None,'notify':True})
    # Problem reports sent from the ? in the top bar of the organizations: one line while any are still open.
    waiting = repository.open_report_count(cd)
    if waiting:
        found.append({'key':'problem-reports','kind':'report','level':'warning','icon':'bell',
                      'title':f'มีรายงานปัญหารอดู {waiting} เรื่อง','detail':'ส่งมาจากทีมงานขององค์กรผ่านปุ่ม ? บนแถบบน',
                      'href':'/platform/reports','at':None,'until':None,'notify':True})
    return found


def key_saved(cd, session):
    """The platform admin says the key file is kept somewhere else: the reminder stops, until the key changes."""
    from backend.utils import secret_box
    repository.save_setting(cd,KEY_SAVED,secret_box.current_key_id())
    audit.record(cd,session['user_id'],'platform.key_saved',secret_box.current_key_id())
    cd.commit()


# One message to every organization
ANNOUNCEMENT = 'announcement'
LEVELS_SHOWN = ('info','warning')
AUDIENCES = ('staff','all')


def _parse(value):
    try:
        moment = dt.datetime.fromisoformat(str(value).replace('Z','+00:00'))
    except ValueError:
        return None
    return moment if moment.tzinfo else None


def announcement(cd):
    try:
        return json.loads(repository.setting(cd,ANNOUNCEMENT) or 'null')
    except ValueError:
        return None


def active_announcement(cd, audience='staff'):
    """The announcement to show now to `audience` ('staff' or 'customer'), or None."""
    found = announcement(cd)
    if not found:
        return None
    moment = utc_now()
    ends,starts = _parse(found.get('ends_at') or ''),_parse(found.get('starts_at') or '')
    if (ends and ends<=moment) or (starts and starts>moment):
        return None
    if audience=='customer' and found.get('audience')!='all':
        return None
    return {'text':found['text'],'level':found['level'],'ends_at':found.get('ends_at') or None}


def save_announcement(cd, session, body):
    text = body.get('text')
    require(isinstance(text,str) and 1<=len(text.strip())<=300,'ข้อความประกาศต้องมี 1-300 ตัวอักษร')
    level,audience = body.get('level','info'),body.get('audience','staff')
    require(level in LEVELS_SHOWN and audience in AUDIENCES,'ข้อมูลประกาศไม่ถูกต้อง')
    stamps = {}
    for name in ('starts_at','ends_at'):
        value = body.get(name) or ''
        require(isinstance(value,str),'เวลาของประกาศไม่ถูกต้อง')
        if value:
            moment = _parse(value)
            require(moment,'เวลาของประกาศไม่ถูกต้อง')
            stamps[name] = moment.astimezone(dt.timezone.utc).isoformat(timespec='seconds')
    require(not stamps.get('ends_at') or stamps['ends_at']>now(),'เวลาสิ้นสุดต้องอยู่ในอนาคต')
    require(not (stamps.get('starts_at') and stamps.get('ends_at')) or stamps['starts_at']<stamps['ends_at'],'เวลาเริ่มต้องก่อนเวลาสิ้นสุด')
    value = {'text':text.strip(),'level':level,'audience':audience,**stamps,'by':session['name'],'at':now()}
    repository.save_setting(cd,ANNOUNCEMENT,json.dumps(value,ensure_ascii=False))
    audit.record(cd,session['user_id'],'platform.announcement',text.strip()[:100])
    cd.commit()
    return value


def clear_announcement(cd, session):
    cd.execute('DELETE FROM platform_settings WHERE key=?',(ANNOUNCEMENT,))
    audit.record(cd,session['user_id'],'platform.announcement_cleared','')
    cd.commit()
