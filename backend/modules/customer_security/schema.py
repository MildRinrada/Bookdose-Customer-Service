"""Forms and views of the customer account's security: what a request may contain, and what is shown back. A code
or a recovery code is never echoed, and neither is a token, a secret or a public key."""
import re

from backend.modules.customer_security.model import ACTIVITY_LABELS, RECOVERY_ALPHABET, RECOVERY_GROUP
from backend.utils.validation import field, require

DIGITS = re.compile(r'[0-9]{6}')
RECOVERY = re.compile(f'[{RECOVERY_ALPHABET}]{{{2*RECOVERY_GROUP}}}')
WRONG_CODE = 'รหัสยืนยันไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่'


def code(body, key='code'):
    """The 6 digits from the authenticator app."""
    value = (body.get(key) or '')
    require(isinstance(value,str),WRONG_CODE)
    value = re.sub(r'[\s-]','',value)
    require(DIGITS.fullmatch(value),WRONG_CODE)
    return value


def recovery_code(body, key='recovery_code'):
    """One of the printed codes, typed with or without its dash and in any case."""
    value = (body.get(key) or '')
    require(isinstance(value,str),WRONG_CODE)
    value = re.sub(r'[\s-]','',value).upper()
    require(RECOVERY.fullmatch(value),WRONG_CODE)
    return value


def second_step(body):
    """('code' | 'recovery', what was typed) of the sign-in's second step; exactly one of the two is sent."""
    if body.get('recovery_code'):
        return 'recovery',recovery_code(body)
    return 'code',code(body)


def passkey_name(body, required=False):
    """The name the customer gives a passkey ('' becomes a name made from the browser)."""
    return field(body,'name',60,required)


def credential(body):
    """The answer of navigator.credentials.create() / .get(), checked further in webauthn.py."""
    value = body.get('credential')
    require(isinstance(value,dict) and isinstance(value.get('response'),dict),'ข้อมูลจาก Passkey ไม่ถูกต้อง กรุณาลองใหม่')
    return value


def keep_current(body):
    value = body.get('keep_current',True)
    require(isinstance(value,bool),'ข้อมูลไม่ถูกต้อง')
    return value


def page(query):
    """?page=<n> of the activity list (0 upwards). Plain ASCII digits only: str.isdigit() is also true of ² and ①,
    which int() then refuses - anything else is simply the first page."""
    value = (query.get('page') or ['0'])[0]
    return int(value) if value.isascii() and value.isdigit() and len(value)<6 else 0


# Views
BROWSERS = (('Edg','Edge'),('OPR','Opera'),('Chrome','Chrome'),('Firefox','Firefox'),('Line','LINE'),('Safari','Safari'))
SYSTEMS = (('Windows','Windows'),('Android','Android'),('iPhone','iPhone'),('iPad','iPad'),('Mac OS','Mac'),
           ('CrOS','ChromeOS'),('Linux','Linux'))


def device_name(user_agent):
    """A short readable name for the device a session was opened from, e.g. 'Chrome บน Windows'."""
    if not user_agent:
        return 'อุปกรณ์ที่ไม่ทราบชื่อ'
    browser = next((name for token,name in BROWSERS if token in user_agent),'')
    system = next((name for token,name in SYSTEMS if token in user_agent),'')
    if browser and system:
        return f'{browser} บน {system}'
    return browser or system or 'อุปกรณ์ที่ไม่ทราบชื่อ'


def session_view(row, current_token_hash):
    return {'id':row['id'],'device':device_name(row['user_agent']),'user_agent':row['user_agent'],'ip':row['ip'],
            'created_at':row['created_at'],'last_seen_at':row['last_seen_at'] or row['created_at'],
            'expires_at':row['expires_at'],'current':row['token_hash']==current_token_hash}


def passkey_view(row):
    """A registered passkey as the list shows it; the public key and the credential id stay on the server."""
    return {'id':row['id'],'name':row['name'],'created_at':row['created_at'],'last_used_at':row['last_used_at'],
            'alg':row['alg']}


def activity_view(row):
    return {'at':row['created_at'],'action':row['action'],'label':ACTIVITY_LABELS.get(row['action'],row['action']),
            'detail':row['detail'],'ip':row['ip'],'device':device_name(row['user_agent'])}
