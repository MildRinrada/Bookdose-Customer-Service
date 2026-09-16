"""Time-based one-time passwords (RFC 6238 over RFC 4226): HMAC-SHA-1, 6 digits, a new code every 30 seconds,
the step before and after accepted so a slow clock still works. The caller remembers the last step a code was
accepted for, and a step is never accepted twice - a code read over someone's shoulder is of no use once used."""
import base64
import hashlib
import hmac
import secrets
import time
from urllib.parse import quote

DIGITS = 6
PERIOD = 30
WINDOW = 1          # steps accepted on either side of now
SECRET_BYTES = 20   # 160 bits, the size RFC 4226 recommends (32 base32 characters)


def new_secret():
    """A fresh shared secret as base32 text, the form authenticator apps read."""
    return base64.b32encode(secrets.token_bytes(SECRET_BYTES)).decode()


def _key(secret):
    return base64.b32decode(secret,casefold=True)


def step_now(at=None):
    return int((at if at is not None else time.time())//PERIOD)


def code(secret, step):
    """The 6 digits of one step (RFC 4226 dynamic truncation)."""
    digest = hmac.new(_key(secret),step.to_bytes(8,'big'),hashlib.sha1).digest()
    offset = digest[-1]&0x0F
    value = int.from_bytes(digest[offset:offset+4],'big')&0x7FFFFFFF
    return str(value%10**DIGITS).zfill(DIGITS)


def check(secret, entered, last_step, at=None):
    """The step the entered code belongs to, or 0 when it is wrong, too old, or a step already used (last_step).
    Every step in the window is tried with a constant-time compare, whatever the answer turns out to be."""
    # Plain ASCII digits only: isdigit() is also true of ², which compare_digest() then refuses to look at.
    if not isinstance(entered,str) or not entered.isascii() or not entered.isdigit() or len(entered)!=DIGITS:
        return 0
    now = step_now(at)
    matched = 0
    for step in range(now-WINDOW,now+WINDOW+1):
        if hmac.compare_digest(code(secret,step),entered) and step>last_step:
            matched = step
    return matched


def uri(secret, account_email, issuer):
    """The otpauth:// address an authenticator app reads from the QR code."""
    label = quote(f'{issuer}:{account_email}',safe='')
    return (f'otpauth://totp/{label}?secret={secret}&issuer={quote(issuer,safe="")}'
            f'&algorithm=SHA1&digits={DIGITS}&period={PERIOD}')
