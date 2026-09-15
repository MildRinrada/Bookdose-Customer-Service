"""Contract / TOR rules for the three sides.

The organization (contractor) drafts from a template or an imported document, fills in the milestones, attaches
files and sends the version to the customer. The customer (client) reads it, asks about it in a chat linked to the
document, asks for changes, or signs it after confirming who they are (a one-time code by email, or the account
password while the platform cannot send email). A change makes a new version; a sent version never changes. The
organization's admin countersigns the same version, and the contract is sealed: a SHA-256 hash over its content,
files and signatures, shown on the document, lets anyone check later that nothing changed. The platform team keeps
the standard templates and can check a hash against every organization.
Every step goes to contract_events with the time and IP address."""
import hashlib
import json
import re
import secrets

from backend.database import audit, db as D
from backend.exceptions.errors import APIError, ChannelError
from backend.modules.contracts import docimport, repository, schema
from backend.modules.conversations import repository as conversations
from backend.modules.customers import repository as customer_accounts
from backend.modules.platform import repository as tenants, service as platform
from backend.utils.dates import after, now, today
from backend.utils.security import password_ok, token_hash, uid
from backend.utils.validation import field, require

OTP_MINUTES = 10
OTP_ATTEMPTS = 5
VIEW_GAP_MINUTES = 30
MAX_FILES_PER_VERSION = 10
# Words a template may use; they are filled in when a contract is created from it.
PLACEHOLDERS = ('customer_name','customer_email','organization','date','number','title')


# Helpers
def _staff(ctx, sign=False):
    if sign:
        require(ctx['role']=='admin','เฉพาะผู้ดูแลองค์กรลงนามแทนองค์กรได้',403)
    else:
        require(ctx['role'] in ('admin','manager'),'เฉพาะผู้ดูแลองค์กรหรือหัวหน้าทีม',403)


def _get(db, contract_id):
    contract = repository.find(db,schema.an_id(contract_id,'ไม่พบเอกสาร'))
    require(contract,'ไม่พบเอกสาร',404)
    return contract


def _owned(db, session, contract_id):
    """A contract sent to the signed-in customer; 404 for anyone else's or one not sent yet."""
    contract = repository.find(db,schema.an_id(contract_id,'ไม่พบเอกสารนี้ในบัญชีของคุณ'))
    require(contract and contract['account_id']==session['account_id'] and contract['version'],'ไม่พบเอกสารนี้ในบัญชีของคุณ',404)
    return contract


def _next_version(db, contract_id):
    latest = repository.latest_version(db,contract_id)
    if not latest:
        return '1.0'
    major,minor = latest['version'].split('.')
    return f'{major}.{int(minor)+1}'


def _fill(text, values):
    for key,value in values.items():
        text = text.replace('{'+key+'}',value)
    return text


def _mask(email):
    name,_,domain = email.partition('@')
    return name[:1]+'***@'+domain


def _staff_email(cd, user_id):
    row = cd.execute('SELECT email FROM users WHERE id=?',(user_id,)).fetchone()
    return row[0] if row else ''


def _store(tenant_id, content):
    key = uid()
    conversations.save_attachment_file(tenant_id,key,content)
    return key


def _sealed_payload(db, contract, number, organization):
    version = repository.version(db,contract['id'],number)
    payload = {'reference':schema.reference(contract),'kind':contract['kind'],'title':contract['title'],'version':number,
               'organization':organization,'customer':{'name':contract['customer_name'],'email':contract['customer_email']},
               'body':version['body'],'milestones':json.loads(version['milestones']),
               'files':[{'name':f['name'],'sha256':f['sha256']} for f in repository.files(db,contract['id'],number)],
               'signatures':[{'party':s['party'],'name':s['signer_name'],'email':s['signer_email'],'method':s['method'],
                              'mark_sha256':hashlib.sha256(s['mark'].encode()).hexdigest(),'verified_by':s['verified_by'],
                              'signed_at':s['signed_at']} for s in repository.signatures(db,contract['id'],number)]}
    # The warranty and support terms are part of what was signed; contracts sealed before they existed keep their hash.
    if version['warranty_days'] or version['support_terms']:
        payload.update(warranty_days=version['warranty_days'],support_terms=version['support_terms'])
    return payload


