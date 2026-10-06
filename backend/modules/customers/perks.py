"""What a customer gets for signing in, beyond what a guest of the web chat has (the known-issue follow is in
incidents/follow.py):

  follows       ต่อจากเรื่องเดิม: a new chat names the earlier chat of theirs it carries on from, and the team sees that
                chat at once instead of asking the customer to tell it all again (conversation_follows).
  reopen_case   ยังไม่หาย: a case finished within REOPEN_DAYS goes back to the team from the case page, with what is
                still wrong, as a message in the case's chat (so the chat, the case and its owner all hear of it).
  resolve_case  แก้ไขแล้ว: the customer finishes their own case from its page, as a member would - the survey and the
                thank-you card follow - and the case's history and its owner say the customer did.
  export_*      ดาวน์โหลดประวัติ: a chat or a case, as a plain text file the customer keeps (only what they can read on
                the page; never the team's internal notes).
  members_first คิวก่อนสำหรับสมาชิก: the organization may let its signed-in customers go ahead of guests in the queue
                (off unless the organization turns it on in ตั้งค่าองค์กร → แชทบนเว็บไซต์)."""
import datetime as dt

from backend.database import audit, db as D
from backend.database.db import one
from backend.modules.customers import repository, schema
from backend.utils.dates import now
from backend.utils.validation import require

REOPEN_DAYS = 7
REOPEN_TEXT_MAX = 1000
MEMBERS_FIRST = 'members_first'
THAI = dt.timezone(dt.timedelta(hours=7))
STATUS_WORDS = {'new':'ใหม่','open':'กำลังดำเนินการ','pending_customer':'รอข้อมูลจากคุณ','pending_internal':'กำลังดำเนินการ',
                'resolved':'แก้ไขแล้ว','closed':'ปิดแล้ว'}


# ต่อจากเรื่องเดิม
def follows_form(db, account_id, body):
    """The earlier chat a new one carries on from: one of this customer's own in this organization, or None."""
    value = body.get('follows')
    if not value:
        return None
    require(isinstance(value,str),'เรื่องเดิมที่เลือกไม่ถูกต้อง')
    earlier = repository.owned_conversation(db,account_id,schema.conversation_id(value))
    require(earlier,'ไม่พบเรื่องเดิมที่เลือกในบัญชีของคุณ',404)
    return earlier['id']


def set_follow(db, conversation_id, follows_id):
    db.execute('INSERT OR REPLACE INTO conversation_follows(conversation_id,follows_id,created_at) VALUES(?,?,?)',
               (conversation_id,follows_id,now()))


def follow_of(db, conversation_id):
    """{id, subject, status, updated_at, ticket_number} of the chat this one carries on from, or None."""
    return one(db,'''SELECT c.id,c.subject,c.status,c.updated_at,
                         (SELECT t.number FROM tickets t JOIN ticket_conversations tc ON tc.ticket_id=t.id
                          WHERE tc.conversation_id=c.id ORDER BY t.created_at DESC LIMIT 1) AS ticket_number
                     FROM conversation_follows f JOIN conversations c ON c.id=f.follows_id WHERE f.conversation_id=?''',
               (conversation_id,))


# ยังไม่หาย
def reopen_until(case):
    """Until when a finished case can be sent back from the case page (None when it is not finished)."""
    if case['status'] not in ('resolved','closed'):
        return None
    finished = case['resolved_at'] or case['updated_at']
    moment = dt.datetime.fromisoformat(finished.replace('Z','+00:00'))+dt.timedelta(days=REOPEN_DAYS)
    return moment.astimezone(dt.timezone.utc).isoformat(timespec='seconds')


def can_reopen(case):
    until = reopen_until(case)
    return bool(until and until>now())


def reopen_case(db, tenant_id, session, case_id, body):
    """Send a finished case back to the team: what is still wrong goes into the case's chat as the customer's message,
    which reopens the case and tells its owner (conversations.store_message). A case with no chat of the customer's
    is reopened on its own and its owner told. Returns the chat to open, or None."""
    from backend.modules.portal import service as portal
    from backend.modules.tickets import repository as tickets
    case = repository.owned_case(db,session['account_id'],schema.case_id(case_id))
    require(case,'ไม่พบเคสนี้ในบัญชีของคุณ',404)
    require(case['status'] in ('resolved','closed'),'เคสนี้ยังอยู่ระหว่างดำเนินการ ส่งข้อความในแชทได้เลย',409)
    require(can_reopen(case),f'เคสนี้ปิดไปเกิน {REOPEN_DAYS} วันแล้ว กรุณาเริ่มแชทใหม่ และเลือกว่าต่อจากเรื่องเดิม',409)
    text = body.get('message','') if isinstance(body,dict) else ''
    require(isinstance(text,str) and len(text.strip())<=REOPEN_TEXT_MAX,f'รายละเอียดไม่เกิน {REOPEN_TEXT_MAX} ตัวอักษร')
    line = 'ปัญหายังไม่หาย'+(f': {text.strip()}' if text.strip() else '')
    chats = repository.case_conversations(db,session['account_id'],case['id'])
    from backend.modules.channels import move
    chat = next((c for c in chats if not move.moved(db,c['id'])),None)
    if chat:
        portal.post_customer_message(db,tenant_id,repository.owned_conversation(db,session['account_id'],chat['id']),session,{'body':line})
    D.begin(db)
    if not chat:
        ticket = one(db,'SELECT assignee_id FROM tickets WHERE id=?',(case['id'],))
        tickets.reopen(db,case['id'],'customer')
        if ticket and ticket['assignee_id']:
            from backend.modules.staff_prefs import service as staff_prefs
            staff_prefs.queue(db,ticket['assignee_id'],'customer_reply',f"ลูกค้าแจ้งว่าปัญหายังไม่หาย เคส BD-{case['number']}",
                              f"{case['subject']}\n\n{line[:300]}",f"/tickets/{case['id']}")
    audit.record(db,session['name'],'ticket.customer_reopened',case['id'],line[:300])
    db.commit()
    return chat['id'] if chat else None


