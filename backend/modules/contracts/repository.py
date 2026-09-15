"""Contract queries (organization database, except templates, which exist in both databases)."""
from backend.database.db import one, rows
from backend.utils.dates import now


# Templates (control database for the platform's standard ones, organization database for its own)
def templates(db):
    return rows(db,'SELECT * FROM contract_templates ORDER BY kind,title')


def find_template(db, template_id):
    return one(db,'SELECT * FROM contract_templates WHERE id=?',(template_id,))


def insert_template(db, template_id, title, kind, body, author):
    db.execute('INSERT INTO contract_templates VALUES(?,?,?,?,?,?)',(template_id,title,kind,body,author,now()))


def update_template(db, template_id, title, kind, body, author):
    db.execute('UPDATE contract_templates SET title=?,kind=?,body=?,author=?,updated_at=? WHERE id=?',(title,kind,body,author,now(),template_id))


def delete_template(db, template_id):
    db.execute('DELETE FROM contract_templates WHERE id=?',(template_id,))


# Contracts
def next_number(db):
    return db.execute('SELECT COALESCE(MAX(number),0)+1 FROM contracts').fetchone()[0]


def insert_contract(db, contract_id, number, kind, title, account_id, customer_name, customer_email, author):
    db.execute('''INSERT INTO contracts(id,number,kind,title,account_id,customer_name,customer_email,status,created_by,created_at,updated_at)
                  VALUES(?,?,?,?,?,?,?,'draft',?,?,?)''',(contract_id,number,kind,title,account_id,customer_name,customer_email,author,now(),now()))


def find(db, contract_id):
    return one(db,'SELECT * FROM contracts WHERE id=?',(contract_id,))


def list_all(db):
    """Every contract, with what waits for the team: slips to check, rejected deliveries, open cases, MA requests."""
    return rows(db,'''SELECT c.*,
        (SELECT MIN(m.due_date) FROM contract_milestones m WHERE m.contract_id=c.id AND m.status!='done' AND m.due_date!='') AS next_due,
        (SELECT COUNT(*) FROM contract_invoices i WHERE i.contract_id=c.id AND i.status='submitted') AS slips_waiting,
        (SELECT COUNT(*) FROM contract_milestones m WHERE m.contract_id=c.id AND m.status='revision') AS revisions,
        (SELECT COUNT(*) FROM contract_issues x JOIN tickets t ON t.id=x.ticket_id
            WHERE x.contract_id=c.id AND t.status NOT IN ('resolved','closed')) AS open_issues
        FROM contracts c ORDER BY c.updated_at DESC LIMIT 500''')


def milestones_of(db, contract_ids):
    """{contract id: [milestones]} for many contracts at once."""
    found = {}
    if contract_ids:
        marks = ','.join('?'*len(contract_ids))
        for m in rows(db,f'SELECT * FROM contract_milestones WHERE contract_id IN ({marks}) ORDER BY seq',tuple(contract_ids)):
            found.setdefault(m['contract_id'],[]).append(m)
    return found


def renewals(db, contract_id):
    """MA contracts made to continue this one."""
    return rows(db,'SELECT id,number,kind,title,status,version,coverage_start,coverage_end,completed_at FROM contracts WHERE renews_id=? ORDER BY created_at',
                (contract_id,))


def set_fields(db, contract_id, **fields):
    names = ','.join(f'{key}=?' for key in fields)
    db.execute(f'UPDATE contracts SET {names},updated_at=? WHERE id=?',(*fields.values(),now(),contract_id))


def of_account(db, account_id):
    """The customer's contracts that were sent to them at least once."""
    return rows(db,'''SELECT c.id,c.number,c.kind,c.title,c.status,c.version,c.updated_at,c.completed_at,c.renews_id,
        c.delivered_at,c.coverage_start,c.coverage_end,c.ma_requested_at
        FROM contracts c WHERE c.account_id=? AND c.version!='' ORDER BY c.updated_at DESC''',(account_id,))


def invoices_of_account(db, account_id):
    return rows(db,'''SELECT i.id,i.contract_id,i.milestone_id,i.number,i.total,i.status,i.issued_at,i.due_date,i.paid_at,i.receipt_number,
        c.number AS contract_number,c.kind,c.title,m.title AS milestone_title
        FROM contract_invoices i JOIN contracts c ON c.id=i.contract_id JOIN contract_milestones m ON m.id=i.milestone_id
        WHERE c.account_id=? AND i.status!='void' ORDER BY i.issued_at DESC''',(account_id,))