def seal(db, contract, number, organization):
    """SHA-256 over the signed version: text, milestones, files, both signatures and the parties."""
    payload = json.dumps(_sealed_payload(db,contract,number,organization),ensure_ascii=False,sort_keys=True,separators=(',',':'))
    return hashlib.sha256(payload.encode()).hexdigest()


CUSTOMER_EVENTS = ('sent','viewed','change_requested','revised','signed','countersigned','completed','cancelled','started','delivered',
                   'accepted','rejected','invoiced','slip_uploaded','slip_rejected','paid','invoice_void','coverage_started',
                   'issue_opened','ma_requested','renewed')


def _view(db, contract, number, staff):
    """What a side sees of one version, and of the project once it is signed. The IP addresses in the audit trail
    are for the organization and the platform, not for the customer."""
    from backend.modules.contracts import project
    version = repository.version(db,contract['id'],number) if number else None
    signatures = repository.signatures(db,contract['id'],number) if number else []
    events = repository.events(db,contract['id'])
    return {'contract':{**{k:contract[k] for k in ('id','number','kind','title','status','version','account_id','customer_name','customer_email',
                                                   'conversation_id','document_hash','created_at','updated_at','completed_at')},
                        'reference':schema.reference(contract)},
            'document':{'version':version['version'],'body':version['body'],'milestones':json.loads(version['milestones']),
                        'warranty_days':version['warranty_days'],'support_terms':version['support_terms'],
                        'note':version['note'],'sent_at':version['sent_at'],'editable':version['sent_at'] is None} if version else None,
            'files':[{k:f[k] for k in ('id','name','mime','size','sha256')} for f in repository.files(db,contract['id'],number)] if number else [],
            'signatures':[{k:s[k] for k in ('party','signer_name','signer_email','method','mark','verified_by','signed_at',*(('ip',) if staff else ()))}
                          for s in signatures],
            'versions':[v for v in repository.versions(db,contract['id']) if staff or v['sent_at']],
            'project':project.view(db,contract,staff) if contract['status']=='completed' else None,
            'renews':({'id':contract['renews_id'],'reference':schema.reference(parent),'title':parent['title']}
                      if contract['renews_id'] and (parent:=repository.find(db,contract['renews_id'])) else None),
            'events':events if staff else [{k:e[k] for k in ('version','party','actor','action','detail','created_at')} for e in events
                                           if e['action'] in CUSTOMER_EVENTS]}


def _email_ready(cd):
    from backend.modules.customers import service as customers
    return customers.email_ready(cd)


def _send(cd, recipient, subject, text):
    from backend.modules.customers import service as customers
    customers._send(platform.registration_config(cd),platform.registration_secret(),recipient,subject,text)


def _notify_customer(cd, org, contract, subject, text):
    """Tell the customer by email (when email works and they want it); the page shows it either way."""
    if not _email_ready(cd):
        return
    account = customer_accounts.find(cd,contract['account_id'])
    if not account or not account['email_verified'] or not account['notify_email']:
        return
    base = platform.registration_config(cd)['public_base_url']
    try:
        _send(cd,account['email'],subject,f"สวัสดีคุณ{account['name']}\n\n{text}\n{base}/#documents/{org['slug']}/{contract['id']}\n")
    except ChannelError:
        pass


# Templates
def _template_values(body):
    title,kind,text = schema.template_form(body)
    return title,kind,text


def templates_for(cd, db, ctx):
    _staff(ctx)
    return {'platform':repository.templates(cd),'organization':repository.templates(db),'placeholders':list(PLACEHOLDERS)}


