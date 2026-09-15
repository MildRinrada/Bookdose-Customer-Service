"""Contract forms: templates, the document and its milestones, files, signatures, and what each side is shown."""
import base64
import re
from decimal import Decimal, InvalidOperation

from backend.exceptions.errors import APIError
from backend.modules.contracts.model import ISSUE_KINDS, KINDS, MILESTONE_KINDS, SIGN_METHODS
from backend.utils import promptpay
from backend.utils.files import matches_file_type
from backend.utils.validation import require, field

ID = re.compile(r'[a-f0-9]{32}')
DATE = re.compile(r'\d{4}-\d{2}-\d{2}')
AMOUNT = re.compile(r'\d{1,12}(\.\d{1,2})?')
FILE_TYPES = {'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'}
MAX_FILE_BYTES = 5*1024*1024
MAX_MARK_BYTES = 300*1024
KIND_LABELS = {'contract':'สัญญา','tor':'TOR'}


def reference(contract):
    return ('TOR' if contract['kind']=='tor' else 'CT')+'-'+str(contract['number']).zfill(4)


def kind(body):
    value = body.get('kind','contract')
    require(value in KINDS,'ชนิดเอกสารไม่ถูกต้อง')
    return value


def an_id(value, message='ไม่พบรายการ'):
    require(isinstance(value,str) and ID.fullmatch(value),message,404)
    return value


def template_form(body):
    """(title, kind, body)"""
    return field(body,'title',200),kind(body),field(body,'body',50000)


def new_contract(body):
    """(kind, title, customer account id, template scope and id or '')"""
    template = body.get('template_id','') or ''
    scope = body.get('template_scope','org')
    require(scope in ('org','platform'),'แม่แบบไม่ถูกต้อง')
    require(template=='' or ID.fullmatch(template),'แม่แบบไม่ถูกต้อง')
    account = body.get('account_id','')
    require(isinstance(account,str) and ID.fullmatch(account),'กรุณาเลือกลูกค้า')
    return kind(body),field(body,'title',200),account,scope,template


def milestones(value):
    """Deliveries and payments of the contract: [{'kind','title','due_date','amount'}] (at most 30)."""
    require(isinstance(value,list) and len(value)<=30,'งวดงานได้ไม่เกิน 30 รายการ')
    found = []
    for item in value:
        require(isinstance(item,dict),'ข้อมูลงวดงานไม่ถูกต้อง')
        title = item.get('title','')
        require(isinstance(title,str) and 1<=len(title.strip())<=200,'ชื่องวดงานต้องมี 1-200 ตัวอักษร')
        require(item.get('kind') in MILESTONE_KINDS,'ชนิดงวดงานไม่ถูกต้อง')
        due = item.get('due_date','') or ''
        require(due=='' or (isinstance(due,str) and DATE.fullmatch(due)),'วันครบกำหนดต้องเป็นวันที่ เช่น 2026-12-31')
        amount = str(item.get('amount','') or '').replace(',','').strip()
        require(amount=='' or AMOUNT.fullmatch(amount),'จำนวนเงินต้องเป็นตัวเลข เช่น 15000 หรือ 15000.50')
        found.append({'kind':item['kind'],'title':title.strip(),'due_date':due,'amount':amount})
    return found


def document(body):
    """(title, text, milestones, warranty days, support terms) of the version being edited. The warranty (or, for an
    MA contract, the service period) counts from the acceptance of the last delivery."""
    days = body.get('warranty_days',0)
    require(isinstance(days,int) and not isinstance(days,bool) and 0<=days<=3650,'ระยะรับประกันต้องเป็น 0-3,650 วัน')
    return (field(body,'title',200),field(body,'body',50000),milestones(body.get('milestones',[])),days,
            field(body,'support_terms',5000,False))


def upload(item, allowed=FILE_TYPES):
    """(name, mime, bytes) of one uploaded file whose content matches its type."""
    require(isinstance(item,dict),'ไฟล์ไม่ถูกต้อง')
    name = field(item,'name',150)
    require('/' not in name and '\\' not in name and not any(ord(c)<32 for c in name),'ชื่อไฟล์ไม่ถูกต้อง')
    try:
        content = base64.b64decode(item.get('data',''),validate=True)
    except (ValueError,TypeError):
        raise APIError(400,'ไฟล์ไม่ถูกต้อง') from None
    require(0<len(content)<=MAX_FILE_BYTES,'แต่ละไฟล์ต้องไม่เกิน 5 MB')
    ext = '.'+name.rsplit('.',1)[-1].lower() if '.' in name else ''
    mime = allowed.get(ext)
    require(mime,'รองรับ '+', '.join(e[1:].upper() for e in allowed))
    if ext in FILE_TYPES:
        require(matches_file_type(ext[1:],content),'เนื้อหาไฟล์ไม่ตรงกับชนิดไฟล์')
    return name,mime,content


def uploads(body, limit=5):
    items = body.get('files',[])
    require(isinstance(items,list) and 1<=len(items)<=limit,f'แนบได้ครั้งละ 1-{limit} ไฟล์')
    return [upload(item) for item in items]


def import_file(body):
    """(name, bytes) of a document to turn into editable text."""
    return upload(body,{'.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.txt':'text/plain','.md':'text/markdown'})[::2]