# แก้ไขแล้ว
def can_resolve(case):
    return case['status'] not in ('resolved','closed')


def resolve_case(db, tenant_id, session, case_id):
    """The customer says their problem is solved: the case is resolved as a member would resolve it (automation/
    closing.py: the survey, the thank-you card, a raised hand lowered; the history says the customer did it and
    its owner is told). The organization's required case fields are the team's to fill, so they do not stand in the
    customer's way."""
    from backend.modules.automation import closing
    case = repository.owned_case(db,session['account_id'],schema.case_id(case_id))
    require(case,'ไม่พบเคสนี้ในบัญชีของคุณ',404)
    require(can_resolve(case),'เคสนี้จบไปแล้ว',409)
    D.begin(db)
    closing.finish(db,tenant_id,one(db,'SELECT * FROM tickets WHERE id=?',(case['id'],)),session['name'])
    db.commit()


# ดาวน์โหลดประวัติ
def _when(value):
    try:
        moment = dt.datetime.fromisoformat(str(value).replace('Z','+00:00'))
    except ValueError:
        return str(value or '')
    return moment.astimezone(THAI).strftime('%d/%m/%Y %H:%M')


def _messages(db, conversation_id):
    from backend.modules.conversations import service as conversation_service
    lines = []
    for m in conversation_service.message_list(db,conversation_id,True):
        who = m.get('author_name') or ('คุณ' if m.get('kind')=='customer' else 'ทีมงาน')
        lines.append(f"[{_when(m.get('created_at'))}] {who}")
        if (m.get('body') or '').strip():
            lines.append(m['body'].strip())
        for f in m.get('attachments') or []:
            lines.append(f"(ไฟล์แนบ: {f.get('name','')})")
        lines.append('')
    return lines


def _file(lines):
    # With a byte-order mark, so Notepad and Excel on Windows read the Thai correctly.
    return ('﻿'+'\r\n'.join(lines)).encode('utf-8')


def export_conversation(db, org, session, conversation_id):
    """(file name, type, bytes) of one of the customer's chats."""
    from backend.modules.tickets import repository as tickets
    conv = repository.owned_conversation(db,session['account_id'],schema.conversation_id(conversation_id))
    require(conv,'ไม่พบเรื่องนี้ในบัญชีของคุณ',404)
    ticket = tickets.for_conversation(db,conv['id'])
    head = [f"ประวัติการคุย: {conv['subject']}",f"องค์กร: {org['name']}"]
    if ticket:
        head.append(f"เคส: BD-{ticket['number']} ({STATUS_WORDS.get(ticket['status'],ticket['status'])})")
    head += [f"เริ่มคุย: {_when(conv['created_at'])}",f"ดาวน์โหลดเมื่อ: {_when(now())}",'-'*48,'']
    name = f"chat-{'BD-'+str(ticket['number']) if ticket else conv['id'][:8]}-{dt.datetime.now(THAI):%Y%m%d}.txt"
    return name,'text/plain; charset=utf-8',_file(head+_messages(db,conv['id']))


def export_case(db, org, session, case_id):
    """(file name, type, bytes) of one of the customer's cases, with every chat of it the customer can read."""
    case = repository.owned_case(db,session['account_id'],schema.case_id(case_id))
    require(case,'ไม่พบเคสนี้ในบัญชีของคุณ',404)
    lines = [f"เคส BD-{case['number']}: {case['subject']}",f"องค์กร: {org['name']}",
             f"สถานะ: {STATUS_WORDS.get(case['status'],case['status'])}",f"เปิดเคส: {_when(case['created_at'])}"]
    if case['resolved_at']:
        lines.append(f"แก้ไขเสร็จ: {_when(case['resolved_at'])}")
    lines += [f"ดาวน์โหลดเมื่อ: {_when(now())}",'-'*48,'']
    for chat in reversed(repository.case_conversations(db,session['account_id'],case['id'])):
        lines += [f"== แชท: {chat['subject']} ==",'']+_messages(db,chat['id'])
    return f"case-BD-{case['number']}-{dt.datetime.now(THAI):%Y%m%d}.txt",'text/plain; charset=utf-8',_file(lines)


# คิวก่อนสำหรับสมาชิก
def members_first(db):
    row = one(db,'SELECT value FROM settings WHERE key=?',(MEMBERS_FIRST,))
    return bool(row and row['value']=='1')


def set_members_first(db, on):
    db.execute('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)',(MEMBERS_FIRST,'1' if on else '0'))


def member_contacts(db):
    """The contacts that are signed-in customers' own in this organization."""
    return {row[0] for row in db.execute('SELECT DISTINCT contact_id FROM customer_contacts')}

