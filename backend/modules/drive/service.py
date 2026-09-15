"""Project Drive rules for both sides of a signed project (a completed contract or TOR).

Who: the organization's admin or manager (contracts.service._staff) may do everything, and deletes any file; on the
customer side, whoever has the documents capability on the contract (client_team/access.py: the owner, a manager,
an approver or technical staff; finance never) reads, uploads and makes folders, and deletes only what they uploaded
themselves (every version of the file is theirs) and folders they made. A folder is deleted only when it is empty.
Files: one per request, at most 5 MB, of the types in schema.FILE_TYPES whose content matches the name. Uploading a
name that is already in the folder adds the next version of that file (the same bytes as the latest are refused).
Deleting a file only marks it: its versions and the audit trail stay. Every upload and deletion is a contract event
both sides see (drive_uploaded "โฟลเดอร์ / ชื่อไฟล์ · v2", drive_deleted); a file from the contractor is also told to
the customer side (notify event 'drive').
Next to the drive's folders come read-only ones made from what the project already has: the documents of the sent
versions, the delivered work of every round and, for the team and whoever has billing, the payment slips. Their
files download through the contract's own file routes (the `download` path)."""
import hashlib

from backend.database import audit, db as D
from backend.modules.contracts import project, repository as contracts, schema as contract_schema, service as contract_service
from backend.modules.drive import repository, schema
from backend.utils.security import uid
from backend.utils.validation import require

GENERAL_FOLDER = 'ไฟล์ทั่วไป'
MAX_FOLDERS = 50


# Who is acting
def _completed(contract):
    require(contract['status']=='completed','คลังเอกสารเปิดใช้หลังลงนามครบทั้งสองฝ่าย',409)


def staff(db, ctx, contract_id):
    """(contract, who) for the organization's admin or manager."""
    contract_service._staff(ctx)
    contract = contract_service._get(db,contract_id)
    _completed(contract)
    return contract,{'party':'org','id':ctx['id'],'name':ctx['name'],'billing':True,'files':f"/api/contracts/{contract['id']}/files/"}


def customer(db, session, slug, contract_id):
    """(contract, who) for a person of the customer side with documents on the contract (404 / 403 otherwise)."""
    contract,found = contract_service._access(db,session,contract_id,'documents')
    _completed(contract)
    return contract,{'party':'customer','id':session['account_id'],'name':session['name'],'billing':'billing' in found['can'],
                     'files':f"/api/public/{slug}/contracts/{contract['id']}/files/"}


def _mine(who, party, person_id):
    """The team may remove anything; a customer only what they made themselves."""
    return who['party']=='org' or (party=='customer' and person_id==who['id'])


def _deletable(who, versions):
    return all(_mine(who,v['party'],v['uploader_id']) for v in versions)


# Reading
def _file(row, versions, who):
    latest = versions[0]
    return {'id':row['id'],'name':row['name'],'version':latest['version'],'size':latest['size'],'mime':latest['mime'],
            'updated_at':row['updated_at'],'uploaded_by':latest['uploaded_by'],'party':latest['party'],'can_delete':_deletable(who,versions),
            'versions':[{k:v[k] for k in ('id','version','size','note','uploaded_by','party','created_at')} for v in versions]}


def _linked(row, who, party, group):
    """A file of a read-only folder: it downloads through the contract's file route."""
    return {'id':row['id'],'name':row['name'],'version':None,'size':row['size'],'mime':row['mime'],'updated_at':row['created_at'],
            'uploaded_by':row['uploaded_by'],'party':party,'can_delete':False,'versions':[],'download':who['files']+row['id'],'group':group}


