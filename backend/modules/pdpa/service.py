"""เครื่องมือ PDPA: a person asks what the platform holds about them, or asks to be erased. The platform console finds them
in every organization at once, then gives them a file of all of it or erases it, and keeps a record of who did which,
when and why (model.pdpa_requests; each organization's own history says so too).

Found by email, phone (any way it is written: 081-234-5678, +66812345678) or name, in:
- the customer account (the platform's; one account for every organization it joined),
- each organization's customer records, its guest web-chat visitors, and the records linked to that account.
What a search shows is counts, never the conversations: the content leaves only by export, which is recorded.

The export (a ZIP): the account and its sign-in history, and per organization the customer record, the guest
details, every conversation as the customer saw it (the team's internal notes are the organization's, not in it)
with its files, and the cases with their ratings. data.json holds it all; README.txt says what is where.

The erasure: the account and everything that signs in as it are deleted; in each organization the customer record
keeps its row (so cases and reports still add up) with nothing left that says who it was - name, email, phone,
company, notes, profile gone; every message of their conversations emptied and its files deleted; subjects, AI
summaries, translations, mood readings, channel addresses (LINE / email), guest browsers and links, ratings'
comments and follow-up notes cleared; the recycle bin's copies thrown away. Backups made before still hold it until
they age out; the console says so. """
import datetime as dt
import io
import json
import re
import zipfile

from backend.database import audit, db as D
from backend.database.db import one, rows
from backend.modules.pdpa.model import CONFIRM_WORD, ERASED_NAME, ERASED_TEXT
from backend.utils.dates import now
from backend.utils.security import token_hash, uid
from backend.utils.validation import require

MAX_RESULTS = 200
EMAIL = re.compile(r'[^@\s]+@[^@\s]+\.[^@\s]+')


# What was asked for
def phone_digits(value):
    """0812345678 for 081-234-5678, +66 81 234 5678 or 66812345678; '' when there are too few digits."""
    digits = re.sub(r'\D','',value or '')
    if digits.startswith('66') and len(digits)==11:
        digits = '0'+digits[2:]
    return digits if len(digits)>=6 else ''


def _query(body):
    """(kind, value): 'email', 'phone' or 'name' and what to look for."""
    text = body.get('query')
    require(isinstance(text,str) and 3<=len(text.strip())<=200,'พิมพ์อีเมล เบอร์โทร หรือชื่อ อย่างน้อย 3 ตัวอักษร')
    text = text.strip()
    if '@' in text:
        require(EMAIL.fullmatch(text),'อีเมลไม่ถูกต้อง')
        return 'email',text.lower()
    if phone_digits(text) and not re.search(r'[^\d\s+()\-.]',text):
        return 'phone',phone_digits(text)
    return 'name',text.lower()


def _hit(kind, value, name, email, phone):
    if kind=='email':
        return (email or '').strip().lower()==value
    if kind=='phone':
        return phone_digits(phone)==value
    return value in (name or '').lower()


def masked(kind, value):
    """What the log keeps of the person: enough to recognise the request, not enough to be the data."""
    if kind=='email':
        local,domain = value.split('@',1)
        return f'{local[:2]}***@{domain}'
    if kind=='phone':
        return f'{value[:3]}-xxx-{value[-4:]}'
    return f'{value[:1]}*** (ชื่อ)'


# Finding the person
def _tenants(cd):
    return [t for t in rows(cd,'SELECT id,name,slug,status FROM tenants ORDER BY name') if D.tenant_path(t['id']).is_file()]


def _accounts(cd, kind, value):
    return [a for a in rows(cd,'SELECT id,name,email,phone,created_at,last_login_at FROM customer_accounts')
            if _hit(kind,value,a['name'],a['email'],a['phone'])]


def _record(db, tenant, contact_id):
    """One customer record of one organization, as the search lists it: who, and how much there is (counts only)."""
    contact = one(db,'SELECT id,name,email,phone,company,created_at FROM contacts WHERE id=?',(contact_id,))
    if not contact:
        return None
    count = lambda sql: db.execute(sql,(contact_id,)).fetchone()[0]
    account = one(db,'SELECT account_id FROM customer_contacts WHERE contact_id=?',(contact_id,))
    profile = one(db,'SELECT deletion_requested_at FROM contact_profiles WHERE contact_id=?',(contact_id,))
    return {'tenant_id':tenant['id'],'tenant_name':tenant['name'],'tenant_slug':tenant['slug'],'contact_id':contact_id,
            'name':contact['name'],'email':contact['email'],'phone':contact['phone'],'company':contact['company'],
            'created_at':contact['created_at'],'account_id':account['account_id'] if account else None,
            'guest':bool(count('SELECT COUNT(*) FROM guest_visitors WHERE contact_id=?')),
            'conversations':count('SELECT COUNT(*) FROM conversations WHERE contact_id=?'),
            'cases':count('SELECT COUNT(*) FROM tickets WHERE contact_id=?'),
            'messages':count("SELECT COUNT(*) FROM messages WHERE kind='customer' AND deleted_at IS NULL AND conversation_id IN (SELECT id FROM conversations WHERE contact_id=?)"),
            'files':count("SELECT COUNT(*) FROM attachments WHERE message_id IN (SELECT m.id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.contact_id=? AND m.kind!='note')"),
            'deletion_requested_at':profile['deletion_requested_at'] if profile else None,
            'erased':contact['name']==ERASED_NAME}


