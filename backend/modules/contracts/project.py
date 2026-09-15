"""The project that follows a signed contract or TOR, for both sides.

Milestones: the team starts a delivery, sets how far it is, and sends its work for inspection (a note, links to a
preview, files). The customer accepts it, or sends it back with a remark; every round is kept. A delivery with an
amount is billed when accepted; a payment milestone is billed when the team issues its invoice.
Invoices carry the organization's bank account and PromptPay (copied from its settings when issued), with VAT 7% when
the organization is VAT-registered. The customer attaches the transfer slip; the team confirms the payment, and the
receipt (a receipt / tax invoice when VAT-registered) gets the next number, or rejects the slip with a reason.
Progress: accepted deliveries count in full, the others by the percentage the team sets (at most 90% until the
customer accepts), weighted by their amounts when every delivery has one.
Warranty: counts from the acceptance of the last delivery (from the signing when there is no delivery); an MA
contract made for the project continues it. Problems and change requests are cases linked to the project."""
import datetime as dt
import hashlib
import json
from decimal import ROUND_HALF_UP, Decimal

from backend.database import audit, db as D
from backend.modules.contracts import repository, schema, service
from backend.modules.organization import repository as organization
from backend.utils import promptpay, qrcode, thaibaht
from backend.utils.dates import now, today
from backend.utils.security import uid
from backend.utils.validation import field, require

VAT_RATE = Decimal('7')
CENT = Decimal('0.01')
ISSUE_LABELS = {'bug':'แจ้งปัญหา (Bug)','change':'ขอเปลี่ยนแปลง (Change Request)'}
BILLING_DEFAULTS = {'pay_bank':'','pay_account_name':'','pay_account_number':'','pay_promptpay':'','vat_registered':'0',
                    'tax_id':'','tax_branch':'','org_address':'','invoice_due_days':'15'}


def invoice_ref(number):
    return f'INV-{number:06d}'


def receipt_ref(number):
    return f'RC-{number:06d}' if number else ''


def _day(value):
    return dt.date.fromisoformat(value[:10])


def _plus_days(start, days):
    return (_day(start)+dt.timedelta(days=days)).isoformat()


def progress(milestones, delivered=False):
    """0-100 for the whole project (see the module notes)."""
    deliveries = [m for m in milestones if m['kind']=='delivery']
    if deliveries:
        weights = [schema.money(m['amount']) for m in deliveries]
        if not all(w>0 for w in weights):
            weights = [Decimal(1)]*len(deliveries)
        done = sum(w*(100 if m['status']=='done' else min(m['progress'],90)) for w,m in zip(weights,deliveries))
        return int(done/sum(weights))
    payments = [m for m in milestones if m['kind']=='payment']
    if payments:
        return 100*sum(m['status']=='done' for m in payments)//len(payments)
    return 100 if delivered else 0


def coverage(contract, renewals=()):
    """Where the warranty (and the MA contracts that continue it) stands today."""
    ends = [e for e in [contract['coverage_end']]+[r['coverage_end'] for r in renewals if r['status']=='completed'] if e]
    start = contract['coverage_start']
    if not ends:
        return {'state':'none' if contract['delivered_at'] else 'waiting','start':start,'end':None,'days_left':None,'total_days':None,'renewed':False}
    end = max(ends)
    left = (_day(end)-_day(today())).days
    return {'state':'active' if left>=0 else 'expired','start':start,'end':end,'days_left':max(left,0),
            'total_days':(_day(end)-_day(start)).days if start else None,'renewed':end!=contract['coverage_end']}


def _start_coverage(db, contract, days, start=None):
    fields = {'delivered_at':now()}
    if days>0:
        begin = start or today()
        fields.update(coverage_start=begin,coverage_end=_plus_days(begin,days))
    repository.set_fields(db,contract['id'],**fields)
    if days>0:
        repository.add_event(db,contract['id'],contract['version'],'system','Bookdose','coverage_started',
                             f"{fields['coverage_start']} ถึง {fields['coverage_end']} ({days} วัน)")


