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
    return values