def save_template(db, actor, template_id, body, audit_db=None):
    """Create (no id) or update a template in this database; returns its id."""
    title,kind,text = _template_values(body)
    if template_id is None:
        template_id = uid()
        repository.insert_template(db,template_id,title,kind,text,actor)
    else:
        require(repository.find_template(db,schema.an_id(template_id,'ไม่พบแม่แบบ')),'ไม่พบแม่แบบ',404)
        repository.update_template(db,template_id,title,kind,text,actor)
    audit.record(audit_db or db,actor,'contract_template.saved',template_id,title)
    db.commit()
    return template_id


def delete_template(db, actor, template_id):
    template = repository.find_template(db,schema.an_id(template_id,'ไม่พบแม่แบบ'))
    require(template,'ไม่พบแม่แบบ',404)
    repository.delete_template(db,template_id)
    audit.record(db,actor,'contract_template.deleted',template_id,template['title'])
    db.commit()


def import_document(ctx, body):
    """A document from elsewhere as editable text (Word, plain text or Markdown)."""
    _staff(ctx)
    name,content = schema.import_file(body)
    return docimport.to_text(name,content)


# The organization's side
def customers_of(cd, db, ctx):
    """Customers connected with this organization (the ones a contract can be sent to)."""
    _staff(ctx)
    found = []
    for (account_id,) in db.execute('SELECT account_id FROM customer_members').fetchall():
        account = customer_accounts.find(cd,account_id)
        if account:
            found.append({'id':account['id'],'name':account['name'],'email':account['email']})
    return sorted(found,key=lambda a:a['name'])


def list_contracts(db, ctx):
    from backend.modules.contracts import project
    _staff(ctx)
    return [{**c,'reference':schema.reference(c)} for c in project.summaries(db,repository.list_all(db))]


# Starting points for the warranty / MA terms of a new draft (the team edits them before sending).
WARRANTY_DAYS,MA_DAYS = 180,365
WARRANTY_TERMS = ('ระหว่างระยะรับประกัน ผู้รับจ้างแก้ไขข้อบกพร่องของงานที่ส่งมอบโดยไม่มีค่าใช้จ่าย '
                  'แจ้งปัญหาได้จากหน้าโครงการ ทีมงานตอบกลับภายใน 1 วันทำการ')
MA_TERMS = ('บริการบำรุงรักษาและแก้ไขปัญหาตลอดระยะสัญญา ตอบกลับภายใน 1 วันทำการ '
            'แก้ไขปัญหาที่ทำให้ใช้งานไม่ได้ภายใน 3 วันทำการ ไม่รวมการพัฒนาความสามารถใหม่')


def create(cd, db, ctx, org, body):
    """A new draft (version 1.0) from a template, an imported document or nothing; returns its id. With renews_id it
    is an MA contract that continues a signed project's cover."""
    _staff(ctx)
    kind,title,account_id,scope,template_id = schema.new_contract(body)
    account = customer_accounts.find(cd,account_id)
    require(account and customer_accounts.member_contact(db,account_id),'ลูกค้ารายนี้ยังไม่ได้ติดต่อองค์กร ให้ลูกค้าเพิ่มองค์กรด้วยรหัสก่อน',400)
    renews = body.get('renews_id') or None
    if renews:
        parent = repository.find(db,schema.an_id(renews,'ไม่พบโครงการที่จะต่อ MA'))
        require(parent and parent['status']=='completed' and parent['account_id']==account_id and not parent['renews_id'],
                'ต่อ MA ได้เฉพาะโครงการที่ลงนามครบของลูกค้ารายนี้',400)
    text = field(body,'body',50000,False)
    if template_id:
        template = repository.find_template(cd if scope=='platform' else db,template_id)
        require(template,'ไม่พบแม่แบบ',404)
        text = template['body']
    D.begin(db)
    contract_id,number = uid(),repository.next_number(db)
    repository.insert_contract(db,contract_id,number,kind,title,account_id,account['name'],account['email'],ctx['name'])
    if renews:
        repository.set_fields(db,contract_id,renews_id=renews)
    contract = repository.find(db,contract_id)
    values = {'customer_name':account['name'],'customer_email':account['email'],'organization':org['name'],'date':today(),
              'number':schema.reference(contract),'title':title}
    repository.insert_version(db,uid(),contract_id,'1.0',_fill(text,values),'[]','',ctx['name'],
                              MA_DAYS if renews else WARRANTY_DAYS,MA_TERMS if renews else WARRANTY_TERMS)
    repository.add_event(db,contract_id,'1.0','org',ctx['name'],'created',title)
    audit.record(db,ctx['name'],'contract.created',contract_id,title)
    db.commit()
    return contract_id