def search(cd, body):
    """Everything that matches, in every organization; counts only."""
    kind,value = _query(body)
    accounts = _accounts(cd,kind,value)
    account_ids = {a['id'] for a in accounts}
    records = []
    for tenant in _tenants(cd):
        with D.tenant(tenant['id']) as db:
            found = {c['id'] for c in rows(db,'SELECT id,name,email,phone FROM contacts') if _hit(kind,value,c['name'],c['email'],c['phone'])}
            found |= {g['contact_id'] for g in rows(db,'SELECT contact_id,name,email,phone FROM guest_visitors')
                      if g['contact_id'] and _hit(kind,value,g['name'],g['email'],g['phone'])}
            if account_ids:
                marks = ','.join('?'*len(account_ids))
                found |= {r[0] for r in db.execute(f'SELECT contact_id FROM customer_contacts WHERE account_id IN ({marks})',tuple(account_ids))}
            for contact_id in sorted(found):
                record = _record(db,tenant,contact_id)
                if record:
                    records.append(record)
        if len(records)>=MAX_RESULTS:
            break
    return {'kind':kind,'subject':masked(kind,value),'accounts':accounts,'records':records[:MAX_RESULTS],
            'more':len(records)>MAX_RESULTS}


def _selection(cd, body):
    """(accounts, {tenant id: [contact ids]}) of what the admin ticked; an account brings every record linked to it."""
    wanted_accounts,wanted_records = body.get('accounts',[]),body.get('records',[])
    require(isinstance(wanted_accounts,list) and isinstance(wanted_records,list) and (wanted_accounts or wanted_records),
            'เลือกข้อมูลอย่างน้อยหนึ่งรายการ')
    accounts = []
    for account_id in wanted_accounts:
        account = one(cd,'SELECT * FROM customer_accounts WHERE id=?',(account_id,)) if isinstance(account_id,str) else None
        require(account,'ไม่พบบัญชีลูกค้าที่เลือก',404)
        accounts.append(account)
    tenants = {t['id']:t for t in _tenants(cd)}
    chosen = {}
    for item in wanted_records:
        require(isinstance(item,dict) and item.get('tenant_id') in tenants and isinstance(item.get('contact_id'),str),'ข้อมูลที่เลือกไม่ถูกต้อง')
        chosen.setdefault(item['tenant_id'],set()).add(item['contact_id'])
    for tenant_id in tenants:
        with D.tenant(tenant_id) as db:
            for account in accounts:
                chosen.setdefault(tenant_id,set()).update(r[0] for r in db.execute('SELECT contact_id FROM customer_contacts WHERE account_id=?',(account['id'],)))
            if tenant_id in chosen:
                real = {r[0] for r in db.execute(f"SELECT id FROM contacts WHERE id IN ({','.join('?'*len(chosen[tenant_id]))})",tuple(chosen[tenant_id]))} if chosen[tenant_id] else set()
                require(real==chosen[tenant_id],'ไม่พบข้อมูลลูกค้าบางรายการที่เลือก',404)
    return accounts,{tenant_id:sorted(ids) for tenant_id,ids in chosen.items() if ids},tenants


def _reason(body):
    reason = body.get('reason')
    require(isinstance(reason,str) and 5<=len(reason.strip())<=300,'บอกที่มาของคำขอ เช่น อีเมลจากลูกค้าเมื่อวันที่ … (5-300 ตัวอักษร)')
    return reason.strip()


def _log(cd, session, kind, body, scope, reason):
    what,value = _query(body)
    actor = session.get('name') or session['user_id']
    cd.execute('INSERT INTO pdpa_requests VALUES(?,?,?,?,?,?,?,?,?)',
               (uid(),kind,masked(what,value),token_hash(value),json.dumps(scope,ensure_ascii=False),reason,session['user_id'],actor,now()))
    audit.record(cd,session['user_id'],'pdpa.'+('exported' if kind=='export' else 'erased'),masked(what,value),reason)


