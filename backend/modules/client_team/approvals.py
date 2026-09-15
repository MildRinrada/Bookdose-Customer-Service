"""Approval flows of the customer side: reviewers in order, then a person with 'decide' does the final action
(accepting a delivery, signing a contract version).

A flow is a list of account ids: the owner or active members of the owner's team whose role has 'review', each at
most once. The owner keeps one flow per kind (delivery | contract) for all their projects in the organization, and
may override it for one project (an MA contract uses its own override, then its project's, then the default).
When a delivery round or a contract version reaches the customer, the flow in force is fixed as that review's steps
(client_flow_runs), keeping only people who may still review that contract: editing a flow later never changes a
running review. An empty flow is the old behaviour: the decision alone.
Reviewers decide in order. 'approved' passes the review to the next step; after the last one the final action is
open (until then project.accept and service.customer_otp / customer_sign answer 409 naming who still has to review).
'returned' ends the review the way the final decider's own refusal would: a delivery round is rejected (the
milestone goes back to revision, the remark to the team in the chat), a contract version gets 'ขอแก้ไขเงื่อนไข'.
The next round or version starts a new review from step 1.
Whoever's turn it is gets told (customers/notify.contract_event, event 'approval') after each commit.
A member who leaves the team (or loses 'review' or the project) leaves every flow of the owner and the steps they
have not decided yet in running reviews; the steps they already approved stay as history."""
import json

from backend.database import audit, db as D
from backend.modules.client_team import access, repository, schema
from backend.modules.contracts import repository as contracts, schema as contract_schema
from backend.utils.security import uid
from backend.utils.validation import require

WORDS = {'approved':'ผ่านการตรวจ','returned':'ส่งกลับแก้ไข'}
NOT_YOUR_TURN = 'ยังไม่ถึงขั้นตอนของคุณในการตรวจ'


def contract_target(contract):
    """The review of a contract version: version numbers repeat across contracts, so the target names both."""
    return f"{contract['id']}:{contract['version']}"


def _eligible(db, owner_id, account_id, contract=None):
    """The account may be a step of the owner's flows (on this contract): the owner, or an active member whose role
    has review and whose projects cover the contract."""
    if account_id==owner_id:
        return True
    member = repository.membership(db,owner_id,account_id)
    return bool(member and 'review' in access.CAPABILITIES[member['role']] and (contract is None or access.covers(member,contract)))


def _ids(row):
    return json.loads(row['steps']) if row else []


def _inherited(db, contract, kind):
    """The flow a project follows without its own override: its project's override (an MA contract), else the
    owner's default."""
    owner = contract['account_id']
    if contract.get('renews_id') and (row:=repository.flow(db,owner,contract['renews_id'],kind)):
        return _ids(row)
    return _ids(repository.flow(db,owner,'',kind))


def _in_force(db, contract, kind):
    row = repository.flow(db,contract['account_id'],contract['id'],kind)
    return _ids(row) if row else _inherited(db,contract,kind)


def start(cd, db, contract, kind, target, milestone_id=None):
    """A delivery round / contract version reached the customer (inside the caller's transaction): fix the flow in
    force as this review's steps, keeping only people who may still review the contract. Returns the steps ([]: no
    reviewers, the decision alone as before)."""
    from backend.modules.customers import repository as accounts
    steps = []
    for account_id in _in_force(db,contract,kind):
        account = accounts.find(cd,account_id) if _eligible(db,contract['account_id'],account_id,contract) else None
        if account:
            steps.append({'account_id':account_id,'name':account['name']})
    if steps:
        repository.start_run(db,kind,target,contract['id'],milestone_id,json.dumps(steps,ensure_ascii=False))
    return steps


