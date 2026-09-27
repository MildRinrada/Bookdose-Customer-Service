"""What a staff member may save as their preferences (model.DEFAULTS has the shape). Each section is optional in a
save: what is left out keeps its saved value. Everything is checked strictly; the text the customer sees (signature,
alias) and the quick replies are plain text."""
import copy
import datetime as dt
import re

from backend.modules.staff_prefs.model import (ALIAS_MAX, DASHBOARD_COLUMNS, DASHBOARD_MAX_CARDS, DASHBOARD_MAX_ROWS,
                                               DASHBOARD_MIN_H, DASHBOARD_MIN_W, DEFAULTS, EVENTS, MAX_LEAVE,
                                               MAX_SNIPPETS, PERSONA_MAX, PERSONAS, SETUP_HIDDEN_MAX, SIGNATURE_MAX, SNIPPET_MAX,
                                               STATUSES)
from backend.utils.security import uid
from backend.utils.validation import require

TIME = re.compile(r'([01]\d|2[0-3]):[0-5]\d')
SHORTCUT = re.compile(r'[a-z0-9ก-๙][a-z0-9ก-๙_-]{0,29}')
CARD = re.compile(r'[a-z][a-z0-9_]{0,29}')


def merged(saved):
    """The saved preferences over the defaults (a section added later reads as its default)."""
    found = copy.deepcopy(DEFAULTS)
    if not isinstance(saved,dict):
        return found
    for key,value in saved.items():
        if key not in found:
            continue
        if isinstance(found[key],dict) and isinstance(value,dict):
            found[key].update({k:v for k,v in value.items() if k in found[key]})
            if key=='notify':
                found[key]['events'] = {**DEFAULTS['notify']['events'],**{k:bool(v) for k,v in (value.get('events') or {}).items() if k in EVENTS}}
            # The board's base is not in the defaults (no base means "follow the organization"), so it is carried
            # across by name rather than dropped with the keys the defaults do not know.
            if key=='dashboard' and value.get('base')=='page':
                found[key]['base'] = 'page'
        elif key=='setup_hidden':
            found[key] = [t for t in value if isinstance(t,str)][:SETUP_HIDDEN_MAX] if isinstance(value,list) else []
        else:
            found[key] = value
    return found


def _text(value, maximum, name):
    require(isinstance(value,str),f'ข้อมูล{name}ไม่ถูกต้อง')
    value = value.replace('\r\n','\n').strip()
    require(len(value)<=maximum,f'{name}ยาวได้ไม่เกิน {maximum} ตัวอักษร')
    require(not any(ord(c)<32 and c not in '\n\t' for c in value),f'{name}มีอักขระที่ใช้ไม่ได้')
    return value


def _bool(value, name):
    require(isinstance(value,bool),f'ข้อมูล{name}ไม่ถูกต้อง')
    return value


def status(body):
    value = body.get('status')
    require(value in STATUSES,'สถานะไม่ถูกต้อง')
    return value


def hours(value):
    require(isinstance(value,dict),'ข้อมูลเวลาทำงานไม่ถูกต้อง')
    days = value.get('days',[])
    require(isinstance(days,list) and all(isinstance(d,int) and not isinstance(d,bool) and 0<=d<=6 for d in days),'วันทำงานไม่ถูกต้อง')
    start,end = value.get('start',''),value.get('end','')
    require(isinstance(start,str) and isinstance(end,str) and TIME.fullmatch(start) and TIME.fullmatch(end),'เวลาเข้า-เลิกงานต้องเป็นแบบ 09:00')
    require(start!=end,'เวลาเข้างานและเลิกงานต้องไม่ตรงกัน')
    enabled = _bool(value.get('enabled',False),'เวลาทำงาน')
    require(not enabled or days,'กรุณาเลือกวันทำงานอย่างน้อย 1 วัน')
    return {'enabled':enabled,'days':sorted(set(days)),'start':start,'end':end}