def detail(db, ctx, contract_id):
    """The version being edited (or the latest sent one), its files and signatures, every version and the audit trail."""
    _staff(ctx)
    contract = _get(db,contract_id)
    draft = repository.draft_version(db,contract['id'])
    return _view(db,contract,draft['version'] if draft else contract['version'],True)


def save(db, ctx, contract_id, body):
    _staff(ctx)
    contract = _get(db,contract_id)
    draft = repository.draft_version(db,contract['id'])
    require(contract['status'] in ('draft','changes') and draft,'แก้ไขได้เฉพาะฉบับร่าง กด “แก้ไขเป็นเวอร์ชันใหม่” ก่อน',409)
    title,text,items,days,terms = schema.document(body)
    repository.update_version(db,draft['id'],text,json.dumps(items,ensure_ascii=False),days,terms)
    repository.set_fields(db,contract['id'],title=title)
    db.commit()


def send(cd, db, ctx, org, contract_id, ip):
    """Send the draft version to the customer; from now on it never changes."""
    _staff(ctx)
    contract = _get(db,contract_id)
    draft = repository.draft_version(db,contract['id'])
    require(contract['status'] in ('draft','changes') and draft,'ไม่มีฉบับร่างที่รอส่ง',409)
    require(draft['body'].strip(),'กรุณาเขียนเนื้อหาเอกสารก่อนส่ง')
    D.begin(db)
    repository.mark_sent(db,draft['id'])
    repository.set_fields(db,contract['id'],status='review',version=draft['version'])
    repository.add_event(db,contract['id'],draft['version'],'org',ctx['name'],'sent','',ip)
    audit.record(db,ctx['name'],'contract.sent',contract['id'],draft['version'])
    db.commit()
    _notify_customer(cd,org,contract,f"มีเอกสาร {schema.reference(contract)} รอคุณตรวจและลงนาม",
                     f"{org['name']} ส่ง{schema.KIND_LABELS[contract['kind']]} “{contract['title']}” เวอร์ชัน {draft['version']} ให้คุณตรวจ\nเปิดอ่าน สอบถาม หรือลงนามได้ที่:")


def revise(db, ctx, contract_id, body, ip):
    """Start the next version from the latest sent one (after a change request, or to correct it)."""
    _staff(ctx)
    contract = _get(db,contract_id)
    require(contract['status'] in ('review','changes','awaiting_org'),'เอกสารนี้แก้ไขเป็นเวอร์ชันใหม่ไม่ได้',409)
    require(not repository.draft_version(db,contract['id']),'มีฉบับร่างเวอร์ชันใหม่อยู่แล้ว',409)
    reason = schema.note(body,False)
    latest = repository.version(db,contract['id'],contract['version'])
    number = _next_version(db,contract['id'])
    D.begin(db)
    repository.insert_version(db,uid(),contract['id'],number,latest['body'],latest['milestones'],reason,ctx['name'],
                              latest['warranty_days'],latest['support_terms'])
    for f in repository.files(db,contract['id'],latest['version']):
        repository.insert_file(db,uid(),contract['id'],number,None,f['name'],f['mime'],f['size'],f['storage_key'],f['sha256'],ctx['name'])
    repository.set_fields(db,contract['id'],status='changes')
    repository.add_event(db,contract['id'],number,'org',ctx['name'],'revised',reason,ip)
    db.commit()
    return number


