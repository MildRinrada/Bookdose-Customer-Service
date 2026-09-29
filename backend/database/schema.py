"""Creates the tables each module declares in its model.py, and applies additive (repeatable) migrations. Tables of
features that were taken out stay untouched in databases that already have them."""
import json

from backend.database import audit
from backend.modules.ai import model as ai
from backend.modules.auth import model as auth
from backend.modules.automation import model as automation
from backend.modules.board import model as board
from backend.modules.channels import model as channels
from backend.modules.contacts import model as contacts
from backend.modules.customer_security import model as customer_security
from backend.modules.customers import model as customers
from backend.modules.guest import model as guest
from backend.modules.invitations import model as invitations
from backend.modules.conversations import model as conversations
from backend.modules.knowledge import model as knowledge
from backend.modules.org_links import model as org_links
from backend.modules.organization import model as organization
from backend.modules.pdpa import model as pdpa
from backend.modules.platform import model as platform
from backend.modules.security import model as security
from backend.modules.staff_prefs import model as staff_prefs
from backend.modules.staff_security import model as staff_security
from backend.modules.support_access import model as support_access
from backend.modules.tickets import model as tickets
from backend.modules.trash import model as trash

CONTROL_TABLES = (auth.CONTROL_TABLES, platform.CONTROL_TABLES, organization.CONTROL_TABLES, channels.CONTROL_TABLES,
                  customers.CONTROL_TABLES, customer_security.CONTROL_TABLES, org_links.CONTROL_TABLES, guest.CONTROL_TABLES, audit.TABLE,
                  security.CONTROL_TABLES, support_access.CONTROL_TABLES, staff_security.CONTROL_TABLES,
                  invitations.CONTROL_TABLES, staff_prefs.CONTROL_TABLES, pdpa.CONTROL_TABLES)
TENANT_TABLES = (organization.TENANT_TABLES, contacts.TENANT_TABLES, conversations.TENANT_TABLES, tickets.TENANT_TABLES,
                 knowledge.TENANT_TABLES, audit.TABLE)


def create_control_tables(db):
    from backend.modules.customers import migrate as customer_migrate
    for script in CONTROL_TABLES:
        db.executescript(script)
    customer_migrate.control_columns(db)
    # Support access with the organization's consent: a membership it makes ends at memberships.expires_at.
    from backend.modules.support_access import repository as support_repository
    support_repository.add_membership_expiry(db)
    # Global FAQ drafts: articles published before drafts existed stay published.
    from backend.modules.platform import repository as platform_repository
    platform_repository.add_publish_columns(db)
    # Two-factor secrets from before encryption are sealed with the platform's key (utils/secret_box).
    from backend.modules.customer_security import repository as customer_security_repository
    customer_security_repository.seal_totp_secrets(db)
    # Session limits (security round): when each staff / customer session was made and last really used.
    from backend.modules.security import sessions
    sessions.add_session_columns(db)
    # Organizations have owners and agents only: a former team lead becomes an agent; a support access (expires_at)
    # keeps its read-only view of every team as an owner would see it.
    db.execute("UPDATE memberships SET role='admin' WHERE role='manager' AND expires_at IS NOT NULL")
    db.execute("UPDATE memberships SET role='agent' WHERE role='manager'")
    # The platform's owner (the account made at first-run setup) is the one who manages the platform admins.
    from backend.modules.platform import repository as platform_repository_owner
    platform_repository_owner.remember_owner(db)
    # The devices a staff account is signed in on (ตั้งค่าบัญชี → ความปลอดภัย): an id and where each was opened.
    from backend.modules.staff_security import repository as staff_security_repository
    staff_security_repository.add_session_columns(db)
    # Where each platform admin has signed in, and the "ไม่ใช่ฉัน" links of the mails about a new place.
    from backend.modules.security import sign_in_alerts
    sign_in_alerts.upgrade(db)
    # How much of the shared disk each organization may take. The ones made before quotas existed keep no ceiling
    # (0) until a platform admin gives them one: a ceiling appearing under a working organization would refuse
    # uploads it was making yesterday.
    if 'quota_mb' not in {row[1] for row in db.execute('PRAGMA table_info(tenants)')}:
        db.execute('ALTER TABLE tenants ADD COLUMN quota_mb INTEGER NOT NULL DEFAULT 0')
    # The organization's own picture, shown wherever its customers meet it. Empty means the letters of its name, which
    # is what every organization had until now, so nothing changes for one that never sets a picture.
    if 'logo' not in {row[1] for row in db.execute('PRAGMA table_info(tenants)')}:
        db.execute("ALTER TABLE tenants ADD COLUMN logo TEXT NOT NULL DEFAULT ''")
    # A problem report can come from a customer's account too (the ? in the customer's top bar): who sent it, so the
    # console tells a customer from a team member. Every report before this came from a team.
    if 'reporter' not in {row[1] for row in db.execute('PRAGMA table_info(problem_reports)')}:
        db.execute("ALTER TABLE problem_reports ADD COLUMN reporter TEXT NOT NULL DEFAULT 'staff'")


