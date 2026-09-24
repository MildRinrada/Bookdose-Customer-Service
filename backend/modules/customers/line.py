"""Linking a customer account with the LINE of one organization (the official account belongs to the organization, so
a link is made per organization) for the notices the customer wants there. The customer asks for a 6-digit code on
their account page and sends it to the organization's LINE in a 1:1 chat; the webhook (channels.service.ingest_line)
sees a live code, links that LINE user and keeps the message out of the conversations. A LINE confirmation goes out
through the notification outbox.

A code lasts 10 minutes, is stored hashed, and a new one replaces the account's earlier one. Guessing is limited two
ways: a sender (a LINE user, or a group counted under 'group:<id>') who sent 5 wrong codes within an hour is not
checked again until the hour is over, and every wrong code sent to the organization's LINE counts against all live
codes (20 and they stop working; the account page then says so). A wrong code is never answered differently from any
other message: it is stored as a normal message, so trying reveals nothing. A live code is never left where the
team's inbox would keep it: sent by someone over the limit, or read out in a LINE group, it is dropped and stops
working.

A guest of guest web chat (backend/modules/guest) links LINE the same way with a code of its own (guest_line_codes):
the same lifetime and the same limits, and every wrong code counts against the live codes of both."""
import re
import secrets

from backend.database import audit, db as D
from backend.modules.customers import notify, repository
from backend.utils.dates import after, now
from backend.utils.security import token_hash
from backend.utils.validation import require

CODE = re.compile(r'[0-9]{6}')
CODE_MINUTES = 10
MAX_GUESSES = 5               # wrong codes per LINE user (or group) per hour
MAX_CODE_ATTEMPTS = 20        # wrong codes sent to the organization's LINE while a code lives
NOT_AVAILABLE = 'องค์กรนี้ยังไม่ได้เปิดการแจ้งเตือนทาง LINE'


def _oa_name(row):
    return (row['config'].get('display_name') or 'LINE Official Account') if row else ''


def status(db, org, session):
    """{available, linked, linked_at, oa_name, code_expires_at}: whether the organization's LINE can send notices,
    whether this account is linked with it, and until when the code asked for last still works."""
    row = notify.line_channel(db,org['id'])
    link = repository.line_link(db,session['account_id'])
    pending = repository.pending_line_code(db,session['account_id'])
    return {'available':bool(row),'linked':bool(link),'linked_at':link['linked_at'] if link else None,'oa_name':_oa_name(row),
            'code_expires_at':pending['expires_at'] if pending and row else None}


def unused_code(db):
    """A random 6-digit code that no live code of an account or a guest has (almost always the first try)."""
    for _ in range(10):
        code = f'{secrets.randbelow(10**6):06d}'
        if not _live_code(db,token_hash(code))[0]:
            break
    return code


def _live_code(db, code_hash):
    """('account', row), ('guest', row) or ('move', row) - a chat going to LINE (channels/move.py) - of a live code,
    else (None, None)."""
    from backend.modules.channels import move
    from backend.modules.guest import repository as guests
    code = repository.live_line_code(db,code_hash)
    if code:
        return 'account',code
    code = guests.live_line_code(db,code_hash)
    if code:
        return 'guest',code
    code = move.live_line_code(db,code_hash)
    return ('move',code) if code else (None,None)


def _drop_code(db, owner, code):
    from backend.modules.channels import move
    from backend.modules.guest import repository as guests
    if owner=='account':
        repository.delete_line_codes(db,code['account_id'])
    elif owner=='move':
        move.delete_code(db,code['conversation_id'])
    else:
        guests.delete_line_codes(db,code['visitor_id'])


def new_code(db, org, session):
    """A new 6-digit code for this account (the earlier one stops working): {code, expires_at, oa_name}."""
    row = notify.line_channel(db,org['id'])
    require(row,NOT_AVAILABLE,409)
    D.begin(db)
    code = unused_code(db)
    expires_at = after(minutes=CODE_MINUTES)
    repository.replace_line_code(db,token_hash(code),session['account_id'],expires_at)
    db.commit()
    return {'code':code,'expires_at':expires_at,'oa_name':_oa_name(row)}


def unlink(db, session):
    D.begin(db)
    repository.delete_line_link(db,session['account_id'])
    repository.delete_line_codes(db,session['account_id'])
    audit.record(db,session['name'],'customer.line_unlinked',session['account_id'])
    db.commit()


def _wrong_code(db, sender, window):
    from backend.modules.channels import move
    from backend.modules.guest import repository as guests
    repository.record_line_guess(db,sender,window)
    for table in (repository,guests,move):
        table.count_wrong_code(db,now())
        table.drop_worn_codes(db,MAX_CODE_ATTEMPTS)


def take_code(db, tenant_id, line_user_id, text):
    """A text message from a 1:1 LINE user (inside the webhook event's transaction): True when it was a live code and
    the LINE user is now linked with that account (the caller keeps the message out of the conversations), else
    False (the message goes on as a normal one). Only reads the control database."""
    value = text.strip()
    if not CODE.fullmatch(value):
        return False
    window = after(hours=-1)
    guesses = repository.line_guesses(db,line_user_id)
    owner,code = _live_code(db,token_hash(value))
    if guesses and guesses['since']>window and guesses['failures']>=MAX_GUESSES:
        # Not checked for this sender, but a live code must never sit in the team's inbox where anyone could reuse
        # it: it stops working (the page offers a new one) and the message is dropped. One hit per guess, so no help.
        if code:
            _drop_code(db,owner,code)
        return bool(code)
    if not code or code['attempts']>=MAX_CODE_ATTEMPTS:
        _wrong_code(db,line_user_id,window)
        return False
    if owner=='guest':
        from backend.modules.guest import service as guests
        guests.link_line(db,code['visitor_id'],line_user_id)
        return True
    if owner=='move':
        from backend.modules.channels import move
        move.take(db,tenant_id,code,line_user_id)
        return True
    repository.set_line_link(db,code['account_id'],line_user_id)
    repository.delete_line_codes(db,code['account_id'])
    audit.record(db,'LINE','customer.line_linked',code['account_id'])
    with D.control() as cd:
        notify.queue_line(cd,db,tenant_id,code['account_id'],'เชื่อม LINE กับบัญชีลูกค้าเรียบร้อยแล้ว จากนี้การแจ้งเตือนจะส่งมาที่แชทนี้ ตั้งค่าได้ที่',
                          '/customer/account')
    return True


def drop_group_code(db, group_id, text):
    """A text message inside a LINE group the organization's LINE is in (inside the webhook event's transaction): a
    code read out there is seen by everyone in the group and would stay in the team's inbox, so a live one stops
    working and the message is dropped (True). Nothing is ever linked from a group; wrong codes are counted per group
    ('group:<id>') like a user's."""
    value = text.strip()
    if not CODE.fullmatch(value):
        return False
    owner,code = _live_code(db,token_hash(value))
    if code:
        _drop_code(db,owner,code)
        return True
    window,sender = after(hours=-1),'group:'+group_id
    guesses = repository.line_guesses(db,sender)
    if not guesses or guesses['since']<=window or guesses['failures']<MAX_GUESSES:
        _wrong_code(db,sender,window)
    return False