def deliveries_waiting_for(db, account_id):
    """Deliveries the customer has not inspected yet."""
    return rows(db,'''SELECT m.id AS milestone_id,m.title,m.submitted_at,c.id AS contract_id,c.number,c.kind,c.title AS contract_title
        FROM contract_milestones m JOIN contracts c ON c.id=m.contract_id WHERE c.account_id=? AND m.status='submitted' ''',(account_id,))


def _marks(ids):
    return ','.join('?'*len(ids))


def sent_with_ids(db, contract_ids):
    """These contracts, when sent at least once (the ones a customer reaches as owner or through a client team)."""
    if not contract_ids:
        return []
    return rows(db,f'''SELECT c.id,c.number,c.kind,c.title,c.status,c.version,c.updated_at,c.completed_at,c.renews_id,
        c.delivered_at,c.coverage_start,c.coverage_end,c.ma_requested_at,c.account_id,c.customer_name
        FROM contracts c WHERE c.id IN ({_marks(contract_ids)}) AND c.version!='' ORDER BY c.updated_at DESC''',tuple(contract_ids))


def invoices_of_contracts(db, contract_ids):
    if not contract_ids:
        return []
    return rows(db,f'''SELECT i.id,i.contract_id,i.milestone_id,i.number,i.total,i.status,i.issued_at,i.due_date,i.paid_at,i.receipt_number,
        c.number AS contract_number,c.kind,c.title,m.title AS milestone_title
        FROM contract_invoices i JOIN contracts c ON c.id=i.contract_id JOIN contract_milestones m ON m.id=i.milestone_id
        WHERE c.id IN ({_marks(contract_ids)}) AND i.status!='void' ORDER BY i.issued_at DESC''',tuple(contract_ids))


def deliveries_waiting_in(db, contract_ids):
    """Deliveries of these contracts that nobody has inspected yet."""
    if not contract_ids:
        return []
    return rows(db,f'''SELECT m.id AS milestone_id,m.title,m.submitted_at,c.id AS contract_id,c.number,c.kind,c.title AS contract_title
        FROM contract_milestones m JOIN contracts c ON c.id=m.contract_id WHERE c.id IN ({_marks(contract_ids)}) AND m.status='submitted' ''',
                tuple(contract_ids))


def member_chat(db, contract_id, account_id):
    """The conversation id of a client team member's own chat about the document, or None."""
    row = one(db,'SELECT conversation_id FROM contract_chats WHERE contract_id=? AND account_id=?',(contract_id,account_id))
    return row['conversation_id'] if row else None


def set_member_chat(db, contract_id, account_id, conversation_id):
    db.execute('INSERT OR REPLACE INTO contract_chats VALUES(?,?,?)',(contract_id,account_id,conversation_id))


def find_by_hash(db, document_hash):
    return one(db,"SELECT * FROM contracts WHERE document_hash=? AND status='completed'",(document_hash,))


# Versions
def versions(db, contract_id):
    return rows(db,'SELECT id,version,note,author,created_at,sent_at FROM contract_versions WHERE contract_id=? ORDER BY created_at,rowid',(contract_id,))


def version(db, contract_id, number):
    return one(db,'SELECT * FROM contract_versions WHERE contract_id=? AND version=?',(contract_id,number))


def draft_version(db, contract_id):
    return one(db,'SELECT * FROM contract_versions WHERE contract_id=? AND sent_at IS NULL',(contract_id,))


def latest_version(db, contract_id):
    return one(db,'SELECT * FROM contract_versions WHERE contract_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',(contract_id,))


def insert_version(db, version_id, contract_id, number, body, milestones, note, author, warranty_days=0, support_terms=''):
    db.execute('''INSERT INTO contract_versions(id,contract_id,version,body,milestones,note,author,created_at,warranty_days,support_terms)
                  VALUES(?,?,?,?,?,?,?,?,?,?)''',(version_id,contract_id,number,body,milestones,note,author,now(),warranty_days,support_terms))


def update_version(db, version_id, body, milestones, warranty_days, support_terms):
    db.execute('UPDATE contract_versions SET body=?,milestones=?,warranty_days=?,support_terms=? WHERE id=? AND sent_at IS NULL',
               (body,milestones,warranty_days,support_terms,version_id))


