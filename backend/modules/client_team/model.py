"""The client team: the people a customer lets into their contracts and projects with one organization. The owner of a
contract is the customer account it was sent to (contracts.account_id); the owner invites their own staff by email,
each with a preset role (see access.py) on all their projects there or only some of them.

Organization database: client_team (one row per invited email of an owner; declined and removed rows stay as history,
and inviting the same email again re-opens its row) and contract_chats (the document chat of a team member; the
owner's is contracts.conversation_id).
Approval flows (organization database, see approvals.py): client_flows (the owner's ordered reviewers per kind, the
default for all their projects with contract_id '' or one project's override), client_flow_runs (the steps fixed when
a delivery round or a contract version reached the customer; target is the delivery id, or '<contract id>:<version>'
since version numbers repeat across contracts) and client_approvals (each reviewer's decision on a run's step).
Control database: client_invites, so an invitee who has not joined the organization yet can find the invitation."""

STATUSES = ('invited','active','declined','removed')

TENANT_TABLES = '''
CREATE TABLE IF NOT EXISTS client_team (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, email TEXT NOT NULL, account_id TEXT,
    role TEXT NOT NULL CHECK(role IN ('manager','approver','finance','technical')),
    all_projects INTEGER NOT NULL DEFAULT 1, projects TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'invited' CHECK(status IN ('invited','active','declined','removed')),
    invited_by TEXT NOT NULL, invited_at TEXT NOT NULL, accepted_at TEXT, ended_at TEXT, UNIQUE(owner_id,email)
);
CREATE TABLE IF NOT EXISTS contract_chats (
    contract_id TEXT NOT NULL, account_id TEXT NOT NULL, conversation_id TEXT NOT NULL, PRIMARY KEY(contract_id,account_id)
);
CREATE INDEX IF NOT EXISTS client_team_account ON client_team(account_id,status);
CREATE TABLE IF NOT EXISTS client_flows (
    owner_id TEXT NOT NULL, contract_id TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK(kind IN ('delivery','contract')), steps TEXT NOT NULL DEFAULT '[]',
    updated_by TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(owner_id,contract_id,kind)
);
CREATE TABLE IF NOT EXISTS client_flow_runs (
    kind TEXT NOT NULL CHECK(kind IN ('delivery','contract')), target TEXT NOT NULL, contract_id TEXT NOT NULL, milestone_id TEXT,
    steps TEXT NOT NULL DEFAULT '[]', started_at TEXT NOT NULL, PRIMARY KEY(kind,target)
);
CREATE INDEX IF NOT EXISTS client_flow_runs_contract ON client_flow_runs(contract_id);
CREATE TABLE IF NOT EXISTS client_approvals (
    id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
    step INTEGER NOT NULL, account_id TEXT NOT NULL, name TEXT NOT NULL,
    decision TEXT NOT NULL CHECK(decision IN ('approved','returned')), remark TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '',
    decided_at TEXT NOT NULL, UNIQUE(kind,target,step)
);
'''

CONTROL_TABLES = '''
CREATE TABLE IF NOT EXISTS client_invites (
    email TEXT NOT NULL, tenant_id TEXT NOT NULL, invite_id TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id,invite_id)
);
CREATE INDEX IF NOT EXISTS client_invites_email ON client_invites(email);
'''