def on_completed(db, contract, number):
    """Both sides signed (inside the signing transaction). An MA contract continues its project's cover from the day
    the current cover ends; a contract without deliveries starts its warranty now."""
    days = repository.version(db,contract['id'],number)['warranty_days']
    parent = repository.find(db,contract['renews_id']) if contract['renews_id'] else None
    if parent:
        current = coverage(parent,[r for r in repository.renewals(db,parent['id']) if r['id']!=contract['id']])
        _start_coverage(db,contract,days,max(today(),current['end'] or today()))
        repository.set_fields(db,parent['id'],ma_requested_at=None)
        repository.add_event(db,parent['id'],parent['version'],'system','Bookdose','renewed',f"{schema.reference(contract)} {contract['title']}")
    elif not any(m['kind']=='delivery' for m in repository.milestones(db,contract['id'])):
        _start_coverage(db,contract,days)


def summaries(db, rows):
    """Contract rows with their progress and the warranty's state (renewals are found among the same rows)."""
    milestones = repository.milestones_of(db,[r['id'] for r in rows if r['status']=='completed'])
    found = []
    for r in rows:
        extra = {'progress':None,'coverage':None}
        if r['status']=='completed':
            extra = {'progress':progress(milestones.get(r['id'],[]),bool(r['delivered_at'])),
                     'coverage':coverage(r,[x for x in rows if x['renews_id']==r['id']])}
        found.append({**r,**extra})
    return found


def _buyer(contract):
    saved = json.loads(contract['billing'] or '{}')
    return {'name':saved.get('name') or contract['customer_name'],'address':saved.get('address',''),'tax_id':saved.get('tax_id',''),
            'branch':saved.get('branch',''),'email':contract['customer_email']}


def _invoice_row(invoice):
    return {**{k:invoice[k] for k in ('id','milestone_id','number','subtotal','vat','total','status','issued_at','due_date','paid_at',
                                       'reject_reason','void_reason')},
            'reference':invoice_ref(invoice['number']),'receipt_reference':receipt_ref(invoice['receipt_number'])}


def view(db, contract, staff):
    """The project part of a completed contract, as both sides see it (the team also sees void invoices)."""
    milestones = repository.milestones(db,contract['id'])
    files = repository.project_files(db,contract['id'])
    files_of = lambda ref:[{k:f[k] for k in ('id','name','mime','size','uploaded_by','created_at')} for f in files if f['ref_id']==ref]
    renewals = repository.renewals(db,contract['id'])
    parent = repository.find(db,contract['renews_id']) if contract['renews_id'] else None
    version = repository.version(db,contract['id'],contract['version'])
    invoices = [_invoice_row(i) for i in repository.invoices(db,contract['id']) if staff or i['status']!='void']
    billed = [i for i in invoices if i['status']!='void']
    return {'progress':progress(milestones,bool(contract['delivered_at'])),
            'milestones':[{k:m[k] for k in ('id','seq','kind','title','due_date','amount','status','progress','started_at','submitted_at','done_at','done_by')}
                          for m in milestones],
            'deliveries':[{**{k:d[k] for k in ('id','milestone_id','round','note','submitted_by','submitted_at','decision','remark','decided_by','decided_at')},
                           'links':json.loads(d['links']),'files':files_of(d['id'])} for d in repository.deliveries(db,contract['id'])],
            'invoices':invoices,
            'totals':{'contract':f"{sum(schema.money(m['amount']) for m in milestones):.2f}",
                      'billed':f"{sum(schema.money(i['total']) for i in billed):.2f}",
                      'paid':f"{sum(schema.money(i['total']) for i in billed if i['status']=='paid'):.2f}"},
            'issues':repository.issues(db,contract['id']),
            'coverage':coverage(contract,renewals),'warranty_days':version['warranty_days'],'support_terms':version['support_terms'],
            'delivered_at':contract['delivered_at'],'ma_requested_at':contract['ma_requested_at'],
            'renewals':[{**{k:r[k] for k in ('id','title','status','coverage_start','coverage_end')},'reference':schema.reference(r)}
                        for r in renewals if staff or r['version']],
            'renews':{'id':parent['id'],'reference':schema.reference(parent),'title':parent['title']} if parent else None,
            'buyer':_buyer(contract)}