def leave(value):
    require(isinstance(value,list) and len(value)<=MAX_LEAVE,f'บันทึกวันลาได้ไม่เกิน {MAX_LEAVE} ช่วง')
    found = []
    for item in value:
        require(isinstance(item,dict),'ข้อมูลวันลาไม่ถูกต้อง')
        try:
            start,end = dt.date.fromisoformat(item.get('from','')),dt.date.fromisoformat(item.get('to',''))
        except (TypeError,ValueError):
            require(False,'วันลาต้องเป็นวันที่ที่ถูกต้อง')
        require(start<=end,'วันสิ้นสุดการลาต้องไม่ก่อนวันเริ่ม')
        require((end-start).days<=366,'ช่วงลาหนึ่งช่วงยาวได้ไม่เกิน 1 ปี')
        found.append({'from':start.isoformat(),'to':end.isoformat(),'note':_text(item.get('note',''),100,'หมายเหตุวันลา')})
    return sorted(found,key=lambda x:x['from'])


def notify(value):
    require(isinstance(value,dict),'ข้อมูลการแจ้งเตือนไม่ถูกต้อง')
    events = value.get('events',{})
    require(isinstance(events,dict) and set(events)<=set(EVENTS),'เหตุการณ์แจ้งเตือนไม่ถูกต้อง')
    return {'desktop':_bool(value.get('desktop',False),'การแจ้งเตือนบนหน้าจอ'),'sound':_bool(value.get('sound',False),'เสียงเตือน'),
            'email':_bool(value.get('email',False),'การแจ้งเตือนทางอีเมล'),
            'celebrate':_bool(value.get('celebrate',True),'การฉลองเมื่อปิดเคส'),
            'recap':_bool(value.get('recap',True),'สรุปผลงานประจำเดือน'),
            'events':{key:_bool(events.get(key,True),'เหตุการณ์แจ้งเตือน') for key in EVENTS}}


def signature(value):
    require(isinstance(value,dict),'ข้อมูลลายเซ็นไม่ถูกต้อง')
    text = _text(value.get('text',''),SIGNATURE_MAX,'ลายเซ็น')
    enabled = _bool(value.get('enabled',False),'ลายเซ็น')
    require(not enabled or text,'กรุณาพิมพ์ลายเซ็นก่อนเปิดใช้')
    return {'enabled':enabled,'text':text}


def assistant(value):
    """The AI assistant's personality: one of PERSONAS; 'custom' with the character described in a few words."""
    require(isinstance(value,dict) and value.get('persona') in PERSONAS,'เลือกบุคลิกของผู้ช่วย AI')
    custom = _text(value.get('custom',''),PERSONA_MAX,'บุคลิกที่ระบุ')
    require(value['persona']!='custom' or len(custom)>=3,'บอกบุคลิกที่อยากให้เป็น อย่างน้อย 3 ตัวอักษร')
    return {'persona':value['persona'],'custom':custom if value['persona']=='custom' else ''}


def thanks(value):
    """The member's part of the thank-you card: their photo on it or not, and their own words (plain text)."""
    from backend.modules.automation.thanks import MESSAGE_MAX
    require(isinstance(value,dict),'ข้อมูลการ์ดขอบคุณไม่ถูกต้อง')
    return {'photo':_bool(value.get('photo',False),'การแสดงรูปในการ์ดขอบคุณ'),
            'message':_text(value.get('message',''),MESSAGE_MAX,'ข้อความในการ์ดขอบคุณ')}


def alias(value):
    value = _text(value,ALIAS_MAX,'ชื่อที่แสดงต่อลูกค้า')
    require(not value or any(c.isalpha() for c in value),'ชื่อที่แสดงต่อลูกค้าต้องมีตัวอักษร')
    return value


