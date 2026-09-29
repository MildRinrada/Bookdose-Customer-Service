"""ประกาศปัญหาที่รู้แล้ว: when something of the organization's is down, its customers read it on the chat pages
before they ask, instead of each of them asking the team the same question.

  known_issues  (each organization's database) what is down (title: "ระบบชำระเงิน"), a line for customers (detail),
                'active' while the team works on it, 'resolved' once it is back - shown as back for
                RESOLVED_SHOWN_MINUTES, so the customers who saw the problem also see it end, then gone. Posted and
                closed by the organization's owners; every change is in the activity log."""

TITLE_MAX = 80
DETAIL_MAX = 300
ACTIVE_MAX = 5
RESOLVED_SHOWN_MINUTES = 60
# The staff list keeps finished ones this long, to see what was said.
STAFF_HISTORY_DAYS = 7
STATUSES = ('active','resolved')

TENANT_TABLES = '''
CREATE TABLE IF NOT EXISTS known_issues (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ('active','resolved')), author_name TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS known_issues_status ON known_issues(status,resolved_at);
-- แจ้งฉันเมื่อแก้แล้ว (follow.py): signed-in customers waiting to hear that an issue is fixed; told_at once they were.
CREATE TABLE IF NOT EXISTS known_issue_followers (
    issue_id TEXT NOT NULL, account_id TEXT NOT NULL, created_at TEXT NOT NULL, told_at TEXT,
    PRIMARY KEY(issue_id,account_id)
);
-- ฉันก็เจอ (service.affected): one row per browser that said it hit the issue too; only the hash of its token.
CREATE TABLE IF NOT EXISTS known_issue_reports (
    issue_id TEXT NOT NULL, reporter TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(issue_id,reporter)
);
'''

# ฉันก็เจอ: a press counts at most this many times an hour from one address, so nobody can blow a number up.
REPORTS_PER_IP_HOUR = 60
