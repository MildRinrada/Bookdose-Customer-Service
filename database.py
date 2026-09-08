"""Local storage: a control database and one physically separate database per tenant."""
import contextlib
import datetime as dt
import hashlib
import hmac
import os
from pathlib import Path
import secrets
import sqlite3
import uuid

DATA = Path(os.environ.get('BOOKDOSE_DATA', Path(__file__).parent / 'data')).resolve()


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')


def uid():
    return uuid.uuid4().hex


def password_hash(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600_000).hex()
    return f'pbkdf2_sha256$600000${salt}${digest}'


def password_ok(password, encoded):
    try:
        _, iterations, salt, digest = encoded.split('$')
        actual = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), int(iterations)).hex()
        return hmac.compare_digest(actual, digest)
    except (ValueError, TypeError):
        return False


def token_hash(value):
    return hashlib.sha256(value.encode()).hexdigest()


@contextlib.contextmanager
def connect(path):
    db = sqlite3.connect(path, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.execute('PRAGMA journal_mode=WAL')
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def control():
    return connect(DATA / 'control.sqlite3')


def tenant_path(tenant_id):
    if len(tenant_id) != 32 or any(c not in '0123456789abcdef' for c in tenant_id):
        raise ValueError('Invalid tenant ID')
    return DATA / 'tenants' / f'{tenant_id}.sqlite3'


def tenant(tenant_id):
    path = tenant_path(tenant_id)
    if not path.is_file():
        raise ValueError('Unknown tenant')
    return connect(path)


def rows(db, sql, params=()):
    return [dict(row) for row in db.execute(sql, params).fetchall()]


def one(db, sql, params=()):
    row = db.execute(sql, params).fetchone()
    return dict(row) if row else None


def audit(db, actor, action, entity, detail=''):
    db.execute('INSERT INTO audit_logs(actor,action,entity,detail,created_at) VALUES(?,?,?,?,?)',
               (actor, action, entity, detail, now()))


def init():
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    (DATA / 'tenants').mkdir(exist_ok=True, mode=0o700)
    (DATA / 'files').mkdir(exist_ok=True, mode=0o700)
    with control() as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password TEXT NOT NULL, platform_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tenants (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS memberships (
            tenant_id TEXT NOT NULL REFERENCES tenants(id), user_id TEXT NOT NULL REFERENCES users(id),
            role TEXT NOT NULL CHECK(role IN ('admin','manager','agent')), team_id TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,user_id)
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), tenant_id TEXT,
            csrf TEXT NOT NULL, expires_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
            entity TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS channel_routes (
            id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
            kind TEXT NOT NULL CHECK(kind IN ('line','email')), identity TEXT,
            UNIQUE(tenant_id,kind), UNIQUE(kind,identity)
        );
        ''')
        tenant_ids = [row[0] for row in db.execute('SELECT id FROM tenants')]
    for tenant_id in tenant_ids:
        with tenant(tenant_id) as td:
            migrate_ai(td)
            migrate_channels(td)


def migrate_channels(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS channel_settings (
        kind TEXT PRIMARY KEY CHECK(kind IN ('line','email')), route_id TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 0, config TEXT NOT NULL DEFAULT '{}',
        generation TEXT NOT NULL, last_error TEXT NOT NULL DEFAULT '', last_checked TEXT,
        last_received TEXT, next_poll TEXT, poll_lease TEXT, poll_started TEXT,
        uidvalidity TEXT, last_uid INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS channel_conversations (
        conversation_id TEXT PRIMARY KEY REFERENCES conversations(id), route_id TEXT NOT NULL,
        external_key TEXT NOT NULL, recipient TEXT NOT NULL, account_identity TEXT NOT NULL,
        last_event_time TEXT, UNIQUE(route_id,external_key)
    );
    CREATE TABLE IF NOT EXISTS channel_inbox (
        id TEXT PRIMARY KEY, route_id TEXT NOT NULL, event_key TEXT NOT NULL,
        kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', generation TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', error TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0,
        lease TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(route_id,event_key)
    );
    CREATE TABLE IF NOT EXISTS channel_outbox (
        id TEXT PRIMARY KEY, message_id TEXT NOT NULL UNIQUE REFERENCES messages(id),
        route_id TEXT NOT NULL, kind TEXT NOT NULL, actor_id TEXT NOT NULL,
        generation TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0, retry_key TEXT NOT NULL, provider_id TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '', lease TEXT, first_attempt_at TEXT, next_attempt_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_reply_refs (
        reference TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), route_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS channel_outbox_pending ON channel_outbox(status,next_attempt_at);
    CREATE INDEX IF NOT EXISTS channel_inbox_pending ON channel_inbox(status,created_at);
    ''')


