"""Control database: what the PDPA tool did (pdpa/service.py) - each export and erasure, who asked for it, when and
why. The person is kept only as a masked label and a hash of what was searched: an erasure log that holds the erased
email would undo the erasure."""

CONTROL_TABLES = '''
CREATE TABLE IF NOT EXISTS pdpa_requests (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('export','erase')), subject TEXT NOT NULL,
    subject_hash TEXT NOT NULL, scope TEXT NOT NULL, reason TEXT NOT NULL, by_id TEXT NOT NULL, by_name TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pdpa_requests_created ON pdpa_requests(created_at);
'''

# What an erased customer record and its conversations read afterwards: the rows stay (a case count, when it was
# opened and closed) so the organization's reports still add up, with nothing left that says who it was.
ERASED_NAME = 'ลูกค้าที่ลบข้อมูลตามคำขอ PDPA'
ERASED_TEXT = '[ลบตามคำขอ PDPA]'
CONFIRM_WORD = 'ลบถาวร'
