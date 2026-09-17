"""Organization administration: workspace overview, SLA and support-page settings, teams, members, audit log and backup."""
import json
from backend.database import audit
from backend.database.backup import make_backup
from backend.exceptions.errors import APIError
from backend.middleware.access import validate_team
from backend.modules.ai import service as ai
from backend.modules.auth import repository as users
from backend.modules.automation import service as automation
from backend.modules.customers import service as customers
from backend.modules.channels import service as channels
from backend.modules.organization import repository, schema
from backend.modules.tickets import repository as tickets
from backend.utils.security import uid
from backend.utils.validation import require


def workspace_overview(cd, db, ctx):
    """Everything the staff app needs after sign-in. Agents only see active members of their own team."""
    team_members = repository.tenant_members(cd,ctx['tenant_id'])
    if ctx['role']=='agent':
        team_members = [m for m in team_members if m['team_id']==ctx['team_id'] and m['active']]
    return {'tenant':{'id':ctx['tenant_id'],'name':ctx['tenant_name'],'slug':ctx['slug']},
            'role':ctx['role'],'team_id':ctx['team_id'],'members':team_members,
            'teams':repository.teams(db),
            'settings':repository.settings(db),
            'channels':channels.workspace_summary(db),
            'macros':automation.macro_list(db),
            # Without the platform's email, customer sign-ups work but are not verified and get no email.
            'customer_email':customers.email_ready(cd),
            # Support access requests waiting for this organization's admins (0 for everyone else).
            'support_pending':_support_pending(cd,ctx),
            'ai':{**ai.config(db),'key_configured':ai.has_key(ctx['tenant_id'])}}


def _support_pending(cd, ctx):
    from backend.modules.support_access import service as support
    return support.pending_for(cd,ctx)


def update_settings(db, ctx, body):
    for key,value in schema.settings_form(body):
        repository.update_setting(db,key,value)
    audit.record(db,ctx['name'],'settings.updated',ctx['tenant_id'])
    db.commit()


def save_customer_categories(db, ctx, body):
    items = schema.customer_categories(body,{t['id'] for t in repository.teams(db)})
    repository.update_setting(db,'customer_categories',json.dumps(items,ensure_ascii=False))
    audit.record(db,ctx['name'],'settings.updated',ctx['tenant_id'],'หมวดเรื่องของลูกค้า')
    db.commit()


def create_team(db, ctx, body):
    team_id = uid()
    repository.insert_team(db,team_id,schema.team_name(body))
    audit.record(db,ctx['name'],'team.created',team_id)
    db.commit()
    return team_id


def save_member(cd, db, ctx, member_id, body, creating):
    """Add a new account to the organization, or change a member's role/team/active flag.
    Deactivating or moving a member unassigns their cases outside the new team."""
    role,team_id = schema.role_and_team(body)
    validate_team(db,ctx,team_id)
    if creating and not member_id:
        email = schema.new_member_email(body)
        require(not users.find_user_by_email(cd,email),'อีเมลนี้มีบัญชีแล้ว ให้เจ้าของบัญชีติดต่อผู้ดูแลแพลตฟอร์มเพื่อเพิ่มสมาชิก',409)
        user_id = uid()
        name,password = schema.new_member_account(body)
        users.insert_user(cd,user_id,name,email,password)
        repository.insert_membership(cd,ctx['tenant_id'],user_id,role,team_id)
    elif not creating and member_id:
        user_id = member_id
        require(repository.find_membership(cd,ctx['tenant_id'],user_id),'ไม่พบสมาชิก',404)
        active = schema.member_active(body)
        require(user_id!=ctx['id'] or (active and role=='admin'),'ไม่สามารถถอนสิทธิ์ผู้ดูแลของตัวเองได้')
        repository.update_membership(cd,ctx['tenant_id'],user_id,role,team_id,active)
        tickets.unassign_member(db,user_id,active,team_id)
        if not active:
            # A support member switched off here: the approved request ends with it.
            from backend.modules.support_access import service as support
            support.member_removed(cd,db,ctx['tenant_id'],user_id,ctx['id'])
    else:
        raise APIError(404,'ไม่พบรายการ')
    audit.record(db,ctx['name'],'member.updated',user_id,role)
    cd.commit()
    db.commit()
    return user_id


def audit_events(cd, db, ctx):
    return audit.with_names(cd,audit.latest(db,300),db,ctx['tenant_id'])


def tenant_backup(db, ctx):
    audit.record(db,ctx['name'],'backup.created',ctx['tenant_id'])
    db.commit()
    return make_backup(ctx['tenant_id'])