# The file of everything
def _safe(name):
    return re.sub(r'[^\w.\-ก-๙]+','_',name)[:80] or 'file'


def _account_data(cd, account):
    keep = ('name','email','phone','created_at','verified_at','last_login_at','consent_version','consent_at','email_verified')
    return {**{k:account[k] for k in keep if k in account.keys()},
            'organizations_joined':rows(cd,'SELECT t.name AS organization,o.joined_at FROM customer_orgs o JOIN tenants t ON t.id=o.tenant_id WHERE o.account_id=?',(account['id'],)),
            'sign_ins':rows(cd,'SELECT created_at,last_seen_at,user_agent,ip FROM customer_sessions WHERE account_id=? ORDER BY created_at',(account['id'],)),
            'activity':rows(cd,'SELECT created_at,action,detail,ip,user_agent FROM customer_activity WHERE account_id=? ORDER BY created_at',(account['id'],)),
            'passkeys':rows(cd,'SELECT name,created_at,last_used_at FROM customer_passkeys WHERE account_id=?',(account['id'],))}


def _contact_data(db, tenant, contact_id, archive):
    contact = one(db,'SELECT name,email,phone,company,created_at FROM contacts WHERE id=?',(contact_id,))
    data = {'organization':tenant['name'],'customer_record':contact,
            'name_parts':one(db,'SELECT first_name,last_name FROM contact_names WHERE contact_id=?',(contact_id,)),
            'profile':one(db,'''SELECT preferred_channel,contact_hours,language,consent,consent_at,deletion_requested_at
                                FROM contact_profiles WHERE contact_id=?''',(contact_id,)),
            'guest_chat':rows(db,'''SELECT name,email,email_verified_at,phone,phone_verified_at,created_at,last_seen_at
                                     FROM guest_visitors WHERE contact_id=?''',(contact_id,)),
            'conversations':[],'cases':[]}
    for conv in rows(db,'SELECT id,subject,channel,status,created_at,updated_at FROM conversations WHERE contact_id=? ORDER BY created_at',(contact_id,)):
        address = one(db,'SELECT recipient FROM channel_conversations WHERE conversation_id=?',(conv['id'],))
        messages = []
        for m in rows(db,"""SELECT id,author_name,kind,body,created_at,edited_at FROM messages WHERE conversation_id=? AND kind!='note'
                            AND deleted_at IS NULL ORDER BY created_at,rowid""",(conv['id'],)):
            files = []
            for file in rows(db,'SELECT id,name,mime,size,storage_key FROM attachments WHERE message_id=?',(m['id'],)):
                path = D.DATA/'files'/tenant['id']/file['storage_key']
                if path.is_file():
                    inside = f"files/{_safe(tenant['slug'])}/{conv['id'][:8]}/{file['id'][:8]}-{_safe(file['name'])}"
                    archive.write(path,inside)
                    files.append({'name':file['name'],'type':file['mime'],'size':file['size'],'file':inside})
            messages.append({'from':'ลูกค้า (เจ้าของข้อมูล)' if m['kind']=='customer' else 'ทีมงาน','name':m['author_name'],
                             'text':m['body'],'at':m['created_at'],'edited_at':m['edited_at'],'files':files})
        data['conversations'].append({'subject':conv['subject'],'channel':conv['channel'],'status':conv['status'],
                                      'started_at':conv['created_at'],'last_at':conv['updated_at'],
                                      'channel_address':address['recipient'] if address else None,'messages':messages})
    from backend.modules.tickets import fields
    case_fields = fields.catalog(db)
    for case in rows(db,'''SELECT t.id,t.number,t.subject,t.status,t.priority,t.category,t.created_at,t.resolved_at FROM tickets t
                           WHERE t.contact_id=? ORDER BY t.created_at''',(contact_id,)):
        ratings = rows(db,'SELECT rating,comment,answered_at FROM csat_surveys WHERE ticket_id=? AND answered_at IS NOT NULL',(case['id'],))
        # The organization's own case fields (tickets/fields.py) may hold what the customer told the team.
        values = fields.values_of(db,case['id'])
        data['cases'].append({'case':f"BD-{case['number']}",**{k:case[k] for k in ('subject','status','priority','category','created_at','resolved_at')},
                              'fields':{f['name']:fields.display(f,values[f['id']]) for f in case_fields if values.get(f['id'])},'ratings':ratings})
    return data