def migrate_ai(db):
    """Additive, repeatable migration; original business rows are left intact."""
    db.executescript('''
    CREATE TABLE IF NOT EXISTS ai_conversations (
        conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),
        mode TEXT NOT NULL CHECK(mode IN ('human','bot')),
        reason TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_jobs (
        id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id),
        trigger_id TEXT REFERENCES messages(id), requested_by TEXT,
        mode TEXT NOT NULL CHECK(mode IN ('draft','bot','test')),
        status TEXT NOT NULL CHECK(status IN ('pending','running','done','failed','cancelled')),
        result TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '',
        lease TEXT, config_version TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ai_bot_trigger ON ai_jobs(trigger_id) WHERE mode='bot';
    CREATE INDEX IF NOT EXISTS ai_jobs_pending ON ai_jobs(status,created_at);
    CREATE TABLE IF NOT EXISTS ai_message_meta (
        message_id TEXT PRIMARY KEY REFERENCES messages(id),
        source TEXT NOT NULL CHECK(source IN ('ai','system')), citations TEXT NOT NULL DEFAULT '[]'
    );
    ''')
    db.executemany('INSERT OR IGNORE INTO settings VALUES(?,?)',[
        ('ai_drafts','0'),('ai_chatbot','0'),('ai_model','gpt-4.1-mini'),
        ('ai_daily_limit','100'),('ai_conversation_limit','20'),('ai_max_output_tokens','1000'),
        ('ai_version','0')])


def create_tenant(db, name, slug, admin_id, demo=False):
    tenant_id, team_id = uid(), uid()
    db.execute('INSERT INTO tenants(id,name,slug,created_at) VALUES(?,?,?,?)', (tenant_id,name,slug,now()))
    with connect(tenant_path(tenant_id)) as td:
        td.executescript('''
        CREATE TABLE teams(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
        CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE contacts (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE conversations (
            id TEXT PRIMARY KEY, contact_id TEXT NOT NULL REFERENCES contacts(id),
            subject TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'web',
            team_id TEXT NOT NULL REFERENCES teams(id), status TEXT NOT NULL DEFAULT 'open',
            portal_token TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE tickets (
            id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, subject TEXT NOT NULL,
            contact_id TEXT NOT NULL REFERENCES contacts(id), team_id TEXT NOT NULL REFERENCES teams(id),
            assignee_id TEXT, priority TEXT NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
            status TEXT NOT NULL CHECK(status IN ('new','open','pending_customer','pending_internal','resolved','closed')),
            category TEXT NOT NULL DEFAULT 'ทั่วไป', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            first_response_due_at TEXT NOT NULL, resolution_due_at TEXT NOT NULL,
            first_response_at TEXT, resolved_at TEXT
        );
        CREATE TABLE ticket_conversations (
            ticket_id TEXT NOT NULL REFERENCES tickets(id), conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id),
            PRIMARY KEY(ticket_id,conversation_id)
        );
        CREATE TABLE messages (
            id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
            author_id TEXT, author_name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('customer','reply','note')),
            body TEXT NOT NULL, delivery TEXT NOT NULL DEFAULT 'stored', created_at TEXT NOT NULL
        );
        CREATE TABLE attachments (
            id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id),
            name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, storage_key TEXT NOT NULL
        );
        CREATE TABLE knowledge_articles (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL,
            body TEXT NOT NULL, visibility TEXT NOT NULL CHECK(visibility IN ('public','internal')),
            author TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE audit_logs (
            id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
            entity TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
        );
        CREATE INDEX messages_conversation ON messages(conversation_id,created_at);
        CREATE INDEX tickets_team ON tickets(team_id,status);
        CREATE INDEX conversations_team ON conversations(team_id,updated_at);
        INSERT INTO settings VALUES('response_hours','4'),('resolution_hours','24'),
            ('welcome','ยินดีต้อนรับ ทีมงานพร้อมช่วยเหลือคุณ'),
            ('canned_reply','สวัสดีค่ะ ขอบคุณที่ติดต่อเข้ามา ทีมงานรับเรื่องและกำลังตรวจสอบให้นะคะ');
        ''')
        td.execute('INSERT INTO teams VALUES(?,?)',(team_id,'Customer Success'))
        migrate_ai(td)
        migrate_channels(td)
        if demo:
            seed_demo(td, admin_id, team_id)
        audit(td,'ระบบ','organization.created',tenant_id,name)
    db.execute('INSERT INTO memberships(tenant_id,user_id,role,team_id) VALUES(?,?,?,?)',
               (tenant_id,admin_id,'admin',team_id))
    audit(db,admin_id,'tenant.created',tenant_id,name)
    return tenant_id


