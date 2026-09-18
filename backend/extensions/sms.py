"""Text messages (SMS) to a phone number: the follow links of guest web chat and the notices of a guest who proved a
phone number. The platform chooses the provider in its setting 'sms' ({"provider", "sender", "account"}):
  off          nothing can be sent (the default; the page hides the SMS option)
  log          for testing: the text is written to the server log instead of being sent
  thaibulksms  ThaiBulkSMS (api-v2.thaibulksms.com): Thai numbers, a sender name registered with ThaiBulkSMS
  twilio       Twilio (api.twilio.com): any country, from a Twilio number or a Messaging Service
The provider's credentials (ThaiBulkSMS API key and secret, the Twilio auth token) live in a private file sealed with
the platform's secret key (utils/secret_box), never in the database, API answers, logs or backups; each provider keeps
its own, so switching back and forth does not lose them. Callers only use ready() and send(). Nothing here runs inside
a database transaction, and a request is never redirected, so a credential only ever goes to the provider's own URL."""
import base64
import json
import re
import socket
import urllib.error
import urllib.parse
import urllib.request

from backend.exceptions.errors import APIError, ChannelError
from backend.utils import secret_box
from backend.utils.http import open_without_redirects
from backend.utils.validation import require

PROVIDERS = ('off','log','thaibulksms','twilio')
REAL = ('thaibulksms','twilio')
TIMEOUT = 15
THAIBULKSMS_URL = 'https://api-v2.thaibulksms.com/sms'
TWILIO_URL = 'https://api.twilio.com/2010-04-01/Accounts/{account}/Messages.json'


# Settings
def _saved(cd):
    from backend.modules.platform import repository as platform
    try:
        saved = json.loads(platform.setting(cd,'sms') or '{}')
    except ValueError:
        saved = {}
    return saved if isinstance(saved,dict) else {}


def config(cd):
    """{'provider', 'sender', 'account', 'configured': {provider: its credentials are saved}}; provider 'off' when
    unset or unreadable. Never the credentials themselves."""
    saved = _saved(cd)
    provider = saved.get('provider') if saved.get('provider') in PROVIDERS else 'off'
    secrets = read_secret()
    return {'provider':provider,'sender':str(saved.get('sender') or ''),'account':str(saved.get('account') or ''),
            'configured':{name:_complete(name,secrets.get(name)) for name in REAL}}


def ready(cd):
    cfg = config(cd)
    return cfg['provider']=='log' or (cfg['provider'] in REAL and cfg['configured'][cfg['provider']])


def _complete(provider, secret):
    if not isinstance(secret,dict):
        return False
    return bool(secret.get('key') and secret.get('secret')) if provider=='thaibulksms' else bool(secret.get('secret'))


def secret_path():
    from backend.database import db as D
    return D.DATA/'secrets'/'sms.json'


def read_secret():
    try:
        text = secret_box.read_file(secret_path())
        saved = json.loads(text) if text else {}
    except (OSError,ValueError):
        return {}
    return saved if isinstance(saved,dict) else {}


def settings_form(body):
    """({'provider','sender','account'}, the credentials typed now or None) of POST /api/platform/sms. Credentials may
    be left empty to keep the saved ones; a provider cannot be switched on without them."""
    provider = body.get('provider')
    require(provider in PROVIDERS,'ผู้ให้บริการ SMS ไม่ถูกต้อง')
    public = {'provider':provider,'sender':'','account':''}
    if provider not in REAL:
        return public,None
    saved = read_secret().get(provider) or {}
    sender = _text(body,'sender',40)
    typed = {}
    if provider=='thaibulksms':
        require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9 ._-]{0,10}',sender),
                'ชื่อผู้ส่งต้องเป็นชื่อที่ลงทะเบียนกับ ThaiBulkSMS แล้ว (ตัวอักษรภาษาอังกฤษหรือตัวเลข ไม่เกิน 11 ตัว)')
        for name,label in (('key','API Key'),('secret','API Secret')):
            value = _text(body,name,200)
            require(value or saved.get(name),f'กรุณาใส่ {label} ของ ThaiBulkSMS')
            if value:
                require(re.fullmatch(r'[\x21-\x7e]{8,200}',value),f'{label} ไม่ถูกต้อง')
                typed[name] = value
    else:
        account = _text(body,'account',34)
        require(re.fullmatch(r'AC[0-9a-fA-F]{32}',account),'Account SID ของ Twilio ขึ้นต้นด้วย AC ตามด้วยตัวอักษร 32 ตัว')
        require(re.fullmatch(r'\+[1-9][0-9]{6,14}',sender) or re.fullmatch(r'MG[0-9a-fA-F]{32}',sender),
                'ผู้ส่งของ Twilio ต้องเป็นเบอร์ในรูปแบบสากล เช่น +15551234567 หรือ Messaging Service SID (MG…)')
        public['account'] = account
        value = _text(body,'secret',64)
        require(value or saved.get('secret'),'กรุณาใส่ Auth Token ของ Twilio')
        if value:
            require(re.fullmatch(r'[0-9a-fA-F]{32}',value),'Auth Token ของ Twilio เป็นตัวอักษร 32 ตัว (0-9, a-f)')
            typed['secret'] = value
    public['sender'] = sender
    return public,typed or None