README = """ข้อมูลส่วนบุคคลที่ Bookdose Customer Service เก็บไว้
ออกเมื่อ {at} (เวลา UTC) โดยผู้ดูแลแพลตฟอร์ม {by}

data.json
  account        บัญชีลูกค้า (ถ้ามี): ชื่อ อีเมล เบอร์โทร การยินยอม ประวัติการเข้าสู่ระบบ
  organizations  แยกตามองค์กรที่ติดต่อ: ข้อมูลลูกค้า ข้อมูลแชทแบบไม่ล็อกอิน
                 บทสนทนาทุกเรื่องตามที่ลูกค้าเห็น และเคสพร้อมคะแนนความพึงพอใจ
files/           ไฟล์แนบในบทสนทนา (ชื่อโฟลเดอร์ตามรหัสองค์กร)

บันทึกภายในของทีมงานองค์กรไม่รวมอยู่ในไฟล์นี้ เวลาทั้งหมดเป็นเวลา UTC
"""


def export(cd, session, body):
    """(ZIP bytes, file name) of everything the ticked records and accounts hold. Recorded."""
    reason = _reason(body)
    accounts,chosen,tenants = _selection(cd,body)
    buffer = io.BytesIO()
    scope = []
    with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as archive:
        data = {'generated_at':now(),'accounts':[_account_data(cd,a) for a in accounts],'organizations':[]}
        for tenant_id,contact_ids in chosen.items():
            with D.tenant(tenant_id) as db:
                for contact_id in contact_ids:
                    data['organizations'].append(_contact_data(db,tenants[tenant_id],contact_id,archive))
                audit.record(db,f"ผู้ดูแลแพลตฟอร์ม {session.get('name','')}",'pdpa.exported',','.join(contact_ids),reason)
            scope.append({'organization':tenants[tenant_id]['name'],'records':len(contact_ids)})
        archive.writestr('data.json',json.dumps(data,ensure_ascii=False,indent=2,default=str))
        archive.writestr('README.txt',README.format(at=now(),by=session.get('name','')))
    _log(cd,session,'export',body,{'accounts':len(accounts),'organizations':scope},reason)
    cd.commit()
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%S')
    return buffer.getvalue(),f'pdpa-export-{stamp}.zip'


# Erasing
def _erase_contact(db, contact_id, files):
    """Leave the record's rows, with nothing in them that says who it was (the module's note). `files` collects the
    attachment files to delete once the change is committed."""
    convs = [r[0] for r in db.execute('SELECT id FROM conversations WHERE contact_id=?',(contact_id,))]
    for conv in convs:
        messages = [r[0] for r in db.execute('SELECT id FROM messages WHERE conversation_id=?',(conv,))]
        for message_id in messages:
            files.extend(r[0] for r in db.execute('SELECT storage_key FROM attachments WHERE message_id=?',(message_id,)))
            for table in ('channel_file_links','attachments','message_translations','mentions','channel_ai_guard'):
                db.execute(f'DELETE FROM {table} WHERE message_id=?',(message_id,))
            # A reply still waiting to go out on LINE / email never goes now.
            db.execute("UPDATE channel_outbox SET status='failed',error='changed' WHERE message_id=? AND status IN ('queued','sending')",(message_id,))
        db.execute("""UPDATE messages SET body='',author_name=CASE WHEN kind='customer' THEN ? ELSE author_name END,
                      deleted_at=COALESCE(deleted_at,?),deleted_by='PDPA' WHERE conversation_id=?""",(ERASED_NAME,now(),conv))
        db.execute('UPDATE conversations SET subject=?,portal_token=NULL WHERE id=?',(ERASED_TEXT,conv))
        for table in ('conversation_summaries','conversation_moods','conversation_mood_log','conversation_languages','conversation_references',
                      'conversation_moves','line_move_codes','ai_jobs','channel_conversations','line_threads','email_reply_refs',
                      'guest_conversations','guest_seen','guest_notifications','customer_seen','customer_notifications'):
            db.execute(f'DELETE FROM {table} WHERE conversation_id=?',(conv,))
        db.execute('UPDATE csat_surveys SET comment=NULL WHERE conversation_id=?',(conv,))
    for ticket in [r[0] for r in db.execute('SELECT id FROM tickets WHERE contact_id=?',(contact_id,))]:
        db.execute("UPDATE tickets SET subject=?,snooze_note='' WHERE id=?",(ERASED_TEXT,ticket))
        db.execute('DELETE FROM ticket_field_values WHERE ticket_id=?',(ticket,))
        db.execute('UPDATE followups SET note=? WHERE ticket_id=?',(ERASED_TEXT,ticket))
        db.execute('UPDATE csat_surveys SET comment=NULL WHERE ticket_id=?',(ticket,))
    from backend.modules.guest import repository as guests
    for visitor_id in [r[0] for r in db.execute('SELECT id FROM guest_visitors WHERE contact_id=?',(contact_id,))]:
        guests.delete_visitor(db,visitor_id)
    db.execute("UPDATE contacts SET name=?,email='',phone='',company='',notes='' WHERE id=?",(ERASED_NAME,contact_id))
    for table in ('contact_names','contact_profiles','customer_contacts','customer_members'):
        db.execute(f'DELETE FROM {table} WHERE contact_id=?',(contact_id,))
    # The recycle bin's copies of the record.
    db.execute("DELETE FROM trash WHERE entity=? OR payload LIKE ?",(contact_id,f'%{contact_id}%'))
    return len(convs)


