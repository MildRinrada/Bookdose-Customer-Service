"""เอกสารกฎหมาย (model.py): what the console edits and publishes, what the pages read, and who agreed to what.

A document is a Markdown text with a title. The console edits a draft of each; publishing copies the draft into a
new version that is never changed afterwards, so an acceptance names a text that will still read the same later.
The first version of each comes from drafts/*.md the first time the platform starts with none published; the console
is the only way to change them after that."""
import datetime as dt
import pathlib

from backend.database import audit, db as D
from backend.database.db import one, rows
from backend.modules.legal.model import BODY_MAX, DOCUMENTS, FIRST_VERSION, KEYS
from backend.utils.dates import now
from backend.utils.security import uid
from backend.utils.validation import field, require

DRAFTS = pathlib.Path(__file__).parent/'drafts'


def seed(db):
    """The first version of any document that has none yet, from drafts/*.md: a platform that has run before keeps
    what its admin published, a new one starts with the drafts, and the console can change them from then on."""
    for key,title in DOCUMENTS:
        if one(db,'SELECT 1 FROM legal_documents WHERE key=?',(key,)):
            continue
        body = (DRAFTS/f'{key}.md').read_text(encoding='utf-8').strip()
        db.execute('INSERT INTO legal_documents(key,version,title,body,published_at,published_by) VALUES(?,?,?,?,?,?)',
                   (key,FIRST_VERSION,title,body,now(),'ระบบ'))
        db.execute('INSERT OR IGNORE INTO legal_drafts(key,title,body,updated_at,updated_by) VALUES(?,?,?,?,?)',
                   (key,title,body,now(),'ระบบ'))


def current(db, key):
    """The published version of a document the pages show: {key, version, title, body, published_at}, or None."""
    require(key in KEYS,'ไม่พบเอกสารนี้',404)
    return one(db,'''SELECT key,version,title,body,published_at FROM legal_documents WHERE key=?
                     ORDER BY published_at DESC LIMIT 1''',(key,))


def current_version(db, key):
    """The version somebody agreeing now agrees to."""
    found = current(db,key)
    return found['version'] if found else FIRST_VERSION


def public(db, key, organization=None):
    """A document for a page or a window: the customer notice with the organization's name put in for {{องค์กร}}."""
    found = current(db,key)
    require(found,'เอกสารนี้ยังไม่ได้เผยแพร่',404)
    body = fill_company(db,found['body'])
    if organization:
        body = body.replace('{{องค์กร}}',organization)
    return {**found,'body':body}


def overview(db):
    """The console: each document's draft, its published versions (newest first), and whether the draft differs."""
    documents = []
    for key,title in DOCUMENTS:
        draft = one(db,'SELECT key,title,body,updated_at,updated_by FROM legal_drafts WHERE key=?',(key,))
        versions = rows(db,'''SELECT version,title,published_at,published_by,length(body) AS size FROM legal_documents
                              WHERE key=? ORDER BY published_at DESC''',(key,))
        live = current(db,key)
        documents.append({'key':key,'name':title,
                          'draft':draft or {'key':key,'title':title,'body':'','updated_at':None,'updated_by':''},
                          'versions':versions,
                          'changed':bool(draft) and bool(live) and (draft['title']!=live['title'] or draft['body']!=live['body']),
                          'accepted':one(db,'SELECT COUNT(*) AS n FROM legal_acceptances WHERE document=?',(key,))['n']})
    return {'documents':documents}


def version_text(db, key, version):
    found = one(db,'SELECT key,version,title,body,published_at,published_by FROM legal_documents WHERE key=? AND version=?',(key,version))
    require(found,'ไม่พบฉบับนี้',404)
    return found