def _completed(contract):
    require(contract['status']=='completed','งวดงานเริ่มหลังลงนามครบทั้งสองฝ่าย',409)


def _milestone(db, contract, milestone_id):
    milestone = repository.find_milestone(db,contract['id'],schema.an_id(milestone_id,'ไม่พบงวดงาน'))
    require(milestone,'ไม่พบงวดงาน',404)
    return milestone


def _invoice(db, contract, invoice_id):
    invoice = repository.find_invoice(db,contract['id'],schema.an_id(invoice_id,'ไม่พบใบแจ้งหนี้'))
    require(invoice,'ไม่พบใบแจ้งหนี้',404)
    return invoice


def _staff_contract(db, ctx, contract_id):
    service._staff(ctx)
    contract = service._get(db,contract_id)
    _completed(contract)
    return contract


# Invoices
def billing_settings(db):
    values = organization.settings(db)
    return {key:values.get(key,default) for key,default in BILLING_DEFAULTS.items()}


def save_billing_settings(db, ctx, body):
    require(ctx['role']=='admin','เฉพาะผู้ดูแลองค์กรตั้งค่าการรับชำระเงินได้',403)
    for key,value in schema.billing_settings(body):
        db.execute('INSERT OR REPLACE INTO settings VALUES(?,?)',(key,value))
    audit.record(db,ctx['name'],'settings.updated',ctx['tenant_id'],'การรับชำระเงินและภาษี')
    db.commit()


def _create_invoice(db, org, contract, milestone, actor):
    """Bill one milestone (inside the caller's transaction); returns the invoice id."""
    settings = billing_settings(db)
    subtotal = schema.money(milestone['amount']).quantize(CENT)
    vat_on = settings['vat_registered']=='1'
    vat = (subtotal*VAT_RATE/100).quantize(CENT,rounding=ROUND_HALF_UP) if vat_on else Decimal('0.00')
    seller = {'name':org['name'],'address':settings['org_address'],'tax_id':settings['tax_id'],'branch':settings['tax_branch'],'vat':vat_on,
              'bank':settings['pay_bank'],'account_name':settings['pay_account_name'],'account_number':settings['pay_account_number'],
              'promptpay':settings['pay_promptpay']}
    invoice_id,number = uid(),repository.next_invoice_number(db)
    repository.insert_invoice(db,invoice_id,contract['id'],milestone['id'],number,f'{subtotal:.2f}',str(VAT_RATE if vat_on else 0),f'{vat:.2f}',
                              f'{subtotal+vat:.2f}',_plus_days(today(),int(settings['invoice_due_days'] or 0)),json.dumps(seller,ensure_ascii=False),actor)
    repository.add_event(db,contract['id'],contract['version'],'system','Bookdose','invoiced',
                         f"{invoice_ref(number)} · {milestone['title']} · {subtotal+vat:,.2f} บาท")
    return invoice_id


def _tell_invoice(cd, org, contract, invoice_id, db):
    invoice = repository.find_invoice_by_id(db,invoice_id)
    service._notify_customer(cd,org,contract,f"ใบแจ้งหนี้ {invoice_ref(invoice['number'])} จาก {org['name']}",
                             f"ยอดชำระ {schema.money(invoice['total']):,.2f} บาท ครบกำหนด {invoice['due_date']}\n"
                             'ดูช่องทางชำระเงิน QR พร้อมเพย์ และแนบสลิปได้ที่:')