def _system(db, contract, who):
    """The read-only folders: documents of the sent versions, delivered work by milestone and round, and the payment
    slips (the team, or billing). A customer does not see slips of void invoices, as with the invoices themselves."""
    documents = [_linked(f,who,'org',f"เวอร์ชัน {f['version']}") for f in repository.document_files(db,contract['id']) if f['sent_at']]
    milestones = {m['id']:m for m in contracts.milestones(db,contract['id'])}
    rounds = {d['id']:d for d in contracts.deliveries(db,contract['id'])}
    invoices = {i['id']:i for i in contracts.invoices(db,contract['id']) if who['party']=='org' or i['status']!='void'}
    delivered,slips = [],[]
    for f in contracts.project_files(db,contract['id']):
        milestone = milestones.get(f['milestone_id'])
        if f['ref_id'] in rounds and milestone:
            d = rounds[f['ref_id']]
            delivered.append(((milestone['seq'],d['round']),_linked(f,who,'org',f"งวดที่ {milestone['seq']} · {milestone['title']} · รอบที่ {d['round']}")))
        elif f['ref_id'] in invoices and who['billing']:
            i = invoices[f['ref_id']]
            slips.append(((i['number'],),_linked(f,who,'customer',f"{project.invoice_ref(i['number'])}"+(f" · {milestone['title']}" if milestone else ''))))
    folder = lambda key,name,files:{'id':key,'name':name,'system':True,'party':'org','created_by':'','can_delete':False,'files':files}
    found = [folder('contract',schema.SYSTEM_NAMES[0],documents),
             folder('delivery',schema.SYSTEM_NAMES[1],[f for _,f in sorted(delivered,key=lambda x:x[0])])]
    if who['billing']:
        found.append(folder('payment',schema.SYSTEM_NAMES[2],[f for _,f in sorted(slips,key=lambda x:x[0])]))
    return found


def view(db, contract, who):
    """The drive's folders with their live files (latest version first, every version listed), then the read-only
    folders. can_upload: anyone who may read it may add files and folders."""
    files = repository.live_files(db,contract['id'])
    versions = repository.versions_of(db,[f['id'] for f in files])
    inside = {}
    for f in files:
        if versions.get(f['id']):
            inside.setdefault(f['folder_id'],[]).append(_file(f,versions[f['id']],who))
    folders = [{'id':f['id'],'name':f['name'],'system':False,'party':f['party'],'created_by':f['created_by'],
                'can_delete':not inside.get(f['id']) and _mine(who,f['party'],f['creator_id']),'files':inside.get(f['id'],[])}
               for f in repository.folders(db,contract['id'])]
    return {'folders':folders+_system(db,contract,who),'can_upload':True}


def download(db, contract, tenant_id, version_id):
    """(name, mime, bytes) of one version of a live file."""
    found = repository.find_version(db,contract['id'],schema.an_id(version_id))
    require(found,'ไม่พบไฟล์',404)
    return contract_service._content(tenant_id,found)


# Changing
def create_folder(db, contract, who, body):
    name = schema.folder_name(body)
    D.begin(db)
    require(not repository.folder_named(db,contract['id'],name),'มีโฟลเดอร์ชื่อนี้แล้ว',409)
    require(repository.count_folders(db,contract['id'])<MAX_FOLDERS,f'สร้างโฟลเดอร์ได้ไม่เกิน {MAX_FOLDERS} โฟลเดอร์ต่อโครงการ')
    folder_id = uid()
    repository.insert_folder(db,folder_id,contract['id'],name,who['name'],who['party'],who['id'])
    db.commit()
    return folder_id


def _folder(db, contract, who, folder_id):
    """The folder to upload into (inside the caller's transaction): the one chosen, or the general folder, made on
    first use by whoever uploads first."""
    if folder_id:
        folder = repository.find_folder(db,contract['id'],folder_id)
        require(folder,'ไม่พบโฟลเดอร์',404)
        return folder
    folder = repository.folder_named(db,contract['id'],GENERAL_FOLDER)
    if not folder:
        repository.insert_folder(db,uid(),contract['id'],GENERAL_FOLDER,who['name'],who['party'],who['id'])
        folder = repository.folder_named(db,contract['id'],GENERAL_FOLDER)
    return folder