def mark_sent(db, version_id):
    db.execute('UPDATE contract_versions SET sent_at=? WHERE id=?',(now(),version_id))


# Files
def insert_file(db, file_id, contract_id, number, milestone_id, name, mime, size, storage_key, sha256, author, ref_id=None):
    """A document of a version (milestone_id None), or a file of the project: a delivery's work (ref_id = the
    delivery) or a payment slip (ref_id = the invoice)."""
    db.execute('''INSERT INTO contract_files(id,contract_id,version,milestone_id,name,mime,size,storage_key,sha256,uploaded_by,created_at,ref_id)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''',(file_id,contract_id,number,milestone_id,name,mime,size,storage_key,sha256,author,now(),ref_id))


def files(db, contract_id, number):
    """The documents attached to one version."""
    return rows(db,'SELECT id,name,mime,size,sha256,storage_key FROM contract_files WHERE contract_id=? AND version=? AND milestone_id IS NULL ORDER BY created_at,rowid',
                (contract_id,number))


def project_files(db, contract_id):
    """Files of the project (deliveries' work and payment slips), each with the delivery or invoice it belongs to."""
    return rows(db,'''SELECT id,milestone_id,ref_id,name,mime,size,uploaded_by,created_at FROM contract_files
                      WHERE contract_id=? AND milestone_id IS NOT NULL ORDER BY created_at,rowid''',(contract_id,))


def find_file(db, contract_id, file_id):
    return one(db,'SELECT * FROM contract_files WHERE contract_id=? AND id=?',(contract_id,file_id))


def delete_file(db, file_id):
    db.execute('DELETE FROM contract_files WHERE id=?',(file_id,))


def storage_in_use(db, storage_key):
    return bool(one(db,'SELECT 1 FROM contract_files WHERE storage_key=?',(storage_key,)))


# Signatures
def insert_signature(db, signature_id, contract_id, number, party, signer_id, name, email, method, mark, verified_by, ip, user_agent):
    db.execute('INSERT INTO contract_signatures VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
               (signature_id,contract_id,number,party,signer_id,name,email,method,mark,verified_by,ip,user_agent,now()))


def signatures(db, contract_id, number):
    return rows(db,'SELECT * FROM contract_signatures WHERE contract_id=? AND version=? ORDER BY signed_at',(contract_id,number))


# Events (the audit trail)
def add_event(db, contract_id, number, party, actor, action, detail='', ip=''):
    db.execute('INSERT INTO contract_events(contract_id,version,party,actor,action,detail,ip,created_at) VALUES(?,?,?,?,?,?,?,?)',
               (contract_id,number,party,actor,action,detail,ip,now()))


def events(db, contract_id):
    return rows(db,'SELECT version,party,actor,action,detail,ip,created_at FROM contract_events WHERE contract_id=? ORDER BY id',(contract_id,))


def last_event(db, contract_id, number, party, action):
    row = one(db,'SELECT created_at FROM contract_events WHERE contract_id=? AND version=? AND party=? AND action=? ORDER BY id DESC LIMIT 1',
              (contract_id,number,party,action))
    return row['created_at'] if row else None


# One-time codes before signing
def save_otp(db, contract_id, party, signer_id, code_hash, expires_at):
    db.execute('''INSERT INTO contract_otps VALUES(?,?,?,?,?,0) ON CONFLICT(contract_id,party,signer_id)
                  DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0''',(contract_id,party,signer_id,code_hash,expires_at))


def find_otp(db, contract_id, party, signer_id):
    return one(db,'SELECT * FROM contract_otps WHERE contract_id=? AND party=? AND signer_id=?',(contract_id,party,signer_id))


def count_otp_attempt(db, contract_id, party, signer_id):
    db.execute('UPDATE contract_otps SET attempts=attempts+1 WHERE contract_id=? AND party=? AND signer_id=?',(contract_id,party,signer_id))


def delete_otp(db, contract_id, party, signer_id):
    db.execute('DELETE FROM contract_otps WHERE contract_id=? AND party=? AND signer_id=?',(contract_id,party,signer_id))


# Milestones (after completion)
def insert_milestone(db, milestone_id, contract_id, seq, kind, title, due_date, amount):
    db.execute('INSERT INTO contract_milestones(id,contract_id,seq,kind,title,due_date,amount) VALUES(?,?,?,?,?,?,?)',
               (milestone_id,contract_id,seq,kind,title,due_date,amount))