def invoice_view(db, contract, invoice):
    seller = json.loads(invoice['seller'])
    milestone = repository.find_milestone(db,contract['id'],invoice['milestone_id'])
    total = schema.money(invoice['total'])
    waiting = invoice['status'] in ('unpaid','submitted')
    qr = qrcode.data_url(promptpay.payload(seller['promptpay'],total),'QR พร้อมเพย์') if waiting and seller.get('promptpay') else ''
    return {'invoice':{**{k:invoice[k] for k in ('id','number','subtotal','vat_rate','vat','total','status','issued_at','due_date','slip_note',
                                                 'reject_reason','void_reason','paid_at','confirmed_by','receipt_number')},
                       'reference':invoice_ref(invoice['number']),'receipt_reference':receipt_ref(invoice['receipt_number'])},
            'contract':{'id':contract['id'],'reference':schema.reference(contract),'title':contract['title'],'kind':contract['kind']},
            'milestone':{'id':milestone['id'],'seq':milestone['seq'],'title':milestone['title'],'kind':milestone['kind']},
            'seller':seller,'buyer':json.loads(invoice['buyer']) if invoice['status']=='paid' else _buyer(contract),
            'total_words':thaibaht.baht_text(total),'qr':qr,
            'slips':[{k:f[k] for k in ('id','name','mime','size','created_at')} for f in repository.project_files(db,contract['id']) if f['ref_id']==invoice['id']]}


# The team
def start(db, ctx, contract_id, milestone_id, ip):
    contract = _staff_contract(db,ctx,contract_id)
    milestone = _milestone(db,contract,milestone_id)
    require(milestone['kind']=='delivery' and milestone['status']=='pending','เริ่มงานได้เฉพาะงวดส่งมอบที่ยังไม่เริ่ม',409)
    repository.update_milestone(db,milestone['id'],status='in_progress',started_at=now())
    repository.add_event(db,contract['id'],contract['version'],'org',ctx['name'],'started',milestone['title'],ip)
    db.commit()


def set_progress(db, ctx, contract_id, milestone_id, body):
    contract = _staff_contract(db,ctx,contract_id)
    milestone = _milestone(db,contract,milestone_id)
    require(milestone['kind']=='delivery' and milestone['status'] in ('pending','in_progress','revision'),'ปรับความคืบหน้าได้เฉพาะงวดที่กำลังทำ',409)
    fields = {'progress':schema.progress(body)}
    if milestone['status']=='pending':
        fields.update(status='in_progress',started_at=now())
    repository.update_milestone(db,milestone['id'],**fields)
    db.commit()


def deliver(cd, db, ctx, org, contract_id, milestone_id, body, ip):
    """Send a milestone's work for the customer to inspect (a new round after a rejection)."""
    contract = _staff_contract(db,ctx,contract_id)
    milestone = _milestone(db,contract,milestone_id)
    require(milestone['kind']=='delivery' and milestone['status'] in ('pending','in_progress','revision'),'งวดนี้ส่งมอบไม่ได้ในตอนนี้',409)
    note,links,files = schema.delivery(body)
    D.begin(db)
    delivery_id,number = uid(),repository.next_round(db,milestone['id'])
    repository.insert_delivery(db,delivery_id,contract['id'],milestone['id'],number,note,json.dumps(links,ensure_ascii=False),ctx['name'],ip)
    for name,mime,content in files:
        repository.insert_file(db,uid(),contract['id'],'',milestone['id'],name,mime,len(content),service._store(org['id'],content),
                               hashlib.sha256(content).hexdigest(),ctx['name'],delivery_id)
    repository.update_milestone(db,milestone['id'],status='submitted',progress=100,submitted_at=now(),started_at=milestone['started_at'] or now())
    repository.add_event(db,contract['id'],contract['version'],'org',ctx['name'],'delivered',f"{milestone['title']} · รอบที่ {number}",ip)
    db.commit()
    service._notify_customer(cd,org,contract,f"งาน “{milestone['title']}” พร้อมให้ตรวจรับ",
                             f"{org['name']} ส่งมอบงาน “{milestone['title']}” (รอบที่ {number}) ให้คุณตรวจรับ\n"
                             'ตรวจงานแล้วกดอนุมัติรับงาน หรือส่งกลับแก้ไขพร้อมหมายเหตุได้ที่:')
    return delivery_id


