"""Authorization inside an organization: agents only see their own team's work, and who may be assigned a case."""
from backend.database import db as D
from backend.utils.validation import require


def visible_team(ctx):
    """The team an agent is limited to, or None for admins and managers (every team)."""
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