def _state(db, kind, target):
    """{steps, current (1-based, None once every step approved), started_at} of a review, or None without one."""
    row = repository.run(db,kind,target)
    listed = _ids(row)
    if not listed:
        return None
    decided = {d['step']:d for d in repository.decisions(db,kind,target)}
    steps = []
    for n,s in enumerate(listed,1):
        d = decided.get(n)
        steps.append({'step':n,'account_id':s['account_id'],'name':d['name'] if d else s['name'],'decision':d['decision'] if d else None,
                      'remark':d['remark'] if d else '','decided_at':d['decided_at'] if d else None})
    current = next((s['step'] for s in steps if s['decision']!='approved'),None)
    return {'steps':steps,'current':current,'started_at':row['started_at']}


def _run(state, account_id, can):
    """What one viewer sees of a review (Run): the steps, whose turn it is, and whether the final action is open."""
    if not state:
        return None
    current = state['current']
    turn = bool(current and account_id and state['steps'][current-1]['account_id']==account_id and 'review' in can)
    return {'steps':state['steps'],'current':current,'my_turn':turn,'can_decide':'decide' in can,'ready':current is None}


def _pending(db, contract):
    """[(milestone, pending delivery)] of a completed contract: the rounds waiting for the customer."""
    if contract['status']!='completed':
        return []
    found = []
    for m in contracts.milestones(db,contract['id']):
        delivery = contracts.pending_delivery(db,m['id']) if m['status']=='submitted' else None
        if delivery:
            found.append((m,delivery))
    return found


def view(db, contract, account_id=None, can=()):
    """{'contract': Run|None, 'deliveries': {milestone id: Run}} of the reviews still waiting on this contract, as
    this viewer sees them (the team's side: no viewer, read-only)."""
    found = {'contract':None,'deliveries':{}}
    if contract['status']=='review' and contract['version']:
        found['contract'] = _run(_state(db,'contract',contract_target(contract)),account_id,can)
    for m,delivery in _pending(db,contract):
        run = _run(_state(db,'delivery',delivery['id']),account_id,can)
        if run:
            found['deliveries'][m['id']] = run
    return found


def require_ready(db, kind, target):
    """409 naming who still has to review, until every step approved (no review: nothing to wait for)."""
    state = _state(db,kind,target)
    if state and state['current']:
        total = len(state['steps'])
        left = ', '.join(f"ขั้นที่ {s['step']}/{total} คุณ{s['name']}" for s in state['steps'][state['current']-1:])
        require(False,f'ยังรอการตรวจตามขั้นตอนอนุมัติ: {left}',409)


def _record(db, session, kind, target, contract_id, decision, remark, ip):
    """Write the signed-in reviewer's decision on the step that waits (inside the caller's transaction); 409 when it is
    not their turn. Returns (step, number of steps)."""
    state = _state(db,kind,target)
    require(state and state['current'],'รายการนี้ไม่มีขั้นตอนตรวจที่รออยู่',409)
    step = state['steps'][state['current']-1]
    require(step['account_id']==session['account_id'],f"{NOT_YOUR_TURN} (ตอนนี้รอขั้นที่ {step['step']} คุณ{step['name']})",409)
    repository.decide(db,uid(),contract_id,kind,target,step['step'],session['account_id'],session['name'],decision,remark,ip)
    return step['step'],len(state['steps'])


def _detail(step, total, name, decision, remark, prefix=''):
    """The event line both sides see: "ขั้นที่ 1/2 · ชื่อ: ผ่านการตรวจ" (with the remark)."""
    return f"{prefix}ขั้นที่ {step}/{total} · {name}: {WORDS[decision]}"+(f' · {remark}' if remark else '')