def create_ticket(db, contact_id, team_id, subject, priority, assignee_id=None, category='ทั่วไป', conversation_id=None):
    ticket_id = uid()
    settings = dict(db.execute('SELECT key,value FROM settings').fetchall())
    timestamp = dt.datetime.now(dt.timezone.utc)
    number = db.execute('SELECT COALESCE(MAX(number),1000)+1 FROM tickets').fetchone()[0]
    db.execute('''INSERT INTO tickets(id,number,subject,contact_id,team_id,assignee_id,priority,status,category,
               created_at,updated_at,first_response_due_at,resolution_due_at) VALUES(?,?,?,?,?,?,?,'new',?,?,?,?,?)''',
               (ticket_id,number,subject,contact_id,team_id,assignee_id,priority,category,now(),now(),
                (timestamp+dt.timedelta(hours=float(settings['response_hours']))).isoformat(timespec='seconds'),
                (timestamp+dt.timedelta(hours=float(settings['resolution_hours']))).isoformat(timespec='seconds')))
    if conversation_id:
        db.execute('INSERT INTO ticket_conversations VALUES(?,?)',(ticket_id,conversation_id))
        response = db.execute("SELECT MIN(CASE WHEN m.delivery='accepted' THEN o.updated_at ELSE m.created_at END) FROM messages m LEFT JOIN channel_outbox o ON o.message_id=m.id WHERE m.conversation_id=? AND m.kind='reply' AND m.delivery IN ('stored','accepted') AND m.id NOT IN (SELECT message_id FROM ai_message_meta)",(conversation_id,)).fetchone()[0]
        if response:
            db.execute('UPDATE tickets SET first_response_at=? WHERE id=?',(response,ticket_id))
    return ticket_id


