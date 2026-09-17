"""Form and query validation of the Superadmin security API."""
import re

from backend.modules.security import model
from backend.modules.security.blocks import normalize
from backend.utils.validation import email_field, field, require

KEY = re.compile(r'(signin|staff|customer):[^\s:]{3,254}')
ID = re.compile(r'[a-f0-9]{32}')


def _first(query, name, maximum=200):
    value = (query.get(name) or [''])[0].strip()
    require(len(value)<=maximum,'ตัวกรองไม่ถูกต้อง')
    return value


def time_range(query):
    value = _first(query,'range') or '24h'
    require(value in ('24h','7d'),'ช่วงเวลาไม่ถูกต้อง')
    return value


def event_filters(query):
    """The events list filters and page size; `before` is the id the previous page ended at."""
    filters = {name:_first(query,name) for name in ('kind','severity','actor','ip','tenant','q','before')}
    require(not filters['kind'] or filters['kind'] in model.EVENT_KINDS,'ประเภทเหตุการณ์ไม่ถูกต้อง')
    require(not filters['severity'] or filters['severity'] in model.SEVERITIES,'ระดับไม่ถูกต้อง')
    require(not filters['actor'] or filters['actor'] in model.ACTORS,'กลุ่มผู้ใช้ไม่ถูกต้อง')
    require(not filters['tenant'] or ID.fullmatch(filters['tenant']),'องค์กรไม่ถูกต้อง')
    if filters['ip']:
        filters['ip'] = normalize(filters['ip']) or filters['ip']
    require(not filters['before'] or filters['before'].isascii() and filters['before'].isdigit(),'หน้าไม่ถูกต้อง')
    filters['before'] = int(filters['before']) if filters['before'] else None
    limit = _first(query,'limit') or '50'
    require(limit.isascii() and limit.isdigit() and 1<=int(limit)<=200,'จำนวนรายการต้องอยู่ระหว่าง 1-200')
    return filters,int(limit)


def lock_key(body):
    key = body.get('key')
    require(isinstance(key,str) and KEY.fullmatch(key),'ไม่พบบัญชีที่ถูกล็อก')
    return key


def alerts_open(query):
    return _first(query,'open') in ('1','true')


def block_form(body):
    """(ip, reason, seconds or None for permanent)"""
    ip = normalize(body.get('ip')) if isinstance(body.get('ip'),str) else None
    require(ip,'กรุณาระบุ IP ให้ถูกต้อง เช่น 203.0.113.10')
    reason = field(body,'reason',300,False)
    duration = body.get('duration')
    require(duration in model.BLOCK_DURATIONS,'กรุณาเลือกระยะเวลาการบล็อก')
    return ip,reason,model.BLOCK_DURATIONS[duration]


def block_ip(body, query):
    """The address to unblock: {ip} in the body, or ?ip= ."""
    value = body.get('ip') if isinstance(body.get('ip'),str) else _first(query,'ip',64)
    ip = normalize(value)
    require(ip,'กรุณาระบุ IP ให้ถูกต้อง')
    return ip


def revoke_form(body):
    actor = body.get('actor')
    require(actor in ('staff','customer'),'กรุณาเลือกกลุ่มผู้ใช้')
    return actor,email_field({'email':body.get('subject','')})