def review_contract(cd, db, org, session, contract_id, body, ip):
    """ผ่านการตรวจ / ส่งกลับแก้ไข on the contract version under review, in the flow's order (review). Sending back
    is the owner's 'ขอแก้ไขเงื่อนไข': the remark goes to the team in the reviewer's document chat; returns that
    conversation id, or None after an approval."""
    from backend.modules.contracts import service as contract_service
    contract,_ = access.require(db,session,contract_id,'review')
    require(contract['status']=='review','เอกสารนี้ไม่ได้รอตรวจ',409)
    decision,remark = schema.review(body)
    target = contract_target(contract)
    D.begin(db)
    step,total = _record(db,session,'contract',target,contract['id'],decision,remark,ip)
    contracts.add_event(db,contract['id'],contract['version'],'customer',session['name'],'reviewed' if decision=='approved' else 'review_returned',
                        _detail(step,total,session['name'],decision,remark),ip)
    if decision=='returned':
        return contract_service.ask_changes(cd,db,org,session,contract,remark,ip)
    db.commit()
    tell_turn(cd,db,org,contract,'contract',target)
    return None


def review_delivery(cd, db, org, session, contract_id, milestone_id, body, ip):
    """ผ่านการตรวจ / ส่งกลับแก้ไข on a milestone's pending delivery round, in the flow's order (review). Sending back
    is the decider's own 'ส่งกลับแก้ไข': the round is rejected and the milestone goes back to revision; returns the
    conversation id of the remark, or None after an approval."""
    from backend.modules.contracts import project
    contract,_ = access.require(db,session,contract_id,'review')
    project._completed(contract)
    milestone = project._milestone(db,contract,milestone_id)
    delivery = contracts.pending_delivery(db,milestone['id'])
    require(milestone['status']=='submitted' and delivery,'งวดนี้ไม่มีงานรอตรวจรับ',409)
    decision,remark = schema.review(body)
    D.begin(db)
    step,total = _record(db,session,'delivery',delivery['id'],contract['id'],decision,remark,ip)
    contracts.add_event(db,contract['id'],contract['version'],'customer',session['name'],'reviewed' if decision=='approved' else 'review_returned',
                        _detail(step,total,session['name'],decision,remark,f"{milestone['title']} · "),ip)
    if decision=='returned':
        return project.send_back(cd,db,org,session,contract,milestone,remark,ip)
    db.commit()
    tell_turn(cd,db,org,contract,'delivery',delivery['id'])
    return None


def tell_turn(cd, db, org, contract, kind, target):
    """After the commit: email whoever's turn it is now in this review, the next reviewer only, or (every step
    approved) the people who may decide."""
    from backend.modules.customers import notify
    state = _state(db,kind,target)
    if not state:
        return
    reference = contract_schema.reference(contract)
    if kind=='delivery':
        run = repository.run(db,kind,target)
        milestone = contracts.find_milestone(db,contract['id'],run['milestone_id'])
        what,path = f"งาน “{milestone['title']}” ของ {reference}",f"/customer/documents/{org['slug']}/{contract['id']}?tab=milestones"
    else:
        what,path = f"{contract_schema.KIND_LABELS[contract['kind']]} {reference} “{contract['title']}”",f"/customer/documents/{org['slug']}/{contract['id']}"
    total = len(state['steps'])
    if state['current']:
        step = state['steps'][state['current']-1]
        notify.contract_event(cd,org,contract,'approval',f"ถึงขั้นตอนของคุณ: ตรวจ{what}",
                              f"{what} จาก {org['name']} รอคุณตรวจเป็นขั้นที่ {step['step']}/{total} ของขั้นตอนอนุมัติ\n"
                              'เปิดดูแล้วกด “ผ่านการตรวจ” หรือ “ส่งกลับแก้ไข” ได้ที่:','review',path,[step['account_id']])
    else:
        notify.contract_event(cd,org,contract,'approval',f"{what} ผ่านการตรวจครบแล้ว",
                              f"{what} จาก {org['name']} ผ่านการตรวจครบ {total} ขั้นแล้ว รอผู้มีสิทธิ์อนุมัติขั้นสุดท้าย\n"
                              'อนุมัติหรือลงนามได้ที่:','decide',path)