def issue_invoice(cd, db, ctx, org, contract_id, milestone_id):
    contract = _staff_contract(db,ctx,contract_id)
    milestone = _milestone(db,contract,milestone_id)
    require(schema.money(milestone['amount'])>0,'งวดนี้ไม่มีจำนวนเงิน',409)
    require(milestone['kind']=='payment' or milestone['status']=='done','งวดส่งมอบออกใบแจ้งหนี้ได้หลังลูกค้าตรวจรับงาน',409)
    require(not repository.active_invoice(db,milestone['id']),'งวดนี้มีใบแจ้งหนี้อยู่แล้ว',409)
    D.begin(db)
    invoice_id = _create_invoice(db,org,contract,milestone,ctx['name'])
    audit.record(db,ctx['name'],'invoice.issued',invoice_id,milestone['title'])
    db.commit()
    _tell_invoice(cd,org,contract,invoice_id,db)
    return invoice_id


def staff_invoice(db, ctx, contract_id, invoice_id):
    contract = _staff_contract(db,ctx,contract_id)
    return invoice_view(db,contract,_invoice(db,contract,invoice_id))


def confirm_payment(cd, db, ctx, org, contract_id, invoice_id, ip):
    """The money arrived: the invoice is paid and its receipt gets the next number."""
    contract = _staff_contract(db,ctx,contract_id)
    invoice = _invoice(db,contract,invoice_id)
    require(invoice['status'] in ('unpaid','submitted'),'ใบแจ้งหนี้นี้ยืนยันการชำระไม่ได้',409)
    D.begin(db)
    receipt = repository.next_receipt_number(db)
    repository.update_invoice(db,invoice['id'],status='paid',paid_at=now(),confirmed_by=ctx['name'],receipt_number=receipt,reject_reason='',
                              buyer=json.dumps(_buyer(contract),ensure_ascii=False))
    milestone = repository.find_milestone(db,contract['id'],invoice['milestone_id'])
    if milestone['kind']=='payment':
        repository.update_milestone(db,milestone['id'],status='done',progress=100,done_at=now(),done_by=ctx['name'])
    repository.add_event(db,contract['id'],contract['version'],'org',ctx['name'],'paid',f"{invoice_ref(invoice['number'])} · ใบเสร็จ {receipt_ref(receipt)}",ip)
    audit.record(db,ctx['name'],'invoice.paid',invoice['id'],receipt_ref(receipt))
    db.commit()
    service._notify_customer(cd,org,contract,f"ได้รับชำระเงินแล้ว · ใบเสร็จ {receipt_ref(receipt)}",
                             f"{org['name']} ยืนยันการชำระ {invoice_ref(invoice['number'])} แล้ว ดาวน์โหลดใบเสร็จได้ที่:")
    return receipt_ref(receipt)


def reject_slip(db, ctx, contract_id, invoice_id, body, ip):
    contract = _staff_contract(db,ctx,contract_id)
    invoice = _invoice(db,contract,invoice_id)
    require(invoice['status']=='submitted','ใบแจ้งหนี้นี้ไม่มีสลิปรอตรวจ',409)
    text = schema.reason(body)
    repository.update_invoice(db,invoice['id'],status='unpaid',reject_reason=text)
    repository.add_event(db,contract['id'],contract['version'],'org',ctx['name'],'slip_rejected',f"{invoice_ref(invoice['number'])}: {text}",ip)
    db.commit()