def signature(body):
    """(signer name, method, mark, code or password): the mark is the typed name, or a PNG/JPEG picture of the
    drawn or uploaded signature (data URL, at most 300 KB)."""
    require(body.get('agree') is True,'กรุณายืนยันว่าอ่านและยอมรับเอกสารฉบับนี้')
    name = field(body,'name',100)
    method = body.get('method')
    require(method in SIGN_METHODS,'กรุณาเลือกวิธีลงลายเซ็น')
    mark = body.get('mark','')
    require(isinstance(mark,str) and mark,'กรุณาลงลายเซ็น')
    if method=='type':
        require(len(mark.strip())<=100,'ลายเซ็นแบบพิมพ์ยาวได้ไม่เกิน 100 ตัวอักษร')
        mark = mark.strip()
    else:
        match = re.fullmatch(r'data:image/(png|jpeg);base64,([A-Za-z0-9+/=]+)',mark)
        require(match,'ลายเซ็นต้องเป็นรูป PNG หรือ JPG')
        content = base64.b64decode(match[2])
        require(0<len(content)<=MAX_MARK_BYTES,'รูปลายเซ็นต้องไม่เกิน 300 KB')
        require(matches_file_type('png' if match[1]=='png' else 'jpg',content),'รูปลายเซ็นไม่ถูกต้อง')
    secret = body.get('code') or body.get('password') or ''
    require(isinstance(secret,str) and 1<=len(secret)<=200,'กรุณากรอกรหัสยืนยันตัวตน')
    return name,method,mark,secret


def note(body, required=True):
    return field(body,'note',2000,required)


# The project after the signing
def money(value):
    """A stored amount ('150000.50' or '') as Decimal; '' is 0."""
    try:
        return Decimal(value or '0')
    except InvalidOperation:
        return Decimal('0')


def progress(body):
    value = body.get('progress')
    require(isinstance(value,int) and not isinstance(value,bool) and 0<=value<=100,'ความคืบหน้าต้องเป็น 0-100%')
    return value


def delivery(body):
    """(note, links, files) of a delivery for the customer to inspect: links are http(s) addresses (a preview site,
    a shared folder), at most 10; files are optional."""
    links = body.get('links',[])
    require(isinstance(links,list) and len(links)<=10,'แนบลิงก์ได้ไม่เกิน 10 ลิงก์')
    found = []
    for link in links:
        require(isinstance(link,str) and len(link)<=500 and re.fullmatch(r'https?://[^\s<>"]+',link.strip()),
                'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://')
        found.append(link.strip())
    files = uploads(body) if body.get('files') else []
    text = field(body,'note',3000,False)
    require(text or found or files,'กรุณาใส่รายละเอียด ลิงก์ หรือไฟล์งานที่ส่งมอบ')
    return text,found,files


def remark(body, required):
    return field(body,'remark',2000,required)


def reason(body):
    return field(body,'reason',500)


def tax_id_ok(value):
    """A Thai 13-digit tax / national ID with a valid check digit."""
    if not re.fullmatch(r'\d{13}',value):
        return False
    total = sum(int(value[i])*(13-i) for i in range(12))
    return (11-total%11)%10==int(value[12])


def billing_settings(body):
    """[(setting key, value)] of how the organization is paid and whether it charges VAT."""
    vat = body.get('vat_registered') is True
    bank = field(body,'pay_bank',100,False)
    account_name = field(body,'pay_account_name',150,False)
    account_number = field(body,'pay_account_number',30,False)
    require(not account_number or re.fullmatch(r'[0-9 -]{6,30}',account_number),'เลขที่บัญชีต้องเป็นตัวเลข')
    require(not account_number or (bank and account_name),'กรุณากรอกธนาคารและชื่อบัญชีคู่กับเลขที่บัญชี')
    prompt = promptpay.digits(field(body,'pay_promptpay',20,False))
    require(not prompt or promptpay.target_kind(prompt),'พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขประจำตัว 13 หลัก')
    tax_id = promptpay.digits(field(body,'tax_id',20,False))
    require(not tax_id or tax_id_ok(tax_id),'เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง')
    address = field(body,'org_address',500,False)
    if vat:
        require(tax_id and address,'ผู้จดทะเบียน VAT ต้องกรอกเลขประจำตัวผู้เสียภาษีและที่อยู่ เพื่อออกใบกำกับภาษี')
    days = body.get('invoice_due_days',15)
    require(isinstance(days,int) and not isinstance(days,bool) and 0<=days<=120,'กำหนดชำระต้องเป็น 0-120 วัน')
    return [('pay_bank',bank),('pay_account_name',account_name),('pay_account_number',account_number),('pay_promptpay',prompt),
            ('vat_registered','1' if vat else '0'),('tax_id',tax_id),('tax_branch',field(body,'tax_branch',60,False)),
            ('org_address',address),('invoice_due_days',str(days))]


def buyer(body):
    """The customer's details for the receipt / tax invoice."""
    tax_id = promptpay.digits(field(body,'tax_id',20,False))
    require(not tax_id or tax_id_ok(tax_id),'เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง')
    return {'name':field(body,'name',200),'address':field(body,'address',500,False),'tax_id':tax_id,
            'branch':field(body,'branch',60,False)}


def issue(body, milestone_ids):
    """(kind, milestone id or None, subject, text) of a problem or change request."""
    value = body.get('kind')
    require(value in ISSUE_KINDS,'กรุณาเลือกประเภท: แจ้งปัญหา หรือ ขอเปลี่ยนแปลง')
    milestone = body.get('milestone_id') or None
    require(milestone is None or milestone in milestone_ids,'ไม่พบงวดงานที่เลือก')
    return value,milestone,field(body,'subject',200),field(body,'body',5000)