# Who is waiting for whom
def _waiting(account_id, can, state, since):
    """This account's item on one review, as {step, steps, final, at}, or None when it is not their turn: the step
    that waits is theirs (review), or every step approved (or no reviewers: steps 0) and they may decide."""
    steps = state['steps'] if state else []
    done = [s['decided_at'] for s in steps if s['decided_at']]
    if state and state['current']:
        step = steps[state['current']-1]
        if step['account_id']==account_id and 'review' in can:
            return {'step':state['current'],'steps':len(steps),'final':False,'at':max(done) if done else state['started_at']}
        return None
    if 'decide' in can:
        return {'step':len(steps),'steps':len(steps),'final':True,'at':max(done) if done else since}
    return None


def waiting_for(db, account_id):
    """Items where it is this account's turn, oldest first:
    [{'target':'delivery'|'contract','contract_id','milestone_id'|None,'milestone_title'|None,'step','steps','final':bool,'at'}]
    final=True: every reviewer approved and it waits for this decide-capable account (steps 0: the contract or round
    has no reviewers, it waits for the decision alone as before)."""
    found = []
    reach = access.accessible(db,account_id)
    for contract in contracts.sent_with_ids(db,list(reach)):
        can = reach[contract['id']]['can']
        base = {'contract_id':contract['id'],'milestone_id':None,'milestone_title':None}
        if contract['status']=='review':
            item = _waiting(account_id,can,_state(db,'contract',contract_target(contract)),contract['updated_at'])
            if item:
                found.append({'target':'contract',**base,**item})
        for m,delivery in _pending(db,contract):
            item = _waiting(account_id,can,_state(db,'delivery',delivery['id']),delivery['submitted_at'])
            if item:
                found.append({'target':'delivery',**base,'milestone_id':m['id'],'milestone_title':m['title'],**item})
    found.sort(key=lambda i:i['at'])
    return found


def across(cd, session):
    """GET /api/customer/approvals: waiting_for in every organization the customer joined, oldest first, each with the
    organization and the document (org_slug, org_name, reference, title, kind)."""
    from backend.modules.customers import repository as accounts
    from backend.modules.platform import repository as tenants
    found = []
    for tenant_id in accounts.org_ids(cd,session['account_id']):
        org = tenants.find_active(cd,tenant_id)
        if not org:
            continue
        with D.tenant(org['id']) as db:
            for item in waiting_for(db,session['account_id']):
                contract = contracts.find(db,item['contract_id'])
                found.append({**item,'org_slug':org['slug'],'org_name':org['name'],'reference':contract_schema.reference(contract),
                              'title':contract['title'],'kind':contract['kind']})
    found.sort(key=lambda i:i['at'])
    return {'items':found}


# The owner's flows
def _reviewers(cd, db, owner_id, contract=None):
    """Who can be a step: the owner, then the active members whose role has review (and whose projects cover the
    contract): [{account_id, name, role, role_label}]."""
    from backend.modules.customers import repository as accounts
    people = [(owner_id,'owner')]+[(m['account_id'],m['role']) for m in repository.active_of_owner(db,owner_id)
                                   if 'review' in access.CAPABILITIES[m['role']] and (contract is None or access.covers(m,contract))]
    found = []
    for account_id,role in people:
        account = accounts.find(cd,account_id)
        if account:
            found.append({'account_id':account_id,'name':account['name'],'role':role,'role_label':access.ROLE_LABELS[role]})
    return found


def flows_view(cd, db, session):
    """The signed-in customer's default flows here (as an owner) and who can be in them."""
    me = session['account_id']
    return {**{kind:_ids(repository.flow(db,me,'',kind)) for kind in schema.FLOW_KINDS},'reviewers':_reviewers(cd,db,me)}


