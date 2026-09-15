"""Automation form validation: rules, macros, settings, follow-ups, CSAT ratings and the dashboard time zone."""
import re

from backend.exceptions.errors import APIError
from backend.modules.automation.model import MACRO_STATUSES, RULE_CHANNELS
from backend.modules.tickets.model import PRIORITIES
from backend.utils.validation import require, field

MAX_KEYWORDS = 20
ID = re.compile(r'[a-f0-9]{32}')
THAI_DIGITS = str.maketrans('๑๒๓๔๕','12345')


def _flag(body, key, default):
    value = body.get(key,default)
    require(type(value) is bool,f'ข้อมูล {key} ไม่ถูกต้อง')
    return value


def _optional_id(body, key):
    value = body.get(key,'') or ''
    require(isinstance(value,str) and (not value or ID.fullmatch(value)),f'ข้อมูล {key} ไม่ถูกต้อง')
    return value


def _number(body, key, message, cast=float):
    try:
        return cast(body.get(key,0) or 0)
    except (TypeError,ValueError):
        raise APIError(400,message) from None


def keywords(body):
    """Words separated by commas or new lines, stored one per line; duplicates (ignoring case) are dropped."""
    raw = body.get('keywords','')
    require(isinstance(raw,str) and len(raw)<=2000,'คำค้นไม่ถูกต้อง')
    words = []
    for word in re.split(r'[,\n]',raw):
        word = ' '.join(word.split())
        if word and word.lower() not in (w.lower() for w in words):
            require(len(word)<=60,'คำค้นแต่ละคำยาวไม่เกิน 60 ตัวอักษร')
            words.append(word)
    require(len(words)<=MAX_KEYWORDS,f'ใส่คำค้นได้สูงสุด {MAX_KEYWORDS} คำ')
    return '\n'.join(words)


def rule_form(body):
    values = {'name':field(body,'name',100),'enabled':_flag(body,'enabled',True),'channel':body.get('channel','') or '',
              'keywords':keywords(body),'set_priority':body.get('set_priority','') or '',
              'set_team_id':_optional_id(body,'set_team_id'),'set_assignee_id':_optional_id(body,'set_assignee_id')}
    require(values['channel'] in RULE_CHANNELS,'ช่องทางไม่ถูกต้อง')
    require(values['set_priority'] in ('',)+PRIORITIES,'ความเร่งด่วนไม่ถูกต้อง')
    require(values['set_priority'] or values['set_team_id'] or values['set_assignee_id'],'กรุณาเลือกสิ่งที่ระบบต้องทำอย่างน้อย 1 อย่าง')
    return values


def macro_form(body):
    hours = _number(body,'followup_hours','ชั่วโมงติดตามผลต้องเป็นตัวเลข')
    values = {'name':field(body,'name',100),'reply':field(body,'reply',5000,False),
              'set_status':body.get('set_status','') or '','followup_hours':hours}
    require(values['set_status'] in MACRO_STATUSES,'สถานะไม่ถูกต้อง')
    require(0<=hours<=720,'ตั้งเตือนติดตามผลได้ 0-720 ชั่วโมง')
    require(values['reply'] or values['set_status'] or hours,'กรุณาเลือกสิ่งที่ Macro ต้องทำอย่างน้อย 1 อย่าง')
    return values


def settings_form(body):
    """[(setting key, value)] for SLA escalation and the CSAT survey."""
    minutes = _number(body,'escalation_minutes','กรุณาระบุนาทีเป็นตัวเลข',int)
    require(1<=minutes<=1440,'เวลายกระดับต้องอยู่ระหว่าง 1-1,440 นาที')
    return [('escalation_enabled','1' if _flag(body,'escalation_enabled',True) else '0'),('escalation_minutes',str(minutes)),
            ('csat_enabled','1' if _flag(body,'csat_enabled',True) else '0'),('csat_message',field(body,'csat_message',1000))]


def followup_form(body):
    """(hours from now, note)"""
    hours = _number(body,'hours','กรุณาระบุชั่วโมงเป็นตัวเลข')
    require(0.25<=hours<=720,'ตั้งเตือนได้ 0.25-720 ชั่วโมง')
    return hours,field(body,'note',300,False)


def run_target(body):
    """('ticket' | 'conversation', id): a macro runs on exactly one case or one conversation."""
    ticket,conversation = body.get('ticket_id'),body.get('conversation_id')
    require(bool(ticket)!=bool(conversation),'กรุณาเลือกเคสหรือบทสนทนาที่ต้องการใช้ Macro')
    value = ticket or conversation
    require(isinstance(value,str) and ID.fullmatch(value),'รายการไม่ถูกต้อง')
    return ('ticket' if ticket else 'conversation'),value


def rating(body):
    value = body.get('rating')
    require(type(value) is int and 1<=value<=5,'กรุณาเลือกคะแนน 1-5')
    return value


def survey_comment(body):
    """What the customer adds in words to their stars (optional)."""
    value = body.get('comment','')
    require(isinstance(value,str) and len(value)<=1000,'ความคิดเห็นยาวได้ไม่เกิน 1,000 ตัวอักษร')
    return value.strip()


def rating_from_text(text):
    """A customer's answer to the survey typed as a message ("5", "๕", "4 ดาว", "⭐⭐⭐"), or None for anything else."""
    value = str(text or '').strip().translate(THAI_DIGITS)
    match = re.fullmatch(r'([1-5])\s*(?:ดาว|คะแนน|/\s*5)?',value)
    if match:
        return int(match[1])
    stars = value.replace('️','').replace(' ','')
    if stars and set(stars)<={'⭐','★'} and len(stars)<=5:
        return len(stars)
    return None


def tz_offset(query):
    """The browser's getTimezoneOffset() in minutes (UTC minus local time); 0 when missing or out of range."""
    try:
        value = int((query.get('tz') or ['0'])[0])
    except ValueError:
        return 0
    return value if -840<=value<=840 else 0
