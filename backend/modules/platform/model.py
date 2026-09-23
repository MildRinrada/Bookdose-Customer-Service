"""Control database: organizations (tenants), platform-wide settings such as the registration email, and the global
FAQ the platform admin writes once for every organization. Each global article has one audience: the platform's own
admins, the admins and staff of every organization, or the end customers of every organization.

An article reaches its readers only once published, because a mistake would show in every organization at once. A new
article is a draft (published_at NULL). Changes to a published article wait in `draft` (JSON of title, category, body
and audience) while readers keep the published version, until the admin publishes them or throws them away.

problem_reports is what a member of any organization sends from the ? in the top bar: a bug, something that does not
work, something missing. It belongs to the platform, not to an organization - the organization's own admins cannot
fix the product - so it is kept here and read in the platform console. The message is the member's own words; the
page and the browser are recorded with it so the report can be reproduced.

article_templates is the library of ready-made answers the platform team writes once: the questions every
organization is asked anyway (opening hours, how to contact us, how long a reply takes). An organization takes a
copy and owns it from that moment - it edits, publishes or deletes it like anything it wrote itself. That is what
separates a template from the global FAQ above it: a global article is the platform's and every organization reads
the same one, a template stops being the platform's the moment it is taken.

tenant_slugs holds the codes an organization used to have. The code is in every link a customer was ever given - the
help centre, the follow links in emails and SMS, the widget on the organization's own website - so a code that
changes must keep working, not break every one of them. A former code leads to the same organization for good, and
is never given to another organization, or an old link would quietly open somebody else's help centre.

tenants.quota_mb is how much of the shared disk one organization may take (its attachment files plus its own
database file). Every organization's data sits on one disk, so without a ceiling one organization uploading until
the disk is full stops every organization from writing at once. Only new uploads are refused when the ceiling is
reached: reading, answering and everything already stored keep working."""

TENANT_STATUSES = ('active','suspended')
GLOBAL_AUDIENCES = ('platform','staff','customer')
REPORT_STATUSES = ('open','done')
REPORT_MAX = 4000

# Storage quota per organization (tenants.quota_mb). Every organization shares one disk: without a ceiling, one of
# them filling it stops every organization's database from being written. 0 means no ceiling, which is what the
# organizations made before quotas existed keep until a platform admin gives them one.
NO_QUOTA = 0
NEW_TENANT_QUOTA_MB = 2048
QUOTA_BOUNDS = (100, 1024*1024)          # 100 MB … 1 TB
QUOTA_WARN = 0.8                          # the organization is told from here
QUOTA_FULL = 1.0
QUOTA_MESSAGE = ('พื้นที่จัดเก็บขององค์กรเต็ม (ใช้ไป {used} จาก {quota}) ลบไฟล์แนบเก่าที่ไม่ใช้แล้ว '
                 'หรือติดต่อผู้ดูแลระบบเพื่อขอเพิ่มพื้นที่ · ข้อความที่ไม่มีไฟล์แนบยังส่งได้ตามปกติ')

# Features that can be switched on for one organization at a time (tenant_features). Something new is added here
# with default False and tried with one organization before it reaches the rest; something already everywhere is
# added with default True, so nothing changes until a platform admin turns it off for someone.
#   key: (what it is called, what it does, on unless said otherwise)
FEATURES = {
    'help_menu':    ('ปุ่มช่วยเหลือ (?) บนแถบบน','คีย์ลัดทั้งหมด คู่มือ และการรายงานปัญหาถึงผู้ดูแลแพลตฟอร์ม',True),
    'snippet_menu': ('เมนูคำตอบสำเร็จรูปขณะพิมพ์','พิมพ์ / ในช่องตอบแล้วขึ้นรายการให้เลือก ค้นหาต่อได้ทันที',True),
    # Switched off, the overview goes back to the arrangement it ships with for everybody in that organization. What
    # each member had arranged is kept, not thrown away, and comes back the moment it is switched on again.
    'dashboard_layout': ('จัดหน้าภาพรวมเองได้','ย้าย ย่อ-ขยาย และซ่อนการ์ดบนหน้าภาพรวม แยกของใครของมัน · ปิดแล้วทุกคนกลับไปใช้หน้าตามค่าเริ่มต้น',True),
}

CONTROL_TABLES = '''
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
    created_at TEXT NOT NULL,
    quota_mb INTEGER NOT NULL DEFAULT 0,
    logo TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS global_articles (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, body TEXT NOT NULL,
    audience TEXT NOT NULL CHECK(audience IN ('platform','staff','customer')),
    author TEXT NOT NULL, updated_at TEXT NOT NULL,
    published_at TEXT, draft TEXT
);
CREATE TABLE IF NOT EXISTS article_templates (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, body TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0,
    author TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tenant_slugs (
    slug TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, changed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tenant_features (
    tenant_id TEXT NOT NULL, feature TEXT NOT NULL, enabled INTEGER NOT NULL,
    changed_by TEXT NOT NULL DEFAULT '', changed_at TEXT NOT NULL,
    PRIMARY KEY (tenant_id, feature)
);
CREATE TABLE IF NOT EXISTS problem_reports (
    id TEXT PRIMARY KEY,
    tenant_id TEXT, tenant_name TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL, user_name TEXT NOT NULL DEFAULT '', user_email TEXT NOT NULL DEFAULT '',
    page TEXT NOT NULL DEFAULT '', message TEXT NOT NULL, browser TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
    created_at TEXT NOT NULL, handled_at TEXT, handled_by TEXT
);
CREATE INDEX IF NOT EXISTS problem_reports_open ON problem_reports(status,created_at);
'''