def save(cd, public, typed):
    """Store the choice (the caller commits) and, when credentials were typed, the provider's sealed credentials."""
    from backend.modules.platform import repository as platform
    if typed:
        secrets = read_secret()
        secrets[public['provider']] = {**(secrets.get(public['provider']) or {}),**typed}
        secret_box.write_file(secret_path(),json.dumps(secrets))
    platform.save_setting(cd,'sms',json.dumps(public))


def _text(body, name, maximum):
    value = body.get(name,'')
    require(isinstance(value,str) and len(value.strip())<=maximum,'ข้อมูลผู้ให้บริการ SMS ไม่ถูกต้อง')
    return value.strip()


# Sending
def _log(line):
    print(line,flush=True)


def send(cd, phone, text):
    """Send `text` to `phone` (E.164, e.g. +66812345678). Raises ChannelError: 'disabled' while off or without
    credentials; 'credentials', 'credit', 'rejected' (sending again will not help), 'temporary' / 'network' (retryable,
    nothing was sent) or 'unknown' (uncertain: the provider may have sent it)."""
    cfg = config(cd)
    provider = cfg['provider']
    if provider=='log':
        _log(f'[SMS test] to {phone}: {text}')
        return
    secret = read_secret().get(provider) if provider in REAL else None
    if provider not in REAL or not _complete(provider,secret):
        raise ChannelError('disabled')
    if provider=='thaibulksms':
        _thaibulksms(cfg,secret,phone,text)
    else:
        _twilio(cfg,secret,phone,text)


def _basic(user, password):
    return 'Basic '+base64.b64encode(f'{user}:{password}'.encode()).decode()


def _post(url, authorization, fields):
    """(status, JSON answer) of a form POST; the credentials go only in the header of this one request."""
    request = urllib.request.Request(url,data=urllib.parse.urlencode(fields).encode(),method='POST',
                                     headers={'Authorization':authorization,'Accept':'application/json',
                                              'Content-Type':'application/x-www-form-urlencoded'})
    try:
        with open_without_redirects(request,TIMEOUT) as response:
            return response.status,_json(response.read(100_000))
    except urllib.error.HTTPError as error:
        status = error.code
        try:
            answer = _json(error.read(100_000))
        except OSError:
            answer = {}
        error.close()
        return status,answer
    except (socket.timeout,TimeoutError):
        # The request may have reached the provider: never sent again automatically.
        raise ChannelError('unknown',uncertain=True) from None
    except (OSError,urllib.error.URLError):
        raise ChannelError('network',retryable=True) from None


def _json(raw):
    try:
        value = json.loads(raw or b'{}')
    except ValueError:
        return {}
    return value if isinstance(value,dict) else {}


def _failure(status, words=''):
    """The ChannelError of a refused request."""
    if status in (401,403):
        return ChannelError('credentials')
    if status==402 or 'credit' in words.lower() or 'balance' in words.lower():
        return ChannelError('credit')
    if status==429 or status>=500:
        return ChannelError('temporary',retryable=True)
    return ChannelError('rejected')


def thai_number(phone):
    """ThaiBulkSMS takes Thai mobile numbers written the local way (0812345678)."""
    if not re.fullmatch(r'\+66[0-9]{8,9}',phone):
        raise ChannelError('rejected')
    return '0'+phone[3:]


def _thaibulksms(cfg, secret, phone, text):
    number = thai_number(phone)
    status,answer = _post(THAIBULKSMS_URL,_basic(secret['key'],secret['secret']),
                          {'msisdn':number,'message':text,'sender':cfg['sender']})
    if status in (200,201):
        if number in [str(n.get('number') if isinstance(n,dict) else n) for n in answer.get('bad_phone_number_list') or []]:
            raise ChannelError('rejected')
        return
    error = answer.get('error') if isinstance(answer.get('error'),dict) else {}
    raise _failure(status,f"{error.get('name','')} {error.get('description','')}")


def _twilio(cfg, secret, phone, text):
    sender = cfg['sender']
    fields = {'To':phone,'Body':text,**({'MessagingServiceSid':sender} if sender.startswith('MG') else {'From':sender})}
    status,answer = _post(TWILIO_URL.format(account=urllib.parse.quote(cfg['account'])),_basic(cfg['account'],secret['secret']),fields)
    if status in (200,201):
        return
    # Twilio's code 20003 is a refused sign-in whatever the status says.
    raise _failure(401 if answer.get('code')==20003 else status,str(answer.get('message') or ''))


def send_test(cd, phone):
    """The platform console's test message; the provider's refusal comes back as a readable 502."""
    try:
        send(cd,phone,'ข้อความทดสอบจาก Bookdose Customer Service: ตั้งค่า SMS เรียบร้อยแล้ว')
    except ChannelError as failure:
        raise APIError(502,f'ส่ง SMS ทดสอบไม่สำเร็จ: {failure}') from None
