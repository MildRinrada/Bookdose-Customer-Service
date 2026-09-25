"""Organization administration: workspace overview, SLA and support-page settings, teams, members, audit log and backup."""
import base64
import binascii
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
    from backend.modules.staff_prefs import service as staff_prefs
    team_members = repository.tenant_members(cd,ctx['tenant_id'])
    if ctx['role']=='agent':
        team_members = [m for m in team_members if m['team_id']==ctx['team_id'] and m['active']]
    # Whether each member takes new cases now (ตั้งค่าบัญชี → สถานะการทำงาน), for the owner picker and the team list.
    states = staff_prefs.availability_of(cd,[m['id'] for m in team_members])
    team_members = [{**m,'availability':states[m['id']]} for m in team_members]
    from backend.modules.platform import repository as tenants
    return {'tenant':{'id':ctx['tenant_id'],'name':ctx['tenant_name'],'slug':ctx['slug'],
                      'logo':tenants.tenant_logo(cd,ctx['tenant_id']),
                      # Codes this organization used to have: the links customers were given with them still work.
                      'former_slugs':tenants.former_slugs(cd,ctx['tenant_id'])},
            'role':ctx['role'],'team_id':ctx['team_id'],'members':team_members,
            # A platform admin on a support access: the pages show everything and offer no change.
            'read_only':bool(ctx.get('read_only')),
            'teams':repository.teams(db),
            'settings':repository.settings(db),
            # คำตอบสำเร็จรูปของทีม: everyone may use them in a reply; only an owner may change them.
            'snippets':repository.team_snippets(db),
            'channels':channels.workspace_summary(db),
            'macros':automation.macro_list(db),
            # Without the platform's email, customer sign-ups work but are not verified and get no email.
            'customer_email':customers.email_ready(cd),
            # Support access requests waiting for this organization's admins (0 for everyone else).
            'support_pending':_support_pending(cd,ctx),
            # How full the organization's share of the disk is, so running out is said before it happens rather
            # than as an upload failing (platform/storage.py).
            'storage':_storage(cd,db,ctx),
            # Which features this organization has, so something new can be tried with one organization before it
            # reaches the rest (platform/model.py FEATURES, switched per organization in the console).
            'features':_features(cd,ctx),
            'ai':{**ai.config(db),'key_configured':ai.has_key(ctx['tenant_id'])}}


def _support_pending(cd, ctx):
    from backend.modules.support_access import service as support
    return support.pending_for(cd,ctx)


def _features(cd, ctx):
    from backend.modules.platform import service as platform
    return platform.feature_state(cd,ctx['tenant_id'])


def _storage(cd, db, ctx):
    from backend.modules.platform import repository as platform, storage
    org = platform.find_tenant_quota(cd,ctx['tenant_id'])
    return storage.state(db,ctx['tenant_id'],org['quota_mb'] if org else 0)


def change_slug(cd, db, ctx, body):
    """The organization corrects its own code (ตั้งค่าองค์กร → ภาพรวม, owners only). The same rules as from the
    platform console: the old code keeps leading here, so no link already given to a customer breaks, and a code
    another organization once had is refused. Written to both histories - the organization's own and the
    platform's - because it changes what the public sees."""
    from backend.modules.platform import service as platform
    result = platform.rename_tenant_slug(cd,None,ctx['tenant_id'],body,actor=f"{ctx['name']} (ผู้ดูแลองค์กร)")
    audit.record(db,ctx['name'],'settings.slug_changed',ctx['tenant_id'],f"{ctx['slug']} → {result['slug']}")
    db.commit()
    return result


def save_profile(cd, db, ctx, body):
    """What the organization calls itself and the picture it shows (ตั้งค่าองค์กร → ภาพรวม, owners only). Both reach
    the organization's customers - the name heads every page they open and the notices they are sent - so the change
    is written to the organization's own history. The code (slug) is changed separately: it is in links already given
    out, and those must keep working."""
    from backend.modules.platform import repository as tenants
    name,logo = schema.profile_form(body)
    had = tenants.tenant_logo(cd,ctx['tenant_id'])
    tenants.save_tenant_profile(cd,ctx['tenant_id'],name,logo)
    cd.commit()
    changes = [f"ชื่อ {ctx['tenant_name']} → {name}"] if name!=ctx['tenant_name'] else []
    if bool(logo)!=bool(had):
        changes.append('เพิ่มโลโก้' if logo else 'ลบโลโก้')
    elif logo and logo!=had:
        changes.append('เปลี่ยนโลโก้')
    if changes:
        audit.record(db,ctx['name'],'settings.updated',ctx['tenant_id'],' · '.join(changes))
        db.commit()
    return {'name':name,'logo':logo}


