"""Who on the customer side may do what on a contract. The owner of a contract (contracts.account_id, the account it
was sent to) may do everything. An active member of the owner's team (client_team) has their role's capabilities on
the owner's contracts their scope covers: all projects, the contracts listed, or an MA contract whose project
(renews_id) is listed. Nothing is cached: removing a member takes effect on their next request.

Capabilities:
  documents  open the contract/TOR and the project page (milestones, deliveries, drive, events), ask in the document chat
  billing    invoices and receipts, upload a slip, the buyer's details, budget numbers
  review     be a step of an approval flow
  decide     the final actions: accept or reject a delivery, sign or ask for changes on a contract, ask for an MA renewal
  issues     report a problem / ask for a change on a project
  team       manage the team and the approval flows (the owner only)"""
import json

from backend.modules.client_team import repository
from backend.modules.contracts import repository as contracts, schema as contract_schema
from backend.utils.validation import require as ensure

ROLES = ('manager','approver','finance','technical')
ROLE_LABELS = {'owner':'เจ้าของ','manager':'ผู้ดูแลร่วม','approver':'ผู้ตรวจรับ/อนุมัติ','finance':'ฝ่ายการเงิน','technical':'ฝ่ายเอกสาร/IT'}
CAPABILITIES = {'owner':{'documents','billing','review','decide','issues','team'},'manager':{'documents','billing','review','decide','issues'},
                'approver':{'documents','review','issues'},'finance':{'billing'},'technical':{'documents','issues'}}
# The order capabilities are listed in answers.
CAPABILITY_ORDER = ('documents','billing','review','decide','issues','team')
# What a role without the capability is told: "บทบาท<label>ไม่มีสิทธิ์<...>".
DENIED = {'documents':'เปิดเอกสารและโครงการนี้','billing':'ดูใบแจ้งหนี้ การชำระเงิน และข้อมูลผู้ซื้อ','review':'ตรวจงานในขั้นตอนอนุมัติ',
          'decide':'อนุมัติรับงาน ลงนาม หรือขอแก้ไขเอกสาร','issues':'แจ้งปัญหาหรือขอเปลี่ยนแปลง','team':'จัดการทีมและขั้นตอนอนุมัติ'}
NOT_FOUND = 'ไม่พบเอกสารนี้ในบัญชีของคุณ'


def can_list(can):
    """The capabilities as a list in their usual order (answers are JSON)."""
    return [c for c in CAPABILITY_ORDER if c in can]


def covers(member, contract):
    """The member's scope includes this contract: all the owner's projects, the contract listed, or (an MA contract)
    the project it renews listed."""
    if member['all_projects']:
        return True
    listed = set(json.loads(member['projects'] or '[]'))
    return contract['id'] in listed or bool(contract.get('renews_id') and contract['renews_id'] in listed)


def _found(role, owner_id):
    return {'role':role,'can':set(CAPABILITIES[role]),'owner_id':owner_id}


def access(db, account_id, contract):
    """{'role','can':set,'owner_id'} of this account on this contract, or None. Owner when contract['account_id'] is
    the account; else an ACTIVE client_team row of that owner for this account whose scope covers the contract."""
    if not contract or not account_id:
        return None
    if contract['account_id']==account_id:
        return _found('owner',account_id)
    member = repository.membership(db,contract['account_id'],account_id)
    return _found(member['role'],contract['account_id']) if member and covers(member,contract) else None


def accessible(db, account_id):
    """{contract id: {'role','can','owner_id'}} over every contract sent at least once (version!='') that the account
    owns or reaches through a team it is an active member of."""
    found = {c['id']:_found('owner',account_id) for c in repository.sent_contracts(db,account_id)}
    for member in repository.memberships(db,account_id):
        for c in repository.sent_contracts(db,member['owner_id']):
            if c['id'] not in found and covers(member,c):
                found[c['id']] = _found(member['role'],member['owner_id'])
    return found


def check(found, need):
    """403 naming what the role cannot do when it lacks `need` (None: any access is enough); returns the access."""
    if need:
        ensure(need in found['can'],f"บทบาท{ROLE_LABELS[found['role']]}ไม่มีสิทธิ์{DENIED[need]}",403)
    return found


def require(db, session, contract_id, need):
    """(contract, access) for the signed-in customer. 404 'ไม่พบเอกสารนี้ในบัญชีของคุณ' without any access or before the
    contract was sent; 403 with a Thai reason naming what the role cannot do when the capability `need` is missing."""
    contract = contracts.find(db,contract_schema.an_id(contract_id,NOT_FOUND))
    ensure(contract and contract['version'],NOT_FOUND,404)
    found = access(db,session['account_id'],contract)
    ensure(found,NOT_FOUND,404)
    return contract,check(found,need)