def settings_form(body, current):
    """The new settings: every value given replaces the current one, within the bounds; idle never above absolute."""
    values = {'sessions':{a:dict(v) for a,v in current['sessions'].items()},'alerts':dict(current['alerts'])}
    sessions = body.get('sessions',{})
    require(isinstance(sessions,dict),'ข้อมูลการตั้งค่าไม่ถูกต้อง')
    units = {'staff':(('idle_minutes',60),('absolute_hours',3600)),'platform':(('idle_minutes',60),('absolute_hours',3600)),
             'customer':(('idle_days',86400),('absolute_days',86400))}
    names = {'staff':'เจ้าหน้าที่','platform':'ผู้ดูแลแพลตฟอร์ม','customer':'ลูกค้า'}
    for actor,((idle_name,idle_unit),(absolute_name,absolute_unit)) in units.items():
        given = sessions.get(actor,{})
        require(isinstance(given,dict),'ข้อมูลการตั้งค่าไม่ถูกต้อง')
        for name in (idle_name,absolute_name):
            if name in given:
                require(type(given[name]) is int,'ค่าการตั้งค่าต้องเป็นจำนวนเต็ม')
                values['sessions'][actor][name] = given[name]
        idle = values['sessions'][actor][idle_name]*idle_unit
        absolute = values['sessions'][actor][absolute_name]*absolute_unit
        require(model.IDLE_BOUNDS[0]<=idle<=model.IDLE_BOUNDS[1],f'เวลาไม่ใช้งานของ{names[actor]}ต้องอยู่ระหว่าง 5 นาที ถึง 30 วัน')
        require(model.ABSOLUTE_BOUNDS[0]<=absolute<=model.ABSOLUTE_BOUNDS[1],f'อายุเซสชันของ{names[actor]}ต้องอยู่ระหว่าง 1 ชั่วโมง ถึง 90 วัน')
        require(idle<=absolute,f'เวลาไม่ใช้งานของ{names[actor]}ต้องไม่เกินอายุเซสชัน')
    alerts = body.get('alerts',{})
    require(isinstance(alerts,dict),'ข้อมูลการตั้งค่าไม่ถูกต้อง')
    for name in values['alerts']:
        if name in alerts:
            require(type(alerts[name]) is int and model.ALERT_BOUNDS[0]<=alerts[name]<=model.ALERT_BOUNDS[1],
                    'เกณฑ์การแจ้งเตือนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป')
            values['alerts'][name] = alerts[name]
    values['honeypot'] = honeypot_form(body.get('honeypot',{}),current['honeypot'])
    return values


# Honeypots and honeytokens
CUSTOM_PATH = re.compile(r'/api(?:/[a-z0-9._~-]+)+')
ROUTE_LITERAL = re.compile(r'[(\[{.*+?\\|^$]')


def honeypot_form(given, current):
    """The honeypot settings: every value given replaces the current one."""
    require(isinstance(given,dict),'ข้อมูลการตั้งค่ากับดักไม่ถูกต้อง')
    values = {'paths_enabled':current['paths_enabled'],'forms_enabled':current['forms_enabled'],
              'custom_api_paths':[dict(p) for p in current['custom_api_paths']],
              'block_on_path_hits':dict(current['block_on_path_hits']),'block_on_honeytoken':dict(current['block_on_honeytoken'])}
    for name in ('paths_enabled','forms_enabled'):
        if name in given:
            require(type(given[name]) is bool,'ค่าเปิด/ปิดกับดักไม่ถูกต้อง')
            values[name] = given[name]
    if 'custom_api_paths' in given:
        values['custom_api_paths'] = custom_paths(given['custom_api_paths'])
    for group,fields in (('block_on_path_hits',('enabled','hits','window_minutes','duration')),('block_on_honeytoken',('enabled','duration'))):
        if group not in given:
            continue
        inner = given[group]
        require(isinstance(inner,dict),'ข้อมูลการบล็อกอัตโนมัติไม่ถูกต้อง')
        for name in fields:
            if name not in inner:
                continue
            value = inner[name]
            if name=='enabled':
                require(type(value) is bool,'ค่าเปิด/ปิดการบล็อกอัตโนมัติไม่ถูกต้อง')
            elif name=='duration':
                require(value in model.BLOCK_DURATIONS,'กรุณาเลือกระยะเวลาการบล็อก')
            else:
                low,high = model.PATH_HIT_BOUNDS[name]
                require(type(value) is int and low<=value<=high,
                        'จำนวนครั้งต้องอยู่ระหว่าง 1-1000' if name=='hits' else 'ช่วงเวลาต้องอยู่ระหว่าง 1-1440 นาที')
            values[group][name] = value
    return values


