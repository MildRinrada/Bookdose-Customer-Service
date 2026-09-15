"""Client team queries: the team rows and the owners' contracts (organization database), and the invitations by
email (control database)."""
from backend.database.db import one, rows
from backend.utils.dates import now


# Team rows (tenant)
def find(db, member_id):
    return one(db,'SELECT * FROM client_team WHERE id=?',(member_id,))


def find_email(db, owner_id, email):
    return one(db,'SELECT * FROM client_team WHERE owner_id=? AND email=?',(owner_id,email))


def of_owner(db, owner_id):
    """Every row of the owner's team, history included, oldest invitation first."""
    return rows(db,'SELECT * FROM client_team WHERE owner_id=? ORDER BY invited_at,rowid',(owner_id,))


def active_of_owner(db, owner_id):
    return rows(db,"SELECT * FROM client_team WHERE owner_id=? AND status='active' ORDER BY accepted_at,rowid",(owner_id,))


def memberships(db, account_id):
    """The teams this account is an active member of."""
    return rows(db,"SELECT * FROM client_team WHERE account_id=? AND status='active' ORDER BY accepted_at,rowid",(account_id,))


def membership(db, owner_id, account_id):
    return one(db,"SELECT * FROM client_team WHERE owner_id=? AND account_id=? AND status='active'",(owner_id,account_id))


def insert(db, member_id, owner_id, email, role, all_projects, projects, invited_by):
    db.execute('''INSERT INTO client_team(id,owner_id,email,role,all_projects,projects,status,invited_by,invited_at)
                  VALUES(?,?,?,?,?,?,'invited',?,?)''',(member_id,owner_id,email,role,all_projects,projects,invited_by,now()))


def reopen(db, member_id, role, all_projects, projects, invited_by):
    """A declined or removed email invited again: the same row starts over as an invitation."""
    db.execute('''UPDATE client_team SET role=?,all_projects=?,projects=?,status='invited',account_id=NULL,invited_by=?,invited_at=?,
                  accepted_at=NULL,ended_at=NULL WHERE id=?''',(role,all_projects,projects,invited_by,now(),member_id))


def update(db, member_id, role, all_projects, projects):
    db.execute('UPDATE client_team SET role=?,all_projects=?,projects=? WHERE id=?',(role,all_projects,projects,member_id))


def activate(db, member_id, account_id):
    """The invitee accepted; returns 1, or 0 when the invitation ended meanwhile."""
    return db.execute("UPDATE client_team SET status='active',account_id=?,accepted_at=? WHERE id=? AND status='invited'",
                      (account_id,now(),member_id)).rowcount


def end(db, member_id, status):
    """'declined' by the invitee or 'removed' by the owner; the row stays as history."""
    db.execute('UPDATE client_team SET status=?,ended_at=? WHERE id=?',(status,now(),member_id))


def sent_contracts(db, owner_id):
    """The owner's contracts that were sent at least once."""
    return rows(db,"SELECT id,number,kind,title,status,renews_id,account_id FROM contracts WHERE account_id=? AND version!='' ORDER BY created_at",
                (owner_id,))


# Approval flows (tenant)
def flow(db, owner_id, contract_id, kind):
    """The owner's flow of this kind: the default (contract_id '') or one project's override."""
    return one(db,'SELECT * FROM client_flows WHERE owner_id=? AND contract_id=? AND kind=?',(owner_id,contract_id,kind))


def flows_of(db, owner_id):
    return rows(db,'SELECT * FROM client_flows WHERE owner_id=?',(owner_id,))


def save_flow(db, owner_id, contract_id, kind, steps, by):
    db.execute('INSERT OR REPLACE INTO client_flows VALUES(?,?,?,?,?,?)',(owner_id,contract_id,kind,steps,by,now()))


def drop_flow(db, owner_id, contract_id, kind):
    db.execute('DELETE FROM client_flows WHERE owner_id=? AND contract_id=? AND kind=?',(owner_id,contract_id,kind))


def run(db, kind, target):
    return one(db,'SELECT * FROM client_flow_runs WHERE kind=? AND target=?',(kind,target))


def runs_of_owner(db, owner_id):
    return rows(db,'''SELECT r.* FROM client_flow_runs r JOIN contracts c ON c.id=r.contract_id WHERE c.account_id=?''',(owner_id,))


def start_run(db, kind, target, contract_id, milestone_id, steps):
    db.execute('INSERT OR REPLACE INTO client_flow_runs VALUES(?,?,?,?,?,?)',(kind,target,contract_id,milestone_id,steps,now()))


def set_run_steps(db, kind, target, steps):
    db.execute('UPDATE client_flow_runs SET steps=? WHERE kind=? AND target=?',(steps,kind,target))


def decisions(db, kind, target):
    return rows(db,'SELECT * FROM client_approvals WHERE kind=? AND target=? ORDER BY step',(kind,target))


def decide(db, approval_id, contract_id, kind, target, step, account_id, name, decision, remark, ip):
    db.execute('''INSERT INTO client_approvals(id,contract_id,kind,target,step,account_id,name,decision,remark,ip,decided_at)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?)''',(approval_id,contract_id,kind,target,step,account_id,name,decision,remark,ip,now()))


# Invitations by email (control)
def add_invite(cd, email, tenant_id, invite_id):
    cd.execute('INSERT OR REPLACE INTO client_invites VALUES(?,?,?,?)',(email,tenant_id,invite_id,now()))


def drop_invite(cd, tenant_id, invite_id):
    cd.execute('DELETE FROM client_invites WHERE tenant_id=? AND invite_id=?',(tenant_id,invite_id))


def invites_for(cd, email):
    return rows(cd,'SELECT * FROM client_invites WHERE email=? ORDER BY created_at DESC',(email,))
