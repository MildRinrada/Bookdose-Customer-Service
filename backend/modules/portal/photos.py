"""รูปทีมงานในแชทของลูกค้า: beside a team reply on the customer's web chat (the support page, the guest chat, the
customer page), the photo of the member who wrote it. On until the member turns it off (ตั้งค่าบัญชี → ข้อมูลส่วนตัว →
สิ่งที่ลูกค้าเห็นเมื่อคุณตอบ, staff_prefs 'chat_photo'); with it off, without a photo, or once they have left the
organization, the customer sees the initials of the name on the reply, as before.

The customer's copy of a thread never carries the writer's id (conversations/repository.list_messages), so a reply
carries a key instead: a hash of the member's id and of their picture as it is now. It says nothing about who wrote
it, opens only that one picture, and changes when the picture does, so the browser may keep a picture for a day and
still never show an old one."""
import base64
import binascii
import hashlib

from backend.database import db as D
from backend.database.db import rows
from backend.exceptions.errors import APIError

PICTURE = "p.avatar LIKE 'data:image/png;base64,%'"


def _key(user_id, size, tail):
    return hashlib.sha256(f'{user_id}:{size}:{tail}'.encode()).hexdigest()[:32]


def _members(cd, db, user_ids=None):
    """(user_id, key) of this organization's members with a picture who let customers see it; only these ids when
    given."""
    from backend.modules.staff_prefs import service as staff_prefs
    where,params = '',[D.tenant_id_of(db)]
    if user_ids is not None:
        if not user_ids:
            return []
        where = f" AND p.user_id IN ({','.join('?'*len(user_ids))})"
        params += list(user_ids)
    found = rows(cd,f'''SELECT p.user_id,LENGTH(p.avatar) AS size,substr(p.avatar,-48) AS tail FROM user_profiles p
                       JOIN memberships m ON m.user_id=p.user_id AND m.tenant_id=? WHERE {PICTURE}{where}''',tuple(params))
    return [(r['user_id'],_key(r['user_id'],r['size'],r['tail'])) for r in found if staff_prefs.prefs_of(cd,r['user_id'])['chat_photo']]


def mark(cd, db, conversation_id, messages):
    """Each team reply in the customer's copy of a thread gets `photo`: the key of its writer's picture, or None."""
    for message in messages:
        message['photo'] = None
    if cd is None:
        return messages
    authors = {r['id']:r['author_id'] for r in rows(db,"SELECT id,author_id FROM messages WHERE conversation_id=? AND kind='reply' AND author_id IS NOT NULL",(conversation_id,))}
    keys = dict(_members(cd,db,sorted(set(authors.values()))))
    for message in messages:
        if message['kind']=='reply':
            message['photo'] = keys.get(authors.get(message['id']))
    return messages


def photo(cd, db, key):
    """The PNG a reply's key opens, while its member still lets customers see it."""
    user_id = next((u for u,k in _members(cd,db) if k==key),None)
    if not user_id:
        raise APIError(404,'ไม่พบรูป')
    stored = (D.one(cd,'SELECT avatar FROM user_profiles WHERE user_id=?',(user_id,)) or {}).get('avatar','')
    try:
        return base64.b64decode(stored.split(',',1)[1],validate=True)
    except (ValueError,IndexError,binascii.Error):
        raise APIError(404,'ไม่พบรูป') from None