def create_tenant_tables(db):
    for script in TENANT_TABLES:
        db.executescript(script)
    upgrade_tenant(db)


def upgrade_tenant(db):
    """Tables added after the first release; safe to run on every start. Existing rows are left intact."""
    db.executescript(ai.TENANT_TABLES)
    db.executemany('INSERT OR IGNORE INTO settings VALUES(?,?)',ai.DEFAULT_SETTINGS)
    # How customers of open conversations feel, read once by the words of their latest message (ai/mood.py).
    from backend.modules.ai import mood
    mood.backfill(db)
    # Each customer message's level, for the report's อารมณ์ลูกค้า: the older messages read once by their words.
    mood.backfill_log(db)
    # The owner's AI on the overview (an article from unanswered questions, today's summary): wider job modes.
    from backend.modules.ai import repository as ai_repository
    ai_repository.widen_jobs(db)
    db.execute(contacts.NAME_TABLE)
    # The customer's care profile: the team's tags, a warning, contact preferences, language and consent.
    db.execute(contacts.PROFILE_TABLE)
    db.executescript(channels.TENANT_TABLES)
    db.execute(trash.TENANT_TABLES)
    db.executescript(automation.TENANT_TABLES)
    # The overview's handover notes and to-dos.
    db.executescript(board.TENANT_TABLES)
    # ประกาศปัญหาที่รู้แล้ว: what is down, shown to customers on the chat pages.
    from backend.modules.incidents import model as incidents
    db.executescript(incidents.TENANT_TABLES)
    # How the team uses the knowledge base (uses, helpful marks, pins) and each article's earlier versions.
    db.executescript(knowledge.ACTIVITY_TABLES)
    # When finished cases went back to work (the report's reopen rate); staff changes already audited count too.
    db.executescript(tickets.REOPENS_TABLE)
    from backend.modules.tickets import repository as ticket_repository
    ticket_repository.backfill_reopens(db)
    db.executemany('INSERT OR IGNORE INTO settings VALUES(?,?)',automation.DEFAULT_SETTINGS)
    db.executescript(customers.TENANT_TABLES)
    db.execute('INSERT OR IGNORE INTO settings VALUES(?,?)',('customer_categories',json.dumps(customers.DEFAULT_CATEGORIES,ensure_ascii=False)))
    # The system has no payments: the old default payment question is swapped for the current default in stored lists.
    row = db.execute("SELECT value FROM settings WHERE key='customer_categories'").fetchone()
    stored = json.loads(row[0]) if row else []
    if any(item.get('name')=='สอบถามเรื่องการชำระเงิน' for item in stored):
        names = {item.get('name') for item in stored}
        kept = [item for item in stored if item.get('name')!='สอบถามเรื่องการชำระเงิน']
        kept += [item for item in customers.DEFAULT_CATEGORIES if item['name'] not in names and item['name']=='ข้อเสนอแนะและร้องเรียน']
        db.execute("UPDATE settings SET value=? WHERE key='customer_categories'",(json.dumps(kept,ensure_ascii=False),))
    if 'comment' not in {row[1] for row in db.execute('PRAGMA table_info(csat_surveys)')}:
        db.execute("ALTER TABLE csat_surveys ADD COLUMN comment TEXT NOT NULL DEFAULT ''")
    # Guest web chat (customers chatting without an account): its tables and the switches of the chat and widget.
    db.executescript(guest.TENANT_TABLES)
    db.executemany('INSERT OR IGNORE INTO settings VALUES(?,?)',guest.DEFAULT_SETTINGS)
    # Notices of web conversations say what happened: a team reply, an AI answer or a handoff to the team.
    from backend.modules.customers import migrate as customer_migrate
    customer_migrate.tenant_columns(db)
    # Read receipts in web chat: when staff last read a conversation after the customer's message.
    db.execute(conversations.READS_TABLE)
    # Emails members asked for about their own work (ตั้งค่าบัญชี → การแจ้งเตือน), sent by the automation worker.
    db.executescript(staff_prefs.TENANT_TABLES)
    # คำตอบสำเร็จรูปของทีม: a list, where the organization used to have one prepared reply. The saved one moves in.
    db.executescript(organization.TEAM_SNIPPETS_TABLE)
    from backend.modules.organization import hours
    db.executescript(hours.TABLE)
    from backend.modules.automation import quiet
    db.executescript(quiet.TABLE)
    from backend.modules.organization import retention
    db.executescript(retention.TABLE)
    from backend.modules.organization import repository as organization_repository
    organization_repository.move_canned_reply(db)
    # A team can say what it is for, beside what it is called (ทีมและสมาชิก). Teams made before this have no words yet.
    if 'description' not in {row[1] for row in db.execute('PRAGMA table_info(teams)')}:
        db.execute("ALTER TABLE teams ADD COLUMN description TEXT NOT NULL DEFAULT ''")
    # Editing or taking back a message sent to the wrong place (แก้ไข/ลบข้อความ). A deleted message is kept as a
    # marker rather than removed: the team needs to see that something was there and is gone, and the history has to
    # keep saying who wrote it.
    columns = {row[1] for row in db.execute('PRAGMA table_info(messages)')}
    if 'edited_at' not in columns:
        db.execute('ALTER TABLE messages ADD COLUMN edited_at TEXT')
    if 'deleted_at' not in columns:
        db.execute('ALTER TABLE messages ADD COLUMN deleted_at TEXT')
    if 'deleted_by' not in columns:
        db.execute("ALTER TABLE messages ADD COLUMN deleted_by TEXT NOT NULL DEFAULT ''")
    # Which template an article was taken from (คลังบทความแม่แบบ), so the library can show what has been taken
    # already. The article itself belongs to the organization from that moment and is edited like any other.
    if 'from_template' not in {row[1] for row in db.execute('PRAGMA table_info(knowledge_articles)')}:
        db.execute("ALTER TABLE knowledge_articles ADD COLUMN from_template TEXT NOT NULL DEFAULT ''")
    # The arrangement of the overview new members start from (ภาพรวม → จัดหน้า); empty = as the screen ships.
    db.execute("INSERT OR IGNORE INTO settings VALUES('dashboard_layout','')")
    # พักเคส: when a paused case comes back, why it was paused and who paused it (tickets/model.py).
    columns = {row[1] for row in db.execute('PRAGMA table_info(tickets)')}
    for name,declaration in tickets.SNOOZE_COLUMNS:
        if name not in columns:
            db.execute(f'ALTER TABLE tickets ADD COLUMN {name} {declaration}')
    db.execute(tickets.SNOOZE_INDEX)
    # ป้ายเคส: the organization's words for what a case is about, on its cases (tickets/tags.py); routing rules may
    # put them on. แจกเคสอัตโนมัติ: who each case went to (automation/distribution.py).
    from backend.modules.tickets import fields, tags
    db.executescript(tags.TABLE)
    # ช่องข้อมูลเพิ่มเติมของเคส: the values of the organization's own fields on its cases (tickets/fields.py).
    db.executescript(fields.TABLE)
    # บทความนี้ช่วยได้ไหม from customers (knowledge/feedback.py); ขอให้ติดต่อกลับ (portal/callback.py).
    from backend.modules.knowledge import feedback as knowledge_feedback
    from backend.modules.portal import callback
    db.executescript(knowledge_feedback.TABLE)
    db.executescript(callback.TABLE)
    # คุยต่อบนมือถือ: the QR links a guest shows to open a chat on their phone (guest/handoff.py).
    from backend.modules.guest import handoff
    db.executescript(handoff.TABLE)
    # ไม่รีบ (portal/no_rush.py) and ขอคนเดิม (portal/same_member.py) from customers starting or waiting in a chat.
    from backend.modules.portal import no_rush, same_member
    db.executescript(no_rush.TABLE)
    db.executescript(same_member.TABLE)
    from backend.modules.automation import distribution, repository as automation_repository
    automation_repository.add_rule_tags(db)
    db.executescript(distribution.TABLE)
    # กำแพงคำชม (kudos), ยกมือขอช่วย (tickets/hands.py) and ผลงานของฉัน: the monthly summary and badges (achievements).
    from backend.modules.achievements import model as achievements
    from backend.modules.kudos import model as kudos
    from backend.modules.tickets import hands
    db.executescript(kudos.TENANT_TABLES)
    # Hearts sent back from the thank-you card go up on the wall too (a new kudos source).
    from backend.modules.kudos import service as kudos_service
    kudos_service.widen_sources(db)
    db.executescript(hands.TABLE)
    db.executescript(achievements.TENANT_TABLES)
    # การ์ดขอบคุณหลังปิดเคส: one per finished case with a web conversation (automation/thanks.py).
    from backend.modules.automation import thanks
    db.executescript(thanks.TABLE)
    # เส้นทางเคส: every change of a case's status and when (tickets/journey.py), with what older cases already say.
    from backend.modules.tickets import journey
    db.executescript(journey.TABLE)
    journey.backfill(db)
    # รีแอคข้อความ: the customer's emoji on a team reply of a web chat (conversations/reactions.py).
    from backend.modules.conversations import reactions
    db.executescript(reactions.TABLE)
    reactions.widen(db)
    # บล็อกผู้ก่อกวน: guests an owner blocked, and the address each guest chat was started from (guest/blocks.py).
    from backend.modules.guest import blocks as guest_blocks
    guest_blocks.upgrade(db)