def save_flows(cd, db, session, body):
    """Save the default flows sent ({delivery: [...], contract: [...]}; a kind left out stays as it is). They apply to
    reviews that start from now on."""
    me = session['account_id']
    allowed = {p['account_id'] for p in _reviewers(cd,db,me)}
    values = {kind:schema.steps(body[kind],allowed) for kind in schema.FLOW_KINDS if kind in body}
    require(values,'ไม่มีขั้นตอนอนุมัติที่จะบันทึก')
    D.begin(db)
    for kind,steps in values.items():
        repository.save_flow(db,me,'',kind,steps,session['name'])
    audit.record(db,session['name'],'client_flow.updated',me,'ค่าเริ่มต้นทุกโครงการ')
    db.commit()


def project_flow(cd, db, session, contract_id):
    """One project's flows for its owner (team): per kind {use_default, steps} (steps in force), what it follows
    without an override (default), and who can review this project."""
    contract,_ = access.require(db,session,contract_id,'team')
    me = session['account_id']
    kinds = {}
    for kind in schema.FLOW_KINDS:
        row = repository.flow(db,me,contract['id'],kind)
        kinds[kind] = {'use_default':not row,'steps':_ids(row) if row else _inherited(db,contract,kind)}
    return {**kinds,'default':{kind:_inherited(db,contract,kind) for kind in schema.FLOW_KINDS},
            'reviewers':_reviewers(cd,db,me,contract)}


def save_project_flow(cd, db, session, contract_id, body):
    """{kind, steps, use_default}: this project's own flow of that kind, or (use_default) back to the default. It
    applies to reviews that start from now on."""
    contract,_ = access.require(db,session,contract_id,'team')
    kind = schema.flow_kind(body.get('kind'))
    use_default = body.get('use_default',False)
    require(isinstance(use_default,bool),'ข้อมูลขั้นตอนอนุมัติไม่ถูกต้อง')
    me = session['account_id']
    steps = None if use_default else schema.steps(body.get('steps',[]),{p['account_id'] for p in _reviewers(cd,db,me,contract)})
    D.begin(db)
    if steps is None:
        repository.drop_flow(db,me,contract['id'],kind)
    else:
        repository.save_flow(db,me,contract['id'],kind,steps,session['name'])
    audit.record(db,session['name'],'client_flow.updated',contract['id'],kind)
    db.commit()


def _open(db, run):
    """The review still waits: its delivery round is pending, or its contract version is under review."""
    if run['kind']=='delivery':
        delivery = contracts.pending_delivery(db,run['milestone_id']) if run['milestone_id'] else None
        return bool(delivery and delivery['id']==run['target'])
    contract = contracts.find(db,run['contract_id'])
    return bool(contract and contract['status']=='review' and contract_target(contract)==run['target'])


def on_member_removed(db, owner_id, account_id):
    """The account left the owner's team, or its role or projects changed (inside the caller's transaction): drop it
    from the owner's flows where it may no longer review, and from the steps it has not decided yet in the reviews
    still running on the owner's contracts. Steps already decided stay; the ones after it move up."""
    for row in repository.flows_of(db,owner_id):
        listed = _ids(row)
        contract = contracts.find(db,row['contract_id']) if row['contract_id'] else None
        if account_id in listed and not _eligible(db,owner_id,account_id,contract):
            repository.save_flow(db,owner_id,row['contract_id'],row['kind'],json.dumps([a for a in listed if a!=account_id]),row['updated_by'])
    for run in repository.runs_of_owner(db,owner_id):
        steps = _ids(run)
        if not any(s['account_id']==account_id for s in steps) or not _open(db,run):
            continue
        if _eligible(db,owner_id,account_id,contracts.find(db,run['contract_id'])):
            continue
        decided = {d['step'] for d in repository.decisions(db,run['kind'],run['target'])}
        kept = [s for n,s in enumerate(steps,1) if n in decided or s['account_id']!=account_id]
        repository.set_run_steps(db,run['kind'],run['target'],json.dumps(kept,ensure_ascii=False))
