"""จำนวนทีมงาน: how many people may work in one organization (tenants.member_limit), set by a platform admin on the
organization's page in the console.

  1     แบบคนเดียว, what a new organization starts with: its one หัวหน้าทีม answers every customer, so a new case is
        theirs at once (automation/distribution.py) and the parts that only make sense between colleagues are hidden.
  2-5   แบบหลายคน: up to that many.

Everyone with a permanent active membership counts, whatever their role, and so does an invitation nobody has answered
yet: otherwise the last seat would be promised to two people. A support access (expires_at) and a platform admin never
count. A number lower than the people already working there is refused: nobody is switched off from the console, the
organization does that itself (ทีมและสมาชิก)."""
from backend.database import audit, db as D
from backend.database.db import one, rows
from backend.exceptions.errors import APIError
from backend.utils.dates import now
from backend.utils.validation import require

SOLO = 1
MAX = 5
# What a new organization starts with.
NEW_TENANT = SOLO


def limit(cd, tenant_id):
    row = one(cd,'SELECT member_limit FROM tenants WHERE id=?',(tenant_id,))
    return int(row['member_limit']) if row else SOLO


def solo(cd, tenant_id):
    return limit(cd,tenant_id)==SOLO


def working(cd, tenant_id):
    """The members who take a seat: active and permanent (organization/repository.tenant_members never lists a
    platform admin)."""
    from backend.modules.organization import repository as organization
    return [m for m in organization.tenant_members(cd,tenant_id) if m['active'] and not m['expires_at']]


def _invited(cd, tenant_id, members):
    """Open invitations of addresses that are not members yet."""
    emails = {m['email'] for m in members}
    found = rows(cd,'''SELECT email FROM staff_invitations WHERE tenant_id=? AND accepted_at IS NULL
                       AND cancelled_at IS NULL AND expires_at>?''',(tenant_id,now()))
    return {r['email'] for r in found}-emails


def view(cd, tenant_id):
    """{'limit', 'solo', 'members', 'invited', 'max'} for the members page and the console."""
    members = working(cd,tenant_id)
    seats = limit(cd,tenant_id)
    return {'limit':seats,'solo':seats==SOLO,'members':len(members),'invited':len(_invited(cd,tenant_id,members)),'max':MAX}


def require_room(cd, tenant_id, console=False):
    """One more person may join: a new member, a new invitation, a member switched on again."""
    seats = view(cd,tenant_id)
    if seats['members']+seats['invited']<seats['limit']:
        return
    if console:
        message = f"ทีมงานขององค์กรนี้ครบ {seats['limit']} คนแล้ว เพิ่มจำนวนทีมงานขององค์กรในหน้านี้ก่อน"
    elif seats['solo']:
        message = 'องค์กรนี้ใช้แบบคนเดียว เพิ่มทีมงานไม่ได้ ติดต่อผู้ดูแลแพลตฟอร์มเพื่อเปลี่ยนเป็นแบบหลายคน'
    else:
        message = (f"องค์กรนี้มีทีมงานครบ {seats['limit']} คนแล้ว นับรวมคำเชิญที่ยังไม่ตอบรับ ปิดบัญชีสมาชิกที่ไม่ใช้ "
                   'หรือยกเลิกคำเชิญก่อน หรือติดต่อผู้ดูแลแพลตฟอร์มเพื่อเพิ่มจำนวน')
    raise APIError(409,message)


def require_seat_on_accept(cd, tenant_id):
    """An invitation being accepted already holds its seat; the number may have been lowered since it was sent."""
    seats = view(cd,tenant_id)
    require(seats['members']<seats['limit'],'องค์กรนี้มีทีมงานครบแล้ว กรุณาติดต่อคนที่เชิญคุณ',409)


def save(cd, session, tenant_id, body):
    """The console sets the number. แบบคนเดียว needs its one member to be the หัวหน้าทีม: they answer the customers."""
    from backend.modules.platform import repository
    value = body.get('member_limit')
    require(type(value) is int and SOLO<=value<=MAX,f'จำนวนทีมงานต้องเป็น {SOLO} ถึง {MAX} คน')
    require(repository.find_tenant(cd,tenant_id),'ไม่พบองค์กร',404)
    members = working(cd,tenant_id)
    require(len(members)<=value,f'องค์กรนี้มีทีมงานที่เปิดใช้งานอยู่ {len(members)} คน ตั้งน้อยกว่านั้นไม่ได้ '
                                'ให้หัวหน้าทีมขององค์กรปิดบัญชีสมาชิกที่ไม่ใช้ก่อน',409)
    require(value!=SOLO or not members or members[0]['role']=='admin',
            'แบบคนเดียวต้องเป็นหัวหน้าทีม เพราะต้องตอบลูกค้าได้ ให้องค์กรเปลี่ยนบทบาทของสมาชิกคนนั้นก่อน',409)
    D.begin(cd)
    cd.execute('UPDATE tenants SET member_limit=? WHERE id=?',(value,tenant_id))
    audit.record(cd,session['name'],'tenant.team_size_set',tenant_id,'คนเดียว' if value==SOLO else f'หลายคน สูงสุด {value} คน')
    cd.commit()
    return view(cd,tenant_id)


def upgrade(db):
    """tenants.member_limit. An organization already working as a team when the column arrives keeps working as one
    (MAX); the rest start as แบบคนเดียว, as a new organization does."""
    if 'member_limit' in {row[1] for row in db.execute('PRAGMA table_info(tenants)')}:
        return
    db.execute(f'ALTER TABLE tenants ADD COLUMN member_limit INTEGER NOT NULL DEFAULT {SOLO}')
    for tenant in db.execute('SELECT id FROM tenants').fetchall():
        if len(working(db,tenant['id']))>SOLO:
            db.execute('UPDATE tenants SET member_limit=? WHERE id=?',(MAX,tenant['id']))
    db.commit()