def seed_demo(db, user_id, team_id):
    samples = [
        ('พิมพ์ชนก วัฒนากุล','pim@example.com','มหาวิทยาลัยศรีนครินทร์','เข้าใช้งานห้องสมุดออนไลน์ไม่ได้','high','open','การเข้าใช้งาน', 'สวัสดีค่ะ เข้าระบบห้องสมุดแล้วขึ้นว่าบัญชีหมดอายุ รบกวนช่วยตรวจสอบให้หน่อยค่ะ'),
        ('ธนพล สุขใจ','thanapon@example.com','โรงเรียนปัญญาวิทย์','ต้องการเพิ่มจำนวนผู้ใช้งาน e-Library','normal','new','บริการและแพ็กเกจ','สนใจเพิ่มจำนวนผู้ใช้สำหรับภาคเรียนใหม่ครับ ขอรายละเอียดด้วยครับ'),
        ('ณัฐชยา ใจดี','natchaya@example.com','บริษัท อ่านดี จำกัด','เปิดหนังสือแล้วหน้าจอแสดงผลไม่ครบ','urgent','pending_internal','ปัญหาทางเทคนิค','อ่านบนแท็บเล็ตแล้วตัวหนังสือด้านขวาถูกตัดค่ะ'),
        ('กิตติพงษ์ แสงทอง','kitti@example.com','สถาบันการเรียนรู้','สอบถามการออกรายงานการอ่าน','low','pending_customer','การใช้งาน','อยากทราบวิธีดาวน์โหลดรายงานการอ่านประจำเดือนครับ'),
        ('ศิริพร มั่นคง','siri@example.com','โรงเรียนต้นกล้า','ขอคู่มือการตั้งค่าระบบสำหรับครู','normal','resolved','การใช้งาน','รบกวนส่งคู่มือเริ่มต้นใช้งานให้หน่อยค่ะ'),
    ]
    for index, (name,email,company,subject,priority,status,category,body) in enumerate(samples):
        cid, conv_id = uid(), uid()
        timestamp = (dt.datetime.now(dt.timezone.utc)-dt.timedelta(hours=index+1)).isoformat(timespec='seconds')
        db.execute('INSERT INTO contacts VALUES(?,?,?,?,?,?,?,?)',(cid,name,email,'',company,'ข้อมูลตัวอย่าง',user_id,timestamp))
        db.execute('INSERT INTO conversations VALUES(?,?,?,?,?,?,?,?,?)',
                   (conv_id,cid,subject,'web',team_id,'open',None,timestamp,timestamp))
        db.execute('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)',(uid(),conv_id,None,name,'customer',body,'stored',timestamp))
        tid = create_ticket(db,cid,team_id,subject,priority,user_id if index != 1 else None,category,conv_id)
        db.execute('UPDATE tickets SET status=?,created_at=?,updated_at=? WHERE id=?',(status,timestamp,timestamp,tid))
        if index in (0,3,4):
            reply = 'สวัสดีค่ะ ทีมงานรับเรื่องแล้ว กำลังตรวจสอบให้นะคะ' if index != 4 else 'เปิดเมนูตั้งค่า แล้วเลือกผู้ใช้งานเพื่อเพิ่มบัญชีครูได้เลยค่ะ หากต้องการความช่วยเหลือเพิ่มเติมติดต่อเราได้เสมอนะคะ'
            db.execute('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)',(uid(),conv_id,user_id,'ทีม Bookdose','reply',reply,'stored',now()))
            db.execute('UPDATE tickets SET first_response_at=? WHERE id=?',(now(),tid))
        if index == 4:
            db.execute('UPDATE tickets SET resolved_at=? WHERE id=?',(now(),tid))
        if index == 2:
            db.execute('UPDATE tickets SET first_response_due_at=? WHERE id=?',
                       ((dt.datetime.now(dt.timezone.utc)-dt.timedelta(minutes=35)).isoformat(timespec='seconds'),tid))
    for title,category,body in [
        ('เริ่มต้นใช้งาน Bookdose e-Library','เริ่มต้นใช้งาน','บทความตัวอย่างสำหรับทีมงาน\n\n1. เปิดเว็บไซต์ห้องสมุดที่องค์กรของคุณแจ้งไว้\n2. เข้าสู่ระบบด้วยบัญชีที่ได้รับจากผู้ดูแล\n3. เลือกหนังสือที่ต้องการและกดอ่าน\n\nหากไม่สามารถเข้าสู่ระบบได้ กรุณาติดต่อผู้ดูแลองค์กรเพื่อยืนยันสิทธิ์การใช้งาน'),
        ('รับเรื่องอย่างไรให้ช่วยเหลือลูกค้าได้เร็วขึ้น','แนวทางบริการ','ขอข้อมูลจากลูกค้าให้ครบก่อนส่งต่อทีมเทคนิค\n\n• อุปกรณ์และเบราว์เซอร์ที่ใช้\n• ขั้นตอนที่พบปัญหา\n• เวลาที่เกิดปัญหา\n• ภาพหน้าจอที่ไม่มีข้อมูลรหัสผ่าน\n\nบันทึกข้อมูลการวิเคราะห์ในบันทึกภายในเคส'),
    ]:
        db.execute('INSERT INTO knowledge_articles VALUES(?,?,?,?,?,?,?)',
                   (uid(),title,category,body,'internal','ทีม Bookdose',now()))
