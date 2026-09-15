"""Contracts and TOR between an organization (the contractor) and one of its customers (the client), and the project
that follows the signing.

Control database: the platform's standard templates (written by the platform team, offered to every organization).
Organization database: the organization's own templates, and its contracts. A contract has versions (1.0, 1.1, ...):
the team edits one unsent version at a time, and once sent a version never changes. The customer reads the latest
sent version, asks about it in a chat, asks for changes or signs it; then the organization's admin countersigns.
Both signatures on the same version complete the contract: its content, signatures and attached files are sealed with
a SHA-256 hash. Every step, with the IP address and time, is kept in contract_events for disputes.

After the signing the contract is a project: its milestones are worked on, delivered and inspected by the customer
(contract_deliveries, one row per round), billed (contract_invoices: an invoice, then a receipt once the payment is
confirmed), and problems or change requests are cases linked to it (contract_issues). When the last delivery is
accepted the warranty starts (coverage_start / coverage_end); an MA contract (renews_id = the project) extends it."""

KINDS = ('contract','tor')
STATUSES = ('draft','review','changes','awaiting_org','completed','cancelled')
MILESTONE_KINDS = ('delivery','payment')
MILESTONE_STATUSES = ('pending','in_progress','submitted','revision','done')
INVOICE_STATUSES = ('unpaid','submitted','paid','void')
ISSUE_KINDS = ('bug','change')
SIGN_METHODS = ('draw','type','upload')

TEMPLATE_TABLE = '''
CREATE TABLE IF NOT EXISTS contract_templates (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('contract','tor')),
    body TEXT NOT NULL, author TEXT NOT NULL, updated_at TEXT NOT NULL
);
'''

MILESTONE_TABLE = '''
CREATE TABLE IF NOT EXISTS contract_milestones (
    id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, seq INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('delivery','payment')), title TEXT NOT NULL, due_date TEXT NOT NULL DEFAULT '',
    amount TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','submitted','revision','done')),
    progress INTEGER NOT NULL DEFAULT 0, started_at TEXT, submitted_at TEXT, done_at TEXT, done_by TEXT
);
'''

CONTROL_TABLES = TEMPLATE_TABLE

TENANT_TABLES = TEMPLATE_TABLE + MILESTONE_TABLE + '''
CREATE TABLE IF NOT EXISTS contracts (
    id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('contract','tor')),
    title TEXT NOT NULL, account_id TEXT NOT NULL, customer_name TEXT NOT NULL, customer_email TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft','review','changes','awaiting_org','completed','cancelled')),
    version TEXT NOT NULL DEFAULT '', conversation_id TEXT, document_hash TEXT, created_by TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
    renews_id TEXT, billing TEXT NOT NULL DEFAULT '{}', delivered_at TEXT, coverage_start TEXT, coverage_end TEXT,
    ma_requested_at TEXT
);
CREATE TABLE IF NOT EXISTS contract_versions (
    id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, version TEXT NOT NULL, body TEXT NOT NULL,
    milestones TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '', author TEXT NOT NULL,
    created_at TEXT NOT NULL, sent_at TEXT, warranty_days INTEGER NOT NULL DEFAULT 0,
    support_terms TEXT NOT NULL DEFAULT '', UNIQUE(contract_id,version)
);
CREATE TABLE IF NOT EXISTS contract_files (
    id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, version TEXT NOT NULL DEFAULT '', milestone_id TEXT,
    name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, storage_key TEXT NOT NULL, sha256 TEXT NOT NULL,
    uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL, ref_id TEXT
);
CREATE TABLE IF NOT EXISTS contract_signatures (
    id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, version TEXT NOT NULL,
    party TEXT NOT NULL CHECK(party IN ('customer','org')), signer_id TEXT NOT NULL, signer_name TEXT NOT NULL,
    signer_email TEXT NOT NULL, method TEXT NOT NULL CHECK(method IN ('draw','type','upload')), mark TEXT NOT NULL,
    verified_by TEXT NOT NULL CHECK(verified_by IN ('email','password')), ip TEXT NOT NULL, user_agent TEXT NOT NULL,
    signed_at TEXT NOT NULL, UNIQUE(contract_id,version,party)
);
CREATE TABLE IF NOT EXISTS contract_events (
    id INTEGER PRIMARY KEY, contract_id TEXT NOT NULL, version TEXT NOT NULL DEFAULT '',
    party TEXT NOT NULL CHECK(party IN ('org','customer','system')), actor TEXT NOT NULL, action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contract_otps (
    contract_id TEXT NOT NULL, party TEXT NOT NULL, signer_id TEXT NOT NULL, code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(contract_id,party,signer_id)
);
CREATE TABLE IF NOT EXISTS contract_deliveries (
    id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, milestone_id TEXT NOT NULL, round INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '', links TEXT NOT NULL DEFAULT '[]', submitted_by TEXT NOT NULL, submitted_at TEXT NOT NULL,
    decision TEXT NOT NULL DEFAULT 'pending' CHECK(decision IN ('pending','accepted','rejected')),
    remark TEXT NOT NULL DEFAULT '', decided_by TEXT, decided_at TEXT, ip TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS contract_invoices (
    id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, milestone_id TEXT NOT NULL, number INTEGER NOT NULL UNIQUE,
    subtotal TEXT NOT NULL, vat_rate TEXT NOT NULL, vat TEXT NOT NULL, total TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','submitted','paid','void')),
    issued_at TEXT NOT NULL, due_date TEXT NOT NULL, seller TEXT NOT NULL, issued_by TEXT NOT NULL,
    slip_note TEXT NOT NULL DEFAULT '', reject_reason TEXT NOT NULL DEFAULT '', void_reason TEXT NOT NULL DEFAULT '',
    paid_at TEXT, confirmed_by TEXT, receipt_number INTEGER UNIQUE, buyer TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS contract_issues (
    ticket_id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, milestone_id TEXT,
    kind TEXT NOT NULL CHECK(kind IN ('bug','change')), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contract_events_contract ON contract_events(contract_id,id);
CREATE INDEX IF NOT EXISTS contracts_account ON contracts(account_id);
CREATE INDEX IF NOT EXISTS contract_deliveries_milestone ON contract_deliveries(milestone_id,round);
CREATE INDEX IF NOT EXISTS contract_invoices_contract ON contract_invoices(contract_id,status);
CREATE INDEX IF NOT EXISTS contract_issues_contract ON contract_issues(contract_id);
'''

# Columns added after the first release of contracts (existing databases get them on start).
ADDED_COLUMNS = {
    'contracts':{'renews_id':'TEXT','billing':"TEXT NOT NULL DEFAULT '{}'",'delivered_at':'TEXT','coverage_start':'TEXT',
                 'coverage_end':'TEXT','ma_requested_at':'TEXT'},
    'contract_versions':{'warranty_days':'INTEGER NOT NULL DEFAULT 0','support_terms':"TEXT NOT NULL DEFAULT ''"},
    'contract_files':{'ref_id':'TEXT'},
}