def add_files(db, ctx, tenant_id, contract_id, body):
    _staff(ctx)
    contract = _get(db,contract_id)
    draft = repository.draft_version(db,contract['id'])
    require(draft,'แนบไฟล์ได้เฉพาะฉบับร่าง',409)
    items = schema.uploads(body)
    require(len(repository.files(db,contract['id'],draft['version']))+len(items)<=MAX_FILES_PER_VERSION,
            f'แนบได้ไม่เกิน {MAX_FILES_PER_VERSION} ไฟล์ต่อเวอร์ชัน')
    for name,mime,content in items:
        repository.insert_file(db,uid(),contract['id'],draft['version'],None,name,mime,len(content),_store(tenant_id,content),
                               hashlib.sha256(content).hexdigest(),ctx['name'])
    db.commit()


def remove_file(db, ctx, tenant_id, contract_id, file_id):
    _staff(ctx)
    contract = _get(db,contract_id)
    draft = repository.draft_version(db,contract['id'])
    found = repository.find_file(db,contract['id'],schema.an_id(file_id,'ไม่พบไฟล์'))
    require(found and draft and found['version']==draft['version'] and not found['milestone_id'],'ลบได้เฉพาะไฟล์ในฉบับร่าง',404)
    repository.delete_file(db,found['id'])
    if not repository.storage_in_use(db,found['storage_key']):
        conversations.attachment_path(tenant_id,found['storage_key']).unlink(missing_ok=True)
    db.commit()


def _content(tenant_id, found):
    content = conversations.read_attachment_file(tenant_id,found['storage_key'])
    require(content is not None,'ไม่พบไฟล์',404)
    return found['name'],found['mime'],content


def staff_file(db, ctx, tenant_id, contract_id, file_id):
    _staff(ctx)
    contract = _get(db,contract_id)
    found = repository.find_file(db,contract['id'],schema.an_id(file_id,'ไม่พบไฟล์'))
    require(found,'ไม่พบไฟล์',404)
    return _content(tenant_id,found)


def cancel(db, ctx, contract_id, ip):
    _staff(ctx)
    contract = _get(db,contract_id)
    require(contract['status'] not in ('completed','cancelled'),'เอกสารนี้ยกเลิกไม่ได้',409)
    repository.set_fields(db,contract['id'],status='cancelled')
    repository.add_event(db,contract['id'],contract['version'],'org',ctx['name'],'cancelled','',ip)
    audit.record(db,ctx['name'],'contract.cancelled',contract['id'])
    db.commit()


# Signing
def _otp(cd, db, contract, party, signer_id, email):
    """Email a one-time code to the signer; without platform email, the account password confirms instead."""
    if not _email_ready(cd):
        return {'method':'password'}
    code = f'{secrets.randbelow(10**6):06d}'
    repository.save_otp(db,contract['id'],party,signer_id,token_hash(code),after(minutes=OTP_MINUTES))
    db.commit()
    try:
        _send(cd,email,f"รหัสยืนยันการลงนามเอกสาร {schema.reference(contract)}",
              f"รหัสยืนยันการลงนาม “{contract['title']}” คือ {code}\nใช้ได้ภายใน {OTP_MINUTES} นาที ห้ามบอกรหัสนี้กับผู้อื่น\n"
              'หากคุณไม่ได้กำลังลงนามเอกสาร ไม่ต้องทำอะไร\n')
    except ChannelError:
        raise APIError(503,'ส่งรหัสทางอีเมลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง') from None
    return {'method':'email','sent_to':_mask(email)}


def _verify(cd, db, contract, party, signer_id, secret, password):
    """How the signer proved who they are: 'email' (the code) or 'password'. Runs inside the signing transaction;
    a wrong code is still counted."""
    if _email_ready(cd):
        otp = repository.find_otp(db,contract['id'],party,signer_id)
        require(otp and otp['expires_at']>now() and otp['attempts']<OTP_ATTEMPTS,'รหัส OTP หมดอายุหรือยังไม่ได้ขอ กรุณากดส่งรหัสใหม่')
        if not secrets.compare_digest(otp['code_hash'],token_hash(secret.strip())):
            repository.count_otp_attempt(db,contract['id'],party,signer_id)
            db.commit()
            raise APIError(403,'รหัส OTP ไม่ถูกต้อง')
        repository.delete_otp(db,contract['id'],party,signer_id)
        return 'email'
    require(password_ok(secret,password),'รหัสผ่านไม่ถูกต้อง',403)
    return 'password'