def custom_paths(given):
    """[{path, match}] of the Superadmin's API decoys: lower case, under /api/, never a real route (or a namespace the
    server routes by pattern), no duplicates, at most MAX_CUSTOM_PATHS."""
    require(isinstance(given,list),'รายการเส้นทางกับดักไม่ถูกต้อง')
    require(len(given)<=model.MAX_CUSTOM_PATHS,f'เพิ่มเส้นทางกับดักได้ไม่เกิน {model.MAX_CUSTOM_PATHS} รายการ')
    found,seen = [],set()
    for item in given:
        require(isinstance(item,dict) and isinstance(item.get('path'),str),'รายการเส้นทางกับดักไม่ถูกต้อง')
        match = item.get('match','exact')
        require(match in ('exact','prefix'),'รูปแบบการจับคู่ต้องเป็น exact หรือ prefix')
        path = item['path'].strip().lower()
        if len(path)>1:
            path = path.rstrip('/')
        require(len(path)<=200 and CUSTOM_PATH.fullmatch(path) and '/./' not in path+'/' and '/../' not in path+'/',
                f'เส้นทาง {path[:60] or "(ว่าง)"} ไม่ถูกต้อง ต้องขึ้นต้นด้วย /api/ และใช้ a-z 0-9 . _ ~ - เท่านั้น')
        require(path not in seen,f'เส้นทาง {path} ซ้ำกัน')
        require(path not in model.DECOY_API_PATHS,f'เส้นทาง {path} เป็นกับดักของระบบอยู่แล้ว')
        overlap = route_overlap(path,match)
        require(not overlap,f'เส้นทาง {path} ซ้อนกับเส้นทางจริงของระบบ ({overlap}) กรุณาเลือกเส้นทางอื่น')
        seen.add(path)
        found.append({'path':path,'match':match})
    return found


def route_overlap(path, match):
    """The real route (or reserved namespace) a decoy would shadow, or ''. An exact decoy overlaps a route that matches
    it; a prefix decoy also overlaps a route that could match anything below it."""
    from backend.http.dispatch import ROUTES
    if path==model.TRAP_PATH or path=='/api/realtime' or any(path.startswith(p) or path+'/'==p for p in model.RESERVED_API_PREFIXES):
        return path
    below = path+'/'
    for _,pattern,_,_ in ROUTES:
        if re.fullmatch(pattern,path):
            return pattern
        if match!='prefix':
            continue
        literal = ROUTE_LITERAL.split(pattern,1)[0]
        is_literal = literal==pattern
        if literal.startswith(below) or (not is_literal and below.startswith(literal)):
            return pattern
    return ''


def honeytoken_form(body):
    """(kind, label, placed_at_note) of a new honeytoken."""
    kind = body.get('kind')
    require(kind in model.HONEYTOKEN_KINDS,'กรุณาเลือกชนิดกับดัก')
    return kind,field(body,'label',100),field(body,'placed_at_note',300,False)


def honeytoken_changes(body):
    """{label?, placed_at_note?, enabled?} of a change; at least one."""
    changes = {}
    if 'label' in body:
        changes['label'] = field(body,'label',100)
    if 'placed_at_note' in body:
        changes['placed_at_note'] = field(body,'placed_at_note',300,False)
    if 'enabled' in body:
        require(type(body['enabled']) is bool,'ค่าเปิด/ปิดกับดักไม่ถูกต้อง')
        changes['enabled'] = body['enabled']
    require(changes,'ไม่มีข้อมูลที่ต้องการเปลี่ยน')
    return changes


def trap_report(body):
    """(path, method, user agent) of the web app's report of a visit to a decoy page or a shared-file link."""
    path,method,agent = body.get('path'),body.get('method','GET'),body.get('user_agent','')
    require(isinstance(path,str) and path.startswith('/') and isinstance(method,str) and isinstance(agent,str),'ข้อมูลไม่ถูกต้อง')
    return path[:500],method[:16].upper(),agent[:300]
