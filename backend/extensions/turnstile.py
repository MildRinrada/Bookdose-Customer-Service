"""Cloudflare Turnstile: the check that says a visitor is a person, on the forms anyone on the internet can send
(the guest web chat's start form). The platform owns one Turnstile widget and sets it in its console
('turnstile' -> {"enabled", "site_key"}); the widget's secret key lives in a private file sealed with the platform's
secret key (utils/secret_box), never in the database, API answers, logs or backups.

  off / no keys   check() does nothing, the form shows no widget: the service works exactly as before.
  on              the page draws the widget, its token comes with the form and is verified once here.

A token is good for one verification only (Cloudflare refuses the second), so a form refused for any other reason
asks the widget for a fresh one. Cloudflare's own failures (timeout, network, 5xx, a key that does not work) never
shut a real customer out of support: the request goes on and the event 'captcha_unavailable' says it happened. Only a
visitor's own missing, wrong, expired or reused token is refused ('captcha_failed'). Nothing here runs inside a
database transaction, and the request is never redirected, so the secret key only ever goes to Cloudflare's own URL."""
import json
import re
import socket
import urllib.error
import urllib.parse
import urllib.request

from backend.exceptions.errors import APIError
from backend.utils import secret_box
from backend.utils.http import open_without_redirects
from backend.utils.validation import require

SETTING = 'turnstile'
VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
TIMEOUT = 8
FIELD = 'captcha_token'
# The `action` the page renders the widget with: a token minted for another form is not accepted here.
START_ACTION = 'guest-start'
# Keys as Cloudflare writes them (its test keys, e.g. 1x00000000000000000000AA, are the same shape).
SITE_KEY = re.compile(r'[A-Za-z0-9_-]{8,80}')
SECRET_KEY = re.compile(r'[\x21-\x7e]{8,200}')
# Cloudflare's answer when the fault is ours or its own, not the visitor's.
OUR_FAULT = ('missing-input-secret','invalid-input-secret','bad-request','internal-error')
REFUSED = 'ยืนยันว่าคุณไม่ใช่บอทไม่สำเร็จ กรุณาลองส่งอีกครั้ง'


# Settings
def _saved(cd):
    from backend.modules.platform import repository as platform
    try:
        saved = json.loads(platform.setting(cd,SETTING) or '{}')
    except ValueError:
        saved = {}
    return saved if isinstance(saved,dict) else {}


def config(cd):
    """{'enabled', 'site_key', 'configured': the secret key is saved}. Never the secret key itself."""
    saved = _saved(cd)
    return {'enabled':bool(saved.get('enabled')),'site_key':str(saved.get('site_key') or ''),
            'configured':bool(read_secret().get('secret'))}


def ready(cd):
    """True when the widget is switched on and both keys are in place (so the check is really being made)."""
    cfg = config(cd)
    return cfg['enabled'] and bool(cfg['site_key']) and cfg['configured']


def site_key(cd):
    """The key the page needs to draw the widget, or '' when there is nothing to draw (public, not a secret)."""
    return config(cd)['site_key'] if ready(cd) else ''


def secret_path():
    from backend.database import db as D
    return D.DATA/'secrets'/'turnstile.json'


def read_secret():
    try:
        text = secret_box.read_file(secret_path())
        saved = json.loads(text) if text else {}
    except (OSError,ValueError):
        return {}
    return saved if isinstance(saved,dict) else {}


def settings_form(body):
    """({'enabled','site_key'}, the secret key typed now or None) of POST /api/platform/turnstile. The secret may be
    left empty to keep the saved one; the check cannot be switched on without both keys."""
    enabled = body.get('enabled')
    require(isinstance(enabled,bool),'ข้อมูลการเปิดใช้ Turnstile ไม่ถูกต้อง')
    key = _text(body,'site_key',80)
    secret = _text(body,'secret',200)
    require(not key or SITE_KEY.fullmatch(key),'Site Key ของ Turnstile ไม่ถูกต้อง (คัดลอกจากหน้า Turnstile ของ Cloudflare)')
    require(not secret or SECRET_KEY.fullmatch(secret),'Secret Key ของ Turnstile ไม่ถูกต้อง (คัดลอกจากหน้า Turnstile ของ Cloudflare)')
    if enabled:
        require(key,'กรุณาใส่ Site Key ของ Turnstile ก่อนเปิดใช้งาน')
        require(secret or read_secret().get('secret'),'กรุณาใส่ Secret Key ของ Turnstile ก่อนเปิดใช้งาน')
    return {'enabled':enabled,'site_key':key},secret or None


def save(cd, public, secret):
    """Store the choice (the caller commits) and, when a secret key was typed, seal it beside the data."""
    from backend.modules.platform import repository as platform
    if secret:
        secret_box.write_file(secret_path(),json.dumps({'secret':secret}))
    platform.save_setting(cd,SETTING,json.dumps(public))


def _text(body, name, maximum):
    value = body.get(name,'')
    require(isinstance(value,str) and len(value.strip())<=maximum,'ข้อมูล Turnstile ไม่ถูกต้อง')
    return value.strip()


# The check on a form
def check(req, action=START_ACTION):
    """Refuse this request when the visitor's Turnstile token is missing, wrong, expired or already used. Does nothing
    while the check is off or its keys are missing."""
    if not ready(req.cd):
        return
    token = req.body.get(FIELD) if isinstance(req.body,dict) else ''
    token = token.strip() if isinstance(token,str) else ''
    if not token or len(token)>2048:
        _refuse(req,['missing-input-response'])
    answer = verify(read_secret().get('secret'),token,req.ip)
    if answer is None:
        _allow(req,['unreachable'])
        return
    if answer.get('success') is True:
        # A token minted for another of our forms must not open this one.
        if not action or answer.get('action') in (None,'',action):
            return
        _refuse(req,['action-mismatch'])
    codes = [str(code)[:40] for code in (answer.get('error-codes') or [])][:5]
    if any(code in OUR_FAULT for code in codes):
        _allow(req,codes)
        return
    _refuse(req,codes)


def _event(req, kind, codes):
    """The security page shows what Cloudflare said as the subject, so one reason never hides another."""
    from backend.modules.security import events
    org = getattr(req,'org',None) or {}
    events.from_request(req,kind,actor='guest',subject=codes[0] if codes else '',tenant_id=org.get('id'),
                        detail={'error_codes':codes})


def _refuse(req, codes):
    _event(req,'captcha_failed',codes)
    raise APIError(400,REFUSED)


def _allow(req, codes):
    """Cloudflare could not answer or our own keys are wrong: let the visitor through and say so on the security page."""
    _event(req,'captcha_unavailable',codes)


def verify(secret, token, ip):
    """Cloudflare's answer as a dict, or None when it could not be reached (never raises)."""
    if not secret:
        return None
    fields = {'secret':secret,'response':token}
    if ip:
        fields['remoteip'] = ip
    request = urllib.request.Request(VERIFY_URL,data=urllib.parse.urlencode(fields).encode(),method='POST',
                                     headers={'Accept':'application/json','Content-Type':'application/x-www-form-urlencoded'})
    try:
        with open_without_redirects(request,TIMEOUT) as response:
            answer = json.loads(response.read(100_000) or b'{}')
    except urllib.error.HTTPError as error:
        error.close()
        return None
    except (socket.timeout,TimeoutError,OSError,urllib.error.URLError,ValueError):
        return None
    return answer if isinstance(answer,dict) else None