def _erase_account_everywhere(cd, account, tenants):
    for tenant_id in tenants:
        with D.tenant(tenant_id) as db:
            for table in ('customer_contacts','customer_members','customer_line_links','customer_line_codes',
                          'customer_alert_outbox','customer_notifications','customer_seen'):
                db.execute(f'DELETE FROM {table} WHERE account_id=?',(account['id'],))
            db.execute('UPDATE guest_visitors SET account_id=NULL WHERE account_id=?',(account['id'],))
    for table in ('customer_sessions','customer_activity','customer_challenges','customer_login_challenges','customer_orgs',
                  'customer_passkeys','customer_recovery_codes','customer_resets','customer_totp','org_join_uses'):
        cd.execute(f'DELETE FROM {table} WHERE account_id=?',(account['id'],))
    cd.execute('DELETE FROM customer_signups WHERE email=? COLLATE NOCASE',(account['email'],))
    cd.execute('DELETE FROM guest_verified_emails WHERE email=? COLLATE NOCASE',(account['email'],))
    cd.execute('DELETE FROM customer_accounts WHERE id=?',(account['id'],))


def erase(cd, session, body):
    """Erase what was ticked, confirmed with the word typed out and a reason; recorded here and in each organization's
    history. Returns what was erased (counts)."""
    reason = _reason(body)
    require(body.get('confirm')==CONFIRM_WORD,f'พิมพ์ "{CONFIRM_WORD}" เพื่อยืนยัน')
    accounts,chosen,tenants = _selection(cd,body)
    scope,files = [],{}
    for tenant_id,contact_ids in chosen.items():
        with D.tenant(tenant_id) as db:
            D.begin(db)
            conversations = sum(_erase_contact(db,contact_id,files.setdefault(tenant_id,[])) for contact_id in contact_ids)
            audit.record(db,f"ผู้ดูแลแพลตฟอร์ม {session.get('name','')}",'pdpa.erased',','.join(contact_ids),reason)
            db.commit()
        scope.append({'organization':tenants[tenant_id]['name'],'records':len(contact_ids),'conversations':conversations})
    for account in accounts:
        _erase_account_everywhere(cd,account,tenants)
    _log(cd,session,'erase',body,{'accounts':len(accounts),'organizations':scope},reason)
    cd.commit()
    for tenant_id,keys in files.items():
        for key in keys:
            try:
                (D.DATA/'files'/tenant_id/key).unlink(missing_ok=True)
            except OSError:
                pass
    return {'accounts':len(accounts),'organizations':scope,'files':sum(len(k) for k in files.values())}


# What the console shows beside the search
def overview(cd):
    """The log of what the tool did, and the deletion requests organizations noted on their customers (ข้อมูลลูกค้า →
    ขอให้ลบข้อมูล) that are not erased yet."""
    history = rows(cd,'SELECT id,kind,subject,scope,reason,by_name,created_at FROM pdpa_requests ORDER BY created_at DESC LIMIT 100')
    for item in history:
        item['scope'] = json.loads(item['scope'])
    requested = []
    for tenant in _tenants(cd):
        with D.tenant(tenant['id']) as db:
            for r in rows(db,'''SELECT c.id,c.name,c.email,c.phone,p.deletion_requested_at,p.deletion_requested_by FROM contact_profiles p
                                JOIN contacts c ON c.id=p.contact_id WHERE p.deletion_requested_at IS NOT NULL AND c.name!=?''',(ERASED_NAME,)):
                requested.append({'tenant_id':tenant['id'],'tenant_name':tenant['name'],'contact_id':r['id'],'name':r['name'],
                                  'email':r['email'],'phone':r['phone'],'requested_at':r['deletion_requested_at'],
                                  'requested_by':r['deletion_requested_by']})
    requested.sort(key=lambda r:r['requested_at'])
    return {'history':history,'requested':requested,'confirm_word':CONFIRM_WORD}