def upload(cd, db, org, contract, who, tenant_id, body, ip):
    """One file into a folder: a new file, or the next version of the file with the same name there."""
    folder_id = schema.folder_id(body)
    name,mime,content,note = schema.upload(body)
    digest = hashlib.sha256(content).hexdigest()
    D.begin(db)
    folder = _folder(db,contract,who,folder_id)
    found = repository.file_named(db,folder['id'],name)
    if found:
        latest = repository.latest_version(db,found['id'])
        require(latest['sha256']!=digest,f"“{name}” เหมือนกับเวอร์ชันล่าสุด (v{latest['version']}) อยู่แล้ว",409)
        file_id,number = found['id'],latest['version']+1
        repository.touch_file(db,file_id)
    else:
        file_id,number = uid(),1
        repository.insert_file(db,file_id,contract['id'],folder['id'],name)
    version_id = uid()
    repository.insert_version(db,version_id,file_id,number,mime,len(content),contract_service._store(tenant_id,content),digest,note,
                              who['name'],who['party'],who['id'])
    contracts.add_event(db,contract['id'],contract['version'],who['party'],who['name'],'drive_uploaded',
                        f"{folder['name']} / {found['name'] if found else name} · v{number}",ip)
    db.commit()
    if who['party']=='org':
        _tell_customer(cd,org,contract,folder['name'],found['name'] if found else name,number)
    return {'id':file_id,'version_id':version_id,'version':number,'folder_id':folder['id']}


def _tell_customer(cd, org, contract, folder, name, number):
    """A file from the contractor: the owner and the team members with documents hear of it (after the commit)."""
    from backend.modules.customers import notify
    notify.contract_event(cd,org,contract,'drive',f"ไฟล์ใหม่ในคลังเอกสาร {contract_schema.reference(contract)}",
                          f"{org['name']} อัปโหลด “{name}” (เวอร์ชัน {number}) ในโฟลเดอร์ {folder} ของโครงการ “{contract['title']}”\n"
                          'เปิดดูและดาวน์โหลดได้ที่:','documents',f"/customer/documents/{org['slug']}/{contract['id']}?tab=drive")


def delete_file(db, contract, who, file_id, ip):
    """Mark a file deleted (its versions stay): the team any file, a customer only a file every version of which
    they uploaded."""
    found = repository.find_file(db,contract['id'],schema.an_id(file_id))
    require(found,'ไม่พบไฟล์',404)
    require(_deletable(who,repository.versions_of(db,[found['id']]).get(found['id'],[])),'ลบได้เฉพาะไฟล์ที่คุณอัปโหลดเอง',403)
    folder = repository.find_folder(db,contract['id'],found['folder_id'])
    D.begin(db)
    repository.mark_deleted(db,found['id'],who['name'])
    contracts.add_event(db,contract['id'],contract['version'],who['party'],who['name'],'drive_deleted',
                        f"{folder['name'] if folder else ''} / {found['name']}",ip)
    audit.record(db,who['name'],'drive.deleted',found['id'],found['name'])
    db.commit()


def delete_folder(db, contract, who, folder_id):
    """Remove an empty folder: the team any, a customer one they made. The emptiness check and the delete share one
    write transaction, so an upload cannot land in the folder in between."""
    D.begin(db)
    folder = repository.find_folder(db,contract['id'],schema.an_id(folder_id,'ไม่พบโฟลเดอร์'))
    require(folder,'ไม่พบโฟลเดอร์',404)
    require(_mine(who,folder['party'],folder['creator_id']),'ลบได้เฉพาะโฟลเดอร์ที่คุณสร้างเอง',403)
    require(not repository.folder_in_use(db,folder['id']),'ลบได้เฉพาะโฟลเดอร์ที่ว่าง กรุณาลบไฟล์ในโฟลเดอร์ก่อน',409)
    repository.delete_folder(db,folder['id'])
    audit.record(db,who['name'],'drive.folder_deleted',folder['id'],folder['name'])
    db.commit()