VERIFIED_WORDS = {'email':'ยืนยันตัวตนด้วยรหัส OTP ทางอีเมล','password':'ยืนยันตัวตนด้วยรหัสผ่านบัญชี'}


def org_otp(cd, db, ctx, contract_id):
    _staff(ctx,sign=True)
    contract = _get(db,contract_id)
    require(contract['status']=='awaiting_org','ลูกค้าต้องลงนามก่อน',409)
    return _otp(cd,db,contract,'org',ctx['id'],_staff_email(cd,ctx['id']))


def org_sign(cd, db, ctx, org, contract_id, body, ip, agent):
    """The organization's admin countersigns the version the customer signed: the contract is complete and sealed,
    and its milestones become the project's (see project.py)."""
    from backend.modules.contracts import project
    _staff(ctx,sign=True)
    contract = _get(db,contract_id)
    require(contract['status']=='awaiting_org','ลูกค้าต้องลงนามก่อน',409)
    number = contract['version']
    require(any(s['party']=='customer' for s in repository.signatures(db,contract['id'],number)),'ลูกค้าต้องลงนามก่อน',409)
    name,method,mark,secret = schema.signature(body)
    D.begin(db)
    verified = _verify(cd,db,contract,'org',ctx['id'],secret,tenants_password(cd,ctx['id']))
    repository.insert_signature(db,uid(),contract['id'],number,'org',ctx['id'],name,_staff_email(cd,ctx['id']),method,mark,verified,ip,agent)
    repository.add_event(db,contract['id'],number,'org',name,'countersigned',VERIFIED_WORDS[verified],ip)
    version = repository.version(db,contract['id'],number)
    for seq,item in enumerate(json.loads(version['milestones']),1):
        repository.insert_milestone(db,uid(),contract['id'],seq,item['kind'],item['title'],item['due_date'],item['amount'])
    document_hash = seal(db,contract,number,org['name'])
    repository.set_fields(db,contract['id'],status='completed',document_hash=document_hash,completed_at=now())
    repository.add_event(db,contract['id'],number,'system','Bookdose','completed','SHA-256 '+document_hash,ip)
    project.on_completed(db,repository.find(db,contract['id']),number)
    audit.record(db,ctx['name'],'contract.completed',contract['id'],document_hash)
    db.commit()
    _notify_customer(cd,org,contract,f"เอกสาร {schema.reference(contract)} ลงนามครบแล้ว",
                     f"“{contract['title']}” ลงนามครบทั้งสองฝ่ายแล้ว ดาวน์โหลดฉบับสมบูรณ์ได้ที่:")
    return document_hash


def tenants_password(cd, user_id):
    from backend.modules.auth import repository as users
    return users.password_of(cd,user_id)


# The customer's side
def customer_view(db, session, contract_id, ip):
    """The latest version sent to the customer. Opening it is recorded (at most once every half hour)."""
    contract = _owned(db,session,contract_id)
    last = repository.last_event(db,contract['id'],contract['version'],'customer','viewed')
    if not last or last<=after(minutes=-VIEW_GAP_MINUTES):
        repository.add_event(db,contract['id'],contract['version'],'customer',session['name'],'viewed','',ip)
        db.commit()
    return _view(db,contract,contract['version'],False)


def customer_otp(cd, db, session, contract_id):
    contract = _owned(db,session,contract_id)
    require(contract['status']=='review','เอกสารนี้ยังไม่พร้อมให้ลงนาม',409)
    return _otp(cd,db,contract,'customer',session['account_id'],session['email'])