def save_draft(db, key, who, body):
    """The console's edit of a draft: nothing anybody agreed to changes until it is published."""
    require(key in KEYS,'ไม่พบเอกสารนี้',404)
    title = field(body,'title',200)
    text = field(body,'body',BODY_MAX)
    D.begin(db)
    db.execute('''INSERT INTO legal_drafts(key,title,body,updated_at,updated_by) VALUES(?,?,?,?,?)
                  ON CONFLICT(key) DO UPDATE SET title=excluded.title,body=excluded.body,updated_at=excluded.updated_at,
                  updated_by=excluded.updated_by''',(key,title,text,now(),who))
    audit.record(db,who,'legal.draft_saved',key,title)
    db.commit()
    return {'ok':True}


def publish(db, key, who):
    """The draft becomes the version everyone sees and agrees to from now on. Versioned by the month, and counted
    within it (2026-11, 2026-11.2) so that two publishings in a month are still two texts."""
    require(key in KEYS,'ไม่พบเอกสารนี้',404)
    draft = one(db,'SELECT title,body FROM legal_drafts WHERE key=?',(key,))
    require(draft and draft['body'].strip(),'ยังไม่มีฉบับร่างให้เผยแพร่')
    live = current(db,key)
    require(not live or draft['title']!=live['title'] or draft['body']!=live['body'],'ฉบับร่างเหมือนฉบับที่เผยแพร่อยู่แล้ว',409)
    month = dt.date.today().strftime('%Y-%m')
    taken = [r['version'] for r in rows(db,'SELECT version FROM legal_documents WHERE key=? AND version LIKE ?',(key,month+'%'))]
    version = month if month not in taken else f'{month}.{len(taken)+1}'
    D.begin(db)
    db.execute('INSERT INTO legal_documents(key,version,title,body,published_at,published_by) VALUES(?,?,?,?,?,?)',
               (key,version,draft['title'],draft['body'],now(),who))
    audit.record(db,who,'legal.published',key,version)
    db.commit()
    return {'version':version}


def accept(db, document, email, ip='', tenant_id=None):
    """Somebody agreed to the current version of a document. Inside the caller's transaction. Returns the version."""
    version = current_version(db,document)
    db.execute('INSERT INTO legal_acceptances(id,document,version,email,tenant_id,accepted_at,ip) VALUES(?,?,?,?,?,?,?)',
               (uid(),document,version,email,tenant_id,now(),ip or ''))
    return version


def attach_to_tenant(db, email, tenant_id):
    """The organization now exists: the acceptances its applicant made are its."""
    db.execute('UPDATE legal_acceptances SET tenant_id=? WHERE email=? AND tenant_id IS NULL',(tenant_id,email))


# --- What an organization and a member see of them -------------------------------------------------------------

def organization_terms(db, tenant_id):
    """ข้อตกลงการใช้บริการ as one organization stands with it: the version in force, the last one it agreed to (by
    whom, when), and whether it still has to agree to the one in force - an organization made for it from the
    platform's own screens never went through the sign-up page, and a new version is agreed to again."""
    live = current(db,'terms')
    accepted = one(db,'''SELECT version,email,accepted_at FROM legal_acceptances WHERE document='terms' AND tenant_id=?
                         ORDER BY accepted_at DESC LIMIT 1''',(tenant_id,))
    return {'current':{'version':live['version'],'title':live['title'],'published_at':live['published_at']} if live else None,
            'accepted':accepted,
            'pending':bool(live) and (not accepted or accepted['version']!=live['version'])}


def accept_for_organization(db, tenant_id, session, ip=''):
    """The organization's admin agrees to the terms in force, in the organization's name."""
    D.begin(db)
    version = accept(db,'terms',session['email'],ip,tenant_id)
    audit.record(db,session['name'],'legal.terms_accepted',tenant_id,version)
    db.commit()
    return organization_terms(db,tenant_id)