def void_invoice(db, ctx, contract_id, invoice_id, body, ip):
    contract = _staff_contract(db,ctx,contract_id)
    invoice = _invoice(db,contract,invoice_id)
    require(invoice['status'] in ('unpaid','submitted'),'ยกเลิกได้เฉพาะใบแจ้งหนี้ที่ยังไม่ชำระ',409)
    text = schema.reason(body)
    repository.update_invoice(db,invoice['id'],status='void',void_reason=text)
    repository.add_event(db,contract['id'],contract['version'],'org',ctx['name'],'invoice_void',f"{invoice_ref(invoice['number'])}: {text}",ip)
    audit.record(db,ctx['name'],'invoice.void',invoice['id'],text)
    db.commit()


# The customer
def _customer_contract(db, session, contract_id):
    contract = service._owned(db,session,contract_id)
    _completed(contract)
    return contract


def accept(db, org, session, contract_id, milestone_id, body, ip):
    """อนุมัติรับงาน: the milestone is done, billed when it has an amount, and the warranty starts with the last one."""
    contract = _customer_contract(db,session,contract_id)
    milestone = _milestone(db,contract,milestone_id)
    require(milestone['status']=='submitted','งวดนี้ไม่มีงานรอตรวจรับ',409)
    note = schema.remark(body,False)
    delivery = repository.pending_delivery(db,milestone['id'])
    D.begin(db)
    if delivery:
        repository.decide_delivery(db,delivery['id'],'accepted',note,session['name'])
    repository.update_milestone(db,milestone['id'],status='done',progress=100,done_at=now(),done_by=session['name'])
    repository.add_event(db,contract['id'],contract['version'],'customer',session['name'],'accepted',
                         milestone['title']+(f' · {note}' if note else ''),ip)
    invoice_id = None
    if schema.money(milestone['amount'])>0 and not repository.active_invoice(db,milestone['id']):
        invoice_id = _create_invoice(db,org,contract,milestone,'Bookdose')
    remaining = [m for m in repository.milestones(db,contract['id']) if m['kind']=='delivery' and m['status']!='done']
    if not remaining and not contract['delivered_at']:
        _start_coverage(db,contract,repository.version(db,contract['id'],contract['version'])['warranty_days'])
    db.commit()
    return invoice_id


def reject(cd, db, org, session, contract_id, milestone_id, body, ip):
    """ส่งกลับแก้ไข: the remark is kept with the round and written in the document's chat for the team."""
    contract = _customer_contract(db,session,contract_id)
    milestone = _milestone(db,contract,milestone_id)
    require(milestone['status']=='submitted','งวดนี้ไม่มีงานรอตรวจรับ',409)
    text = schema.remark(body,True)
    delivery = repository.pending_delivery(db,milestone['id'])
    D.begin(db)
    if delivery:
        repository.decide_delivery(db,delivery['id'],'rejected',text,session['name'])
    repository.update_milestone(db,milestone['id'],status='revision',progress=90)
    repository.add_event(db,contract['id'],contract['version'],'customer',session['name'],'rejected',f"{milestone['title']} · {text}",ip)
    db.commit()
    return service._chat(cd,db,org,session,contract,f"ส่งกลับแก้ไข {schema.reference(contract)} · {milestone['title']}\n{text}")


def customer_invoice(db, session, contract_id, invoice_id):
    contract = service._owned(db,session,contract_id)
    invoice = _invoice(db,contract,invoice_id)
    require(invoice['status']!='void','ไม่พบใบแจ้งหนี้',404)
    return invoice_view(db,contract,invoice)


def customer_invoice_by_id(db, session, invoice_id):
    invoice = repository.find_invoice_by_id(db,schema.an_id(invoice_id,'ไม่พบใบแจ้งหนี้'))
    require(invoice,'ไม่พบใบแจ้งหนี้',404)
    return customer_invoice(db,session,invoice['contract_id'],invoice['id'])