def update_settings(db, ctx, body):
    from backend.modules.tickets import sla
    values = schema.settings_form(body)
    # The targets per priority, when the form sent them (a form without them keeps what was saved).
    if sla.KEY in body:
        values.append((sla.KEY,json.dumps(sla.form(body))))
    for key,value in values:
        repository.update_setting(db,key,value)
    audit.record(db,ctx['name'],'settings.updated',ctx['tenant_id'])
    db.commit()


def save_team_snippets(db, ctx, body):
    items = schema.team_snippets(body)
    repository.replace_team_snippets(db,items)
    audit.record(db,ctx['name'],'settings.updated',ctx['tenant_id'],f'คำตอบสำเร็จรูปของทีม {len(items)} รายการ')
    db.commit()


def save_dashboard_layout(db, ctx, body):
    """The arrangement of the overview a member starts from before they change anything of their own (ภาพรวม →
    จัดหน้า → ตั้งเป็นค่าเริ่มต้นขององค์กร). Saving an empty one puts everybody back on the screen's own arrangement.
    It is a starting point, never a rule: a member who has arranged their own page keeps it."""
    from backend.modules.staff_prefs import schema as prefs
    layout = prefs.dashboard(body.get('dashboard') or {})
    empty = not (layout['hidden'] or layout['box'])
    repository.update_setting(db,'dashboard_layout','' if empty else json.dumps(layout,ensure_ascii=False))
    audit.record(db,ctx['name'],'settings.updated',ctx['tenant_id'],
                 'ล้างค่าเริ่มต้นหน้าภาพรวม' if empty else 'ค่าเริ่มต้นหน้าภาพรวมขององค์กร')
    db.commit()


def save_customer_categories(db, ctx, body):
    items = schema.customer_categories(body,{t['id'] for t in repository.teams(db)})
    repository.update_setting(db,'customer_categories',json.dumps(items,ensure_ascii=False))
    audit.record(db,ctx['name'],'settings.updated',ctx['tenant_id'],'หมวดเรื่องของลูกค้า')
    db.commit()


def create_team(db, ctx, body):
    team_id = uid()
    repository.insert_team(db,team_id,*schema.team_form(body))
    audit.record(db,ctx['name'],'team.created',team_id)
    db.commit()
    return team_id


def save_team(db, ctx, team_id, body):
    """A team keeps its id, so nothing it owns moves: the cases, the members and the customers' categories all stay
    where they are and only the words on them change."""
    team = repository.find_team(db,team_id)
    require(team,'ไม่พบทีม',404)
    name,description = schema.team_form(body)
    repository.save_team(db,team_id,name,description)
    audit.record(db,ctx['name'],'team.updated',team_id,f"{team['name']} → {name}")
    db.commit()
    return {'name':name,'description':description}


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
        # The address is a member now: an invitation still waiting for it has nothing left to do.
        from backend.modules.invitations import service as invitations
        invitations.member_added(cd,ctx['tenant_id'],email)
    elif not creating and member_id:
        user_id = member_id
        require(repository.find_membership(cd,ctx['tenant_id'],user_id),'ไม่พบสมาชิก',404)
        active = schema.member_active(body)
        require(user_id!=ctx['id'] or (active and role=='admin'),'ไม่สามารถถอนสิทธิ์เจ้าขององค์กรของตัวเองได้')
        # There is always at least one owner who can run the organization.
        current = repository.find_membership(cd,ctx['tenant_id'],user_id)
        if current['role']=='admin' and current['active'] and not current['expires_at'] and (role!='admin' or not active):
            require(len(repository.organization_admins(cd,ctx['tenant_id']))>1,'องค์กรต้องมีเจ้าของอย่างน้อย 1 คน',409)
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

def member_photo(cd, ctx, user_id):
    """The PNG a colleague chose as their photo (auth/schema.profile_form keeps it to 128 KB). Only for a member of
    the same organization, so a photo never leaves the team that shares a workspace."""
    require(repository.find_membership(cd,ctx['tenant_id'],user_id),'ไม่พบสมาชิก',404)
    stored = users.avatar_of(cd,user_id)
    require(stored.startswith('data:image/png;base64,'),'สมาชิกคนนี้ยังไม่ได้ตั้งรูปโปรไฟล์',404)
    try:
        return base64.b64decode(stored.split(',',1)[1],validate=True)
    except (ValueError,binascii.Error):
        raise APIError(404,'รูปโปรไฟล์เสียหาย') from None
