"""Encryption of stored secrets: the credentials of LINE, Facebook, email and OpenAI, the platform's SMTP password and
the shared secrets of two-factor sign-in. Each is sealed with AES-256-GCM before it is written, so a copied data
folder, a stray file or a database dump does not give the tokens away without the key.

The key
  BOOKDOSE_SECRET_KEY        32 random bytes, base64 (make one with: python -m backend.utils.secret_box new-key).
                             Set it on a real server and keep it out of the data folder and its backups.
  otherwise                  a key file made on first use: <data>/keys/secret.key (readable only by this account).
                             Fine for one machine; it lives next to the data it protects, so set the variable instead
                             wherever the data folder is copied or backed up as a whole.
  BOOKDOSE_SECRET_KEY_OLD    earlier keys, comma separated, still accepted for reading while the key is changed.
                             Whatever is read with an old key is sealed again with the current one.

A sealed value is text: 'bdsec1.<key id>.<base64url(nonce + ciphertext + tag)>'. The key id is the start of the key's
SHA-256, so the right key is picked without trying every one. `context` is authenticated with the value (for example
the file name '<tenant>.line.json'), so a sealed value copied into another organization's file or another account's
row does not open. A value that is not sealed (written before encryption existed) is read as it is and reported,
so the caller seals it on the spot."""
import base64
import hashlib
import os
import secrets
import sys
import threading

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from backend.utils.files import write_private_file

PREFIX = 'bdsec1'
KEY_BYTES = 32
NONCE_BYTES = 12
KEY_FILE_WARNING = ('Secrets are encrypted with a key file inside the data folder; set BOOKDOSE_SECRET_KEY on a '
                    'server whose data folder is copied or backed up.')

_lock = threading.Lock()
_cache = {}


class SecretError(Exception):
    """A sealed value that no known key opens (a wrong or missing key, a changed value, or another context)."""


def _decode_key(text, name):
    try:
        raw = base64.urlsafe_b64decode(text.strip()+'='*(-len(text.strip())%4))
    except (ValueError, TypeError):
        raw = b''
    if len(raw)!=KEY_BYTES:
        raise SecretError(f'{name} must be {KEY_BYTES} random bytes in base64')
    return raw


def key_id(key):
    return hashlib.sha256(key).hexdigest()[:8]


def _key_file():
    from backend.database import db as D
    return D.DATA/'keys'/'secret.key'


def _keys():
    """(current key, {key id: key} of every key that may open a value). The key file is made once, when no
    variable is set; the answer is kept per data folder and environment."""
    current_text = os.environ.get('BOOKDOSE_SECRET_KEY','').strip()
    old_text = os.environ.get('BOOKDOSE_SECRET_KEY_OLD','')
    path = None if current_text else _key_file()
    cache_key = (current_text,old_text,str(path))
    with _lock:
        if cache_key in _cache:
            return _cache[cache_key]
        if current_text:
            current = _decode_key(current_text,'BOOKDOSE_SECRET_KEY')
        elif path.is_file():
            current = _decode_key(path.read_text(),str(path))
        else:
            current = secrets.token_bytes(KEY_BYTES)
            write_private_file(path,base64.urlsafe_b64encode(current).decode()+'\n')
            print(KEY_FILE_WARNING,file=sys.stderr,flush=True)
        known = {key_id(current):current}
        for part in (p for p in old_text.split(',') if p.strip()):
            old = _decode_key(part,'BOOKDOSE_SECRET_KEY_OLD')
            known.setdefault(key_id(old),old)
        _cache[cache_key] = (current,known)
        return current,known


def current_key_id():
    """The id of the key new values are sealed with (never the key itself): what a backup records."""
    return key_id(_keys()[0])