def milestones(db, contract_id):
    return rows(db,'SELECT * FROM contract_milestones WHERE contract_id=? ORDER BY seq',(contract_id,))


def find_milestone(db, contract_id, milestone_id):
    return one(db,'SELECT * FROM contract_milestones WHERE contract_id=? AND id=?',(contract_id,milestone_id))


def update_milestone(db, milestone_id, **fields):
    names = ','.join(f'{key}=?' for key in fields)
    db.execute(f'UPDATE contract_milestones SET {names} WHERE id=?',(*fields.values(),milestone_id))


# Deliveries (one row per round a milestone's work is sent for inspection)
def next_round(db, milestone_id):
    return db.execute('SELECT COALESCE(MAX(round),0)+1 FROM contract_deliveries WHERE milestone_id=?',(milestone_id,)).fetchone()[0]


def insert_delivery(db, delivery_id, contract_id, milestone_id, number, note, links, author, ip):
    db.execute('''INSERT INTO contract_deliveries(id,contract_id,milestone_id,round,note,links,submitted_by,submitted_at,ip)
                  VALUES(?,?,?,?,?,?,?,?,?)''',(delivery_id,contract_id,milestone_id,number,note,links,author,now(),ip))


def deliveries(db, contract_id):
    return rows(db,'SELECT * FROM contract_deliveries WHERE contract_id=? ORDER BY milestone_id,round',(contract_id,))


def pending_delivery(db, milestone_id):
    return one(db,"SELECT * FROM contract_deliveries WHERE milestone_id=? AND decision='pending' ORDER BY round DESC LIMIT 1",(milestone_id,))


def decide_delivery(db, delivery_id, decision, remark, by):
    db.execute('UPDATE contract_deliveries SET decision=?,remark=?,decided_by=?,decided_at=? WHERE id=?',(decision,remark,by,now(),delivery_id))


# Invoices and receipts
def next_invoice_number(db):
    return db.execute('SELECT COALESCE(MAX(number),0)+1 FROM contract_invoices').fetchone()[0]


def next_receipt_number(db):
    return db.execute('SELECT COALESCE(MAX(receipt_number),0)+1 FROM contract_invoices').fetchone()[0]


def insert_invoice(db, invoice_id, contract_id, milestone_id, number, subtotal, vat_rate, vat, total, due_date, seller, author):
    db.execute('''INSERT INTO contract_invoices(id,contract_id,milestone_id,number,subtotal,vat_rate,vat,total,issued_at,due_date,seller,issued_by)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''',(invoice_id,contract_id,milestone_id,number,subtotal,vat_rate,vat,total,now(),due_date,seller,author))


def invoices(db, contract_id):
    return rows(db,'SELECT * FROM contract_invoices WHERE contract_id=? ORDER BY number',(contract_id,))


def find_invoice(db, contract_id, invoice_id):
    return one(db,'SELECT * FROM contract_invoices WHERE contract_id=? AND id=?',(contract_id,invoice_id))


def find_invoice_by_id(db, invoice_id):
    return one(db,'SELECT * FROM contract_invoices WHERE id=?',(invoice_id,))


def active_invoice(db, milestone_id):
    """The milestone's invoice that is not void (a milestone is billed once)."""
    return one(db,"SELECT * FROM contract_invoices WHERE milestone_id=? AND status!='void'",(milestone_id,))


def update_invoice(db, invoice_id, **fields):
    names = ','.join(f'{key}=?' for key in fields)
    db.execute(f'UPDATE contract_invoices SET {names} WHERE id=?',(*fields.values(),invoice_id))


# Problems and change requests (cases linked to the project)
def insert_issue(db, ticket_id, contract_id, milestone_id, kind):
    db.execute('INSERT INTO contract_issues VALUES(?,?,?,?,?)',(ticket_id,contract_id,milestone_id,kind,now()))


def issues(db, contract_id):
    return rows(db,'''SELECT x.ticket_id,x.milestone_id,x.kind,x.created_at,t.number,t.subject,t.status,t.updated_at
                      FROM contract_issues x JOIN tickets t ON t.id=x.ticket_id WHERE x.contract_id=? ORDER BY x.created_at DESC''',(contract_id,))