def snippets(value):
    require(isinstance(value,list) and len(value)<=MAX_SNIPPETS,f'บันทึกคำตอบด่วนได้ไม่เกิน {MAX_SNIPPETS} รายการ')
    found,seen = [],set()
    for item in value:
        require(isinstance(item,dict),'ข้อมูลคำตอบด่วนไม่ถูกต้อง')
        shortcut = item.get('shortcut','')
        require(isinstance(shortcut,str),'คีย์ลัดไม่ถูกต้อง')
        shortcut = shortcut.strip().lstrip('/').lower()
        require(SHORTCUT.fullmatch(shortcut),'คีย์ลัดใช้ตัวอักษร ตัวเลข _ และ - ไม่เกิน 30 ตัว เช่น ขอบคุณ หรือ thanks')
        require(shortcut not in seen,f'คีย์ลัด /{shortcut} ซ้ำกัน')
        seen.add(shortcut)
        text = _text(item.get('text',''),SNIPPET_MAX,'ข้อความคำตอบด่วน')
        require(text,f'กรุณาพิมพ์ข้อความของ /{shortcut}')
        given = item.get('id')
        found.append({'id':given if isinstance(given,str) and re.fullmatch(r'[a-f0-9]{32}',given) else uid(),
                      'shortcut':shortcut,'text':text})
    return found


def _card_ids(value, name):
    """Card names, each once, in the order given. Unknown names are kept: the screen owns the list, not the server,
    so a name this release does not draw may be one the next release draws again."""
    require(isinstance(value,list) and len(value)<=DASHBOARD_MAX_CARDS,f'{name}มีรายการมากเกินไป')
    found = []
    for item in value:
        require(isinstance(item,str) and CARD.fullmatch(item),f'{name}ไม่ถูกต้อง')
        if item not in found:
            found.append(item)
    return found


def _square(value, name, low, high):
    require(isinstance(value,int) and not isinstance(value,bool),f'{name}ไม่ถูกต้อง')
    require(low<=value<=high,f'{name}ไม่ถูกต้อง')
    return value


def _box(value):
    """One card's rectangle on the board: it has to fit on it and be big enough to read."""
    require(isinstance(value,dict),'ตำแหน่งการ์ดไม่ถูกต้อง')
    w = _square(value.get('w'),'ความกว้างของการ์ด',DASHBOARD_MIN_W,DASHBOARD_COLUMNS)
    h = _square(value.get('h'),'ความสูงของการ์ด',DASHBOARD_MIN_H,DASHBOARD_MAX_ROWS)
    x = _square(value.get('x'),'ตำแหน่งการ์ด',0,DASHBOARD_COLUMNS-w)
    y = _square(value.get('y'),'ตำแหน่งการ์ด',0,DASHBOARD_MAX_ROWS)
    return {'x':x,'y':y,'w':w,'h':h}


def dashboard(value):
    """How the member laid out their overview: the rectangle each card holds on the board, and the ones they put
    away. Where the gaps are is the member's business and nothing here closes them.

    Two cards on the same squares are the screen's business, not the server's: this is a drawing, and the page the
    member is looking at is the only thing that knows what is on it."""
    require(isinstance(value,dict),'ข้อมูลการจัดหน้าไม่ถูกต้อง')
    boxes = value.get('box',{})
    require(isinstance(boxes,dict) and len(boxes)<=DASHBOARD_MAX_CARDS,'ตำแหน่งการ์ดไม่ถูกต้อง')
    for card in boxes:
        require(isinstance(card,str) and CARD.fullmatch(card),'ตำแหน่งการ์ดไม่ถูกต้อง')
    found = {'hidden':_card_ids(value.get('hidden',[]),'การ์ดที่ซ่อนไว้'),
             'box':{card:_box(box) for card,box in boxes.items()}}
    # base 'page': the member chose the screen's own arrangement over the organization's default. Without it, a
    # board with nothing laid out follows the organization; with it, it is the page as it ships.
    base = value.get('base')
    require(base in (None,'','page'),'ข้อมูลการจัดหน้าไม่ถูกต้อง')
    if base:
        found['base'] = base
    return found


SECTIONS = {'status':lambda v:status({'status':v}),'hours':hours,'leave':leave,'notify':notify,'signature':signature,
            'alias':alias,'snippets':snippets,'dashboard':dashboard,'assistant':assistant,'thanks':thanks}


def update(current, body):
    """The preferences after a save: each section given is checked and replaces the saved one."""
    require(isinstance(body,dict) and body and set(body)<=set(SECTIONS),'ข้อมูลการตั้งค่าไม่ถูกต้อง')
    found = copy.deepcopy(current)
    for key,value in body.items():
        found[key] = SECTIONS[key](value)
    return found