def available_key_ids():
    """The ids of the keys this server could open values with - from the variables, or the key file when there is one
    - without making a new key file (a restore asks before anything is written)."""
    found = set()
    current_text = os.environ.get('BOOKDOSE_SECRET_KEY','').strip()
    if current_text:
        found.add(key_id(_decode_key(current_text,'BOOKDOSE_SECRET_KEY')))
    elif _key_file().is_file():
        found.add(key_id(_decode_key(_key_file().read_text(),str(_key_file()))))
    for part in (p for p in os.environ.get('BOOKDOSE_SECRET_KEY_OLD','').split(',') if p.strip()):
        found.add(key_id(_decode_key(part,'BOOKDOSE_SECRET_KEY_OLD')))
    return found


def key_source():
    """'environment' or 'file': where the current key comes from (shown to the platform admin)."""
    return 'environment' if os.environ.get('BOOKDOSE_SECRET_KEY','').strip() else 'file'


def is_sealed(stored):
    return isinstance(stored,str) and stored.startswith(PREFIX+'.')


def seal(text, context):
    """The sealed form of `text`, bound to `context`."""
    current,_ = _keys()
    nonce = secrets.token_bytes(NONCE_BYTES)
    sealed = AESGCM(current).encrypt(nonce,text.encode('utf-8'),context.encode('utf-8'))
    return f'{PREFIX}.{key_id(current)}.'+base64.urlsafe_b64encode(nonce+sealed).decode().rstrip('=')


def unseal(stored, context):
    """(text, needs sealing again): the value opened with the key it names. A value that was never sealed comes back
    as it is, with True, and so does one opened with an old key."""
    if not is_sealed(stored):
        return stored,True
    current,known = _keys()
    try:
        _,kid,body = stored.split('.',2)
        raw = base64.urlsafe_b64decode(body+'='*(-len(body)%4))
    except (ValueError, TypeError):
        raise SecretError('A stored secret is damaged') from None
    key = known.get(kid)
    if key is None or len(raw)<=NONCE_BYTES:
        raise SecretError('A stored secret was sealed with a key this server does not have (BOOKDOSE_SECRET_KEY)')
    try:
        text = AESGCM(key).decrypt(raw[:NONCE_BYTES],raw[NONCE_BYTES:],context.encode('utf-8')).decode('utf-8')
    except InvalidTag:
        raise SecretError('A stored secret does not open: it was changed, or belongs somewhere else') from None
    return text,key is not current


# Private files (data/secrets)
def read_file(path):
    """The text of a private secret file ('' when there is none). A file from before encryption, or one sealed with an
    old key, is sealed again with the current key as it is read."""
    if not path.is_file():
        return ''
    try:
        text,stale = unseal(path.read_text().strip(),path.name)
    except SecretError as error:
        # Treated as not set up: the admin sees the channel unconfigured and enters the credentials again, which
        # replaces the file. Never a crash on every request, never the sealed text used as a token.
        print(f'{path.name}: {error}',file=sys.stderr,flush=True)
        return ''
    if stale and text:
        write_private_file(path,seal(text,path.name))
    return text


def write_file(path, text):
    write_private_file(path,seal(text,path.name))


def seal_existing_files():
    """At start: every secret file still in plain text is sealed (and one sealed with an old key is sealed again)."""
    from backend.database import db as D
    folder = D.DATA/'secrets'
    if not folder.is_dir():
        return 0
    count = 0
    for path in sorted(folder.iterdir()):
        if path.is_file() and not path.name.startswith('.'):
            content = path.read_text().strip()
            if content and (not is_sealed(content) or content.split('.',2)[1]!=key_id(_keys()[0])):
                read_file(path)
                count += 1
    return count


# Values kept in a database column (the shared secret of two-factor sign-in)
def seal_value(text, context):
    return seal(text,context) if text else text


def unseal_value(stored, context):
    """The text of a sealed column value; a value from before encryption comes back as it is."""
    return unseal(stored,context)[0] if stored else stored


if __name__=='__main__':
    if sys.argv[1:]==['new-key']:
        print(base64.urlsafe_b64encode(secrets.token_bytes(KEY_BYTES)).decode())
    else:
        print('usage: python -m backend.utils.secret_box new-key')
