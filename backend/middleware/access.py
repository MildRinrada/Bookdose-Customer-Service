"""Authorization inside an organization: agents only see their own team's work, a ผู้ดูแลสมาชิก sees the people and
nothing of the work, and who may be assigned a case."""
import re

from backend.database import db as D
from backend.utils.routing import ID
from backend.utils.validation import require

# What a ผู้ดูแลสมาชิก ('people', organization/model.py) may call: the app's frame, ทีมและสมาชิก and the
# organization's standing with the terms. Everything else - customers, cases, chats, reports, settings - is refused
# here, before any controller, so a new route is closed to them until it is added to this list.
PEOPLE_ROUTES = [(method,re.compile(pattern)) for method,pattern in (
    ('GET','/api/workspace'),
    ('POST',f'/api/members(?:/{ID})?'), ('PATCH',f'/api/members(?:/{ID})?'),
    ('POST','/api/teams'), ('PATCH',f'/api/teams/{ID}'),
    ('GET','/api/invitations'), ('POST','/api/invitations'),
    ('POST',f'/api/invitations/{ID}/resend'), ('DELETE',f'/api/invitations/{ID}'),
    ('GET','/api/legal/organization'),
)]
PEOPLE_ONLY = 'ผู้ดูแลสมาชิกจัดการได้เฉพาะทีมและสมาชิก ไม่เห็นข้อมูลลูกค้า เคส หรือแชท'


def people_only(req, path):
    """Called for every workspace request once the member is known."""
    if req.ctx['role']=='people':
        require(any(method==req.command and pattern.fullmatch(path) for method,pattern in PEOPLE_ROUTES),PEOPLE_ONLY,403)


# A team id no team has: what a ผู้ดูแลสมาชิก is limited to, should anything reach past people_only below.
NO_TEAM = '-'


def visible_team(ctx):
    """The team an agent is limited to, None for admins (every team), and no team at all for a ผู้ดูแลสมาชิก."""
    if ctx['role']=='people':
        return NO_TEAM
    return ctx['team_id'] if ctx['role']=='agent' else None


def get_scoped(db, table, entity_id, ctx):
    """A case ('tickets') or conversation the user may see; 404 otherwise."""
    entity = D.find_in_team(db,table,entity_id,visible_team(ctx))
    require(entity is not None,'ไม่พบข้อมูลหรือคุณไม่มีสิทธิ์เข้าถึง',404)
    return entity


def validate_team(db, ctx, team_id):
    from backend.modules.organization import repository
    require(isinstance(team_id,str) and repository.team_exists(db,team_id),'ไม่พบทีม')
    require(ctx['role']!='agent' or ctx['team_id']==team_id,'ไม่มีสิทธิ์มอบหมายข้ามทีม',403)


def validate_assignee(control_db, ctx, user_id, team_id):
    from backend.modules.organization import repository
    if user_id:
        require(isinstance(user_id,str) and repository.is_active_team_member(control_db,ctx['tenant_id'],user_id,team_id),'ผู้รับผิดชอบต้องเป็นสมาชิกที่ใช้งานอยู่ในทีมนี้')