def customer_sign(cd, db, session, contract_id, body, ip, agent):
    contract = _owned(db,session,contract_id)
    require(contract['status']=='review','เอกสารนี้ยังไม่พร้อมให้ลงนาม',409)
    name,method,mark,secret = schema.signature(body)
    account = customer_accounts.find(cd,session['account_id'])
    D.begin(db)
    verified = _verify(cd,db,contract,'customer',account['id'],secret,account['password'])
    repository.insert_signature(db,uid(),contract['id'],contract['version'],'customer',account['id'],name,account['email'],method,mark,verified,ip,agent)
    repository.set_fields(db,contract['id'],status='awaiting_org')
    repository.add_event(db,contract['id'],contract['version'],'customer',name,'signed',VERIFIED_WORDS[verified],ip)
    db.commit()


def _chat(cd, db, org, session, contract, text):
    """Write in the chat linked to the document (made on first use); returns its conversation id."""
    from backend.modules.customers import service as customers
    from backend.modules.portal import service as portal
    conv = customer_accounts.owned_conversation(db,session['account_id'],contract['conversation_id']) if contract['conversation_id'] else None
    if conv:
        portal.post_customer_message(db,org['id'],conv,session,{'body':text})
        return conv['id']
    subject = f"สอบถามเอกสาร {schema.reference(contract)}: {contract['title']}"[:300]
    conv_id = customers.open_conversation(cd,db,org,session,{'subject':subject,'body':text})
    repository.set_fields(db,contract['id'],conversation_id=conv_id)
    db.commit()
    return conv_id


def ask(cd, db, org, session, contract_id, body):
    """สอบถามเกี่ยวกับเอกสารนี้: a message to the team in the document's chat."""
    contract = _owned(db,session,contract_id)
    return _chat(cd,db,org,session,contract,field(body,'body',5000))


def request_changes(cd, db, org, session, contract_id, body, ip):
    """ขอแก้ไขเงื่อนไข: the note goes to the team in the document's chat, and the document waits for a new version."""
    contract = _owned(db,session,contract_id)
    require(contract['status']=='review','ขอแก้ไขได้ระหว่างรอตรวจและลงนามเท่านั้น',409)
    reason = schema.note(body)
    repository.set_fields(db,contract['id'],status='changes')
    repository.add_event(db,contract['id'],contract['version'],'customer',session['name'],'change_requested',reason,ip)
    db.commit()
    return _chat(cd,db,org,session,contract,f"ขอแก้ไขเงื่อนไข {schema.reference(contract)} (เวอร์ชัน {contract['version']}):\n{reason}")


def customer_file(db, session, tenant_id, contract_id, file_id):
    """A file of a version sent to the customer, or a file of the project (a delivery's work, a payment slip)."""
    contract = _owned(db,session,contract_id)
    found = repository.find_file(db,contract['id'],schema.an_id(file_id,'ไม่พบไฟล์'))
    sent = {v['version'] for v in repository.versions(db,contract['id']) if v['sent_at']}
    require(found and (found['milestone_id'] or found['version'] in sent),'ไม่พบไฟล์',404)
    return _content(tenant_id,found)


# The platform's side
def verify_hash(cd, body):
    """Find the completed contract with this hash in any organization and check it still matches its content."""
    value = str(body.get('hash','')).strip().lower()
    require(re.fullmatch(r'[a-f0-9]{64}',value),'กรุณาวางรหัส SHA-256 (64 ตัวอักษร) ที่อยู่ท้ายเอกสาร')
    for org_id,name in cd.execute('SELECT id,name FROM tenants ORDER BY created_at').fetchall():
        with D.tenant(org_id) as db:
            contract = repository.find_by_hash(db,value)
            if contract:
                return {'found':True,'valid':seal(db,contract,contract['version'],name)==value,'organization':name,
                        'reference':schema.reference(contract),'title':contract['title'],'version':contract['version'],
                        'completed_at':contract['completed_at'],'customer_name':contract['customer_name'],
                        'signatures':[{k:s[k] for k in ('party','signer_name','verified_by','signed_at','ip')}
                                      for s in repository.signatures(db,contract['id'],contract['version'])]}
    return {'found':False}
