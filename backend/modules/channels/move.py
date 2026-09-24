"""คุยต่อใน LINE: a customer who started on the organization's web chat carries that same chat to its LINE, history and
all, instead of starting over there and telling it again.

On the chat page they ask for a 6-digit code and send it to the organization's LINE in a 1:1 chat (a link opens LINE
with the code typed in). The webhook (channels.service.ingest_line -> customers.line.take_code) finds the live code,
keeps the message out of the conversations and moves the chat:

- the conversation's channel becomes LINE and that LINE user is its channel link, so what they write on LINE lands in
  it and the team's replies go out on LINE - the team keeps working in the same thread, with everything said before;
- a LINE chat the user already had with the organization keeps its history and can still be answered, but new LINE
  messages from them come to the moved chat;
- a confirmation goes to LINE, as a system message in the thread (it is not the team's first response);
- the chat stays readable on the web page, which says it continues on LINE and offers the link instead of a box.

Codes share the notice codes' limits (customers/line.py): 10 minutes, hashed, one live code per chat, a sender with
5 wrong codes in an hour is not checked, and every wrong code counts against every live code. """
from urllib.parse import quote

from backend.database import audit
from backend.database.db import begin, one
from backend.modules.channels import repository
from backend.modules.conversations import repository as conversations
from backend.realtime import events as realtime
from backend.utils.dates import after, now
from backend.utils.security import token_hash, uid
from backend.utils.validation import require

CODE_MINUTES = 10
NOT_AVAILABLE = 'องค์กรนี้ยังไม่ได้เปิดแชททาง LINE'
SYSTEM_ACTOR = '@system'   # outbox actor of the confirmation (channels.service.sender_permitted)


def _basic_id(row):
    return (row['config'].get('basic_id') or '').strip() if row else ''


def _open_url(row, text=''):
    """A link that opens the chat with the organization's LINE (with `text` typed in), or '' without its LINE ID."""
    basic_id = _basic_id(row)
    if not basic_id:
        return ''
    return 'https://line.me/R/oaMessage/'+quote(basic_id,safe='')+'/'+('?'+quote(text,safe='') if text else '')


def _oa_name(row):
    return (row['config'].get('display_name') or 'LINE Official Account') if row else ''


def moved(db, conversation_id):
    return one(db,'SELECT * FROM conversation_moves WHERE conversation_id=?',(conversation_id,))


def offer(db, tenant_id, conv):
    """For the customer's chat page: whether this chat can go to LINE, or where it went. None when neither."""
    from backend.modules.customers import notify
    row = notify.line_channel(db,tenant_id)
    if moved(db,conv['id']):
        return {'moved':True,'oa_name':_oa_name(row),'open_url':_open_url(row)}
    if not row or conv['channel']!='web':
        return None
    return {'moved':False,'oa_name':_oa_name(row),'open_url':_open_url(row),'code_expires_at':_pending(db,conv['id'])}


def _pending(db, conversation_id):
    code = one(db,'SELECT expires_at FROM line_move_codes WHERE conversation_id=? AND expires_at>?',(conversation_id,now()))
    return code['expires_at'] if code else None


def new_code(db, tenant_id, conv):
    """POST .../line/continue: a 6-digit code for this chat (the earlier one stops working)."""
    from backend.modules.customers import notify
    from backend.modules.customers.line import unused_code
    row = notify.line_channel(db,tenant_id)
    require(row,NOT_AVAILABLE,409)
    require(not moved(db,conv['id']),'แชทนี้ย้ายไปคุยต่อใน LINE แล้ว',409)
    require(conv['channel']=='web','ย้ายไป LINE ได้เฉพาะแชทบนเว็บ',409)
    begin(db)
    code = unused_code(db)
    expires_at = after(minutes=CODE_MINUTES)
    db.execute('DELETE FROM line_move_codes WHERE conversation_id=? OR expires_at<=?',(conv['id'],now()))
    db.execute('INSERT INTO line_move_codes(code_hash,conversation_id,expires_at,created_at) VALUES(?,?,?,?)',
               (token_hash(code),conv['id'],expires_at,now()))
    db.commit()
    return {'code':code,'expires_at':expires_at,'oa_name':_oa_name(row),'send_url':_open_url(row,code),
            'add_url':'https://line.me/R/ti/p/'+quote(_basic_id(row),safe='') if _basic_id(row) else ''}


# The code limits (customers/line.py), for this table as for the notice codes'.
def live_line_code(db, code_hash):
    return one(db,'SELECT * FROM line_move_codes WHERE code_hash=? AND expires_at>?',(code_hash,now()))


def delete_code(db, conversation_id):
    db.execute('DELETE FROM line_move_codes WHERE conversation_id=?',(conversation_id,))


def count_wrong_code(db, since):
    db.execute('UPDATE line_move_codes SET attempts=attempts+1 WHERE expires_at>?',(since,))


def drop_worn_codes(db, max_attempts):
    db.execute('DELETE FROM line_move_codes WHERE attempts>=?',(max_attempts,))


def take(db, tenant_id, code, line_user_id):
    """The code came from this LINE user (inside the webhook event's transaction): move its chat to LINE."""
    from backend.modules.ai import repository as ai_repository, service as ai
    from backend.modules.channels import service as channels
    delete_code(db,code['conversation_id'])
    conv = conversations.find(db,code['conversation_id'])
    row = channels.setting(db,'line')
    if not conv or conv['channel']!='web' or not row:
        return
    # The LINE chat this user already had keeps its history and can still be answered; their new messages come here.
    db.execute("UPDATE channel_conversations SET external_key='moved:'||conversation_id WHERE route_id=? AND external_key=?",
               (row['route_id'],line_user_id))
    repository.insert_link(db,conv['id'],row['route_id'],line_user_id,line_user_id,row['config']['identity'])
    repository.insert_line_thread(db,conv['id'],'user',line_user_id,now())
    db.execute("UPDATE conversations SET channel='line',updated_at=? WHERE id=?",(now(),conv['id']))
    db.execute('INSERT INTO conversation_moves(conversation_id,line_user_id,moved_at) VALUES(?,?,?)',(conv['id'],line_user_id,now()))
    # The web chatbot does not follow to LINE unless the organization has one there.
    if ai.conversation_state(db,conv['id'])['mode']=='bot' and not channels.bot_enabled(db,{**conv,'channel':'line'}):
        ai.stop_bot(db,conv['id'],'moved_to_line')
    # The confirmation, on LINE and in the thread: from the system, so it is not the team's first response.
    mid = uid()
    conversations.insert_message(db,mid,conv['id'],None,'ระบบ','reply',
                                 f'ย้ายแชท "{conv["subject"]}" มาคุยต่อใน LINE แล้ว ทีมงานเห็นข้อความเดิมทั้งหมด พิมพ์ต่อที่นี่ได้เลย')
    ai_repository.insert_message_meta(db,mid,'system','[]')
    channels.enqueue_reply(db,{'tenant_id':tenant_id,'id':SYSTEM_ACTOR},conversations.find(db,conv['id']),mid)
    audit.record(db,'LINE','conversation.moved_to_line',conv['id'])
    realtime.conversation(db,conv['id'])