def member_privacy(db, email):
    """ประกาศความเป็นส่วนตัวสำหรับผู้ใช้งานระบบ as one staff account stands with it: the version in force and the last
    one this account acknowledged (none for an account made before there was one)."""
    live = current(db,'platform-privacy')
    accepted = one(db,'''SELECT version,accepted_at FROM legal_acceptances WHERE document='platform-privacy' AND email=?
                         ORDER BY accepted_at DESC LIMIT 1''',(email,))
    return {'current':{'version':live['version'],'published_at':live['published_at']} if live else None,'accepted':accepted}


# --- ผู้ให้บริการ: who Bookdose is, put into every document -----------------------------------------------------

# What the documents say where they name the provider and how to reach it. A platform admin fills these in on the
# console; a document shows what is filled in, and says plainly what is not, rather than a contact that does not exist.
COMPANY_KEY = 'legal_company'
COMPANY_FIELDS = (
    ('name', '{{บริษัท}}', 'ชื่อนิติบุคคล', 200),
    ('address', '{{ที่อยู่}}', 'ที่อยู่', 400),
    ('email', '{{อีเมลติดต่อ}}', 'อีเมลติดต่อเรื่องข้อมูลส่วนบุคคล', 254),
    ('phone', '{{โทรศัพท์}}', 'โทรศัพท์', 40),
    ('dpo', '{{เจ้าหน้าที่คุ้มครองข้อมูล}}', 'เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล (DPO)', 200),
)
MISSING = '(ยังไม่ได้ระบุ)'


def company(db):
    """The provider's details as the console saved them: {name, address, email, phone, dpo}, each '' when not set."""
    import json
    row = one(db,'SELECT value FROM platform_settings WHERE key=?',(COMPANY_KEY,))
    saved = json.loads(row['value']) if row and row['value'] else {}
    return {key:str(saved.get(key,'') or '') for key,_,_,_ in COMPANY_FIELDS}


def save_company(db, who, body):
    import json
    values = {key:str(body.get(key,'') or '').strip()[:limit] for key,_,_,limit in COMPANY_FIELDS}
    D.begin(db)
    db.execute('INSERT INTO platform_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
               (COMPANY_KEY,json.dumps(values,ensure_ascii=False)))
    audit.record(db,who,'legal.company_saved','',values['name'])
    db.commit()
    return values


def fill_company(db, body):
    """The provider's details where a document says {{บริษัท}}, {{อีเมลติดต่อ}} and so on."""
    details = company(db)
    for key,mark,_,_ in COMPANY_FIELDS:
        body = body.replace(mark,details[key] or MISSING)
    return body


# --- Who agreed to what, for the console -----------------------------------------------------------------------

def acceptances(db, key, limit=1000):
    """The record of agreements to one document, newest first, with the organization's name where there is one -
    what is shown, and exported, when somebody asks who agreed to which text and when."""
    require(key in KEYS,'ไม่พบเอกสารนี้',404)
    return {'acceptances':rows(db,'''SELECT a.version,a.email,a.accepted_at,a.ip,a.tenant_id,COALESCE(t.name,'') AS organization
                                       FROM legal_acceptances a LEFT JOIN tenants t ON t.id=a.tenant_id
                                       WHERE a.document=? ORDER BY a.accepted_at DESC LIMIT ?''',(key,limit))}


# --- A member acknowledging the privacy notice again ----------------------------------------------------------

def acknowledge_member(db, session, ip=''):
    """A staff account acknowledges the privacy notice for system users in force."""
    D.begin(db)
    accept(db,'platform-privacy',session['email'],ip,session.get('tenant_id'))
    db.commit()
    return member_privacy(db,session['email'])


def acknowledge_customer(db, account_id, email, ip=''):
    """A customer agrees to the customer privacy notice in force: the account's consent_version moves to it."""
    D.begin(db)
    version = accept(db,'customer-privacy',email,ip)
    db.execute('UPDATE customer_accounts SET consent_version=?,consent_at=? WHERE id=?',(version,now(),account_id))
    db.commit()
    return {'consent_version':version}