def upload_slip(db, session, tenant_id, contract_id, invoice_id, body, ip):
    contract = service._owned(db,session,contract_id)
    invoice = _invoice(db,contract,invoice_id)
    require(invoice['status'] in ('unpaid','submitted'),'ใบแจ้งหนี้นี้ไม่ได้รอชำระ',409)
    name,mime,content = schema.uploads(body,1)[0]
    text = field(body,'note',500,False)
    repository.insert_file(db,uid(),contract['id'],'',invoice['milestone_id'],name,mime,len(content),service._store(tenant_id,content),
                           hashlib.sha256(content).hexdigest(),session['name'],invoice['id'])
    repository.update_invoice(db,invoice['id'],status='submitted',slip_note=text,reject_reason='')
    repository.add_event(db,contract['id'],contract['version'],'customer',session['name'],'slip_uploaded',invoice_ref(invoice['number']),ip)
    db.commit()


def save_buyer(db, session, contract_id, body):
    """The name, address and tax ID the customer wants on receipts (receipts already issued keep theirs)."""
    contract = service._owned(db,session,contract_id)
    repository.set_fields(db,contract['id'],billing=json.dumps(schema.buyer(body),ensure_ascii=False))
    db.commit()


def open_issue(cd, db, org, session, contract_id, body, ip):
    """แจ้งปัญหา / ขอเปลี่ยนแปลง: a chat with the team and a case linked to the project (and to a milestone)."""
    from backend.modules.conversations import repository as conversations
    from backend.modules.customers import service as customers
    from backend.modules.tickets import service as tickets
    contract = _customer_contract(db,session,contract_id)
    milestones = {m['id']:m for m in repository.milestones(db,contract['id'])}
    kind,milestone_id,subject,text = schema.issue(body,set(milestones))
    where = f" · {milestones[milestone_id]['title']}" if milestone_id else ''
    title = f"{ISSUE_LABELS[kind]} · {schema.reference(contract)}{where}: {subject}"[:300]
    conv_id = customers.open_conversation(cd,db,org,session,{'subject':title,'body':text})
    conv = conversations.find(db,conv_id)
    D.begin(db)
    ticket_id = tickets.open_ticket(db,conv['contact_id'],conv['team_id'],title,'high' if kind=='bug' else 'normal',
                                    category=ISSUE_LABELS[kind],conversation_id=conv_id)
    repository.insert_issue(db,ticket_id,contract['id'],milestone_id,kind)
    repository.add_event(db,contract['id'],contract['version'],'customer',session['name'],'issue_opened',title,ip)
    audit.record(db,session['name'],'ticket.created',ticket_id,title)
    db.commit()
    return {'ticket_id':ticket_id,'conversation_id':conv_id}


def request_renewal(cd, db, org, session, contract_id, body, ip):
    """ขอต่อสัญญา MA: noted on the project and written in its chat; the team then sends an MA contract to sign."""
    contract = _customer_contract(db,session,contract_id)
    project = repository.find(db,contract['renews_id']) if contract['renews_id'] else contract
    require(project['delivered_at'],'ขอต่อสัญญา MA ได้หลังส่งมอบงานครบทุกงวด',409)
    require(not project['ma_requested_at'],'ส่งคำขอต่อ MA แล้ว ทีมงานกำลังเตรียมสัญญา',409)
    text = field(body,'note',2000,False)
    repository.set_fields(db,project['id'],ma_requested_at=now())
    repository.add_event(db,project['id'],project['version'],'customer',session['name'],'ma_requested',text,ip)
    db.commit()
    return service._chat(cd,db,org,session,project,
                         f"ขอต่อสัญญาบำรุงรักษา (MA) สำหรับ {schema.reference(project)} {project['title']}"+(f"\n{text}" if text else ''))
