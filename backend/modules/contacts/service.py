"""Contact rules: admins and managers see everyone; agents see contacts they created or that have work in their team."""
from backend.database import audit, db as D
from backend.middleware.access import visible_team
from backend.modules.contacts import repository, schema
from backend.modules.conversations import repository as conversations
from backend.modules.customers import repository as customer_accounts
from backend.modules.guest import repository as guests
from backend.modules.tickets import repository as tickets
from backend.modules.trash import service as trash
from backend.utils.security import uid
from backend.utils.validation import require


def contact_visible(db, contact_id, ctx):
    return repository.find_visible(db,contact_id,ctx['id'],visible_team(ctx))


def list_contacts(db, ctx):
    """Each contact carries guest: {follow: [...]} when it is a guest of guest web chat (else null), satisfaction
    ({average, count, last} of its answered surveys, else null) and main_channel (the channel it wrote on most)."""
    from backend.modules.guest import service as guest
    found = repository.list_visible(db,ctx['id'],visible_team(ctx))
    reach = guest.reach(db,[c['id'] for c in found])
    # The list's badges: how satisfied the customer has been (answered surveys) and where they usually write.
    moods,channels = repository.satisfaction(db),repository.main_channels(db)
    # The team's own tags, the warning and the contact preferences (the edit form's care profile).
    profiles = repository.profiles(db)
    return [{**c,'guest':reach.get(c['id']),'satisfaction':moods.get(c['id']),'main_channel':channels.get(c['id']),
             'profile':profiles.get(c['id'])} for c in found]


def contact_profile(db, ctx, contact_id):
    """What the chat and case screens and the edit form show about a customer beyond the contact row: the care
    profile, the channels they talked on, how a guest or a support-page account can be reached, and the last edit."""
    require(contact_visible(db,contact_id,ctx),'ไม่พบลูกค้า',404)
    from backend.modules.guest import service as guest
    return {'profile':repository.profile_of(db,contact_id),'channels':repository.channels(db,contact_id),
            'guest':guest.reach(db,[contact_id]).get(contact_id),'account':repository.support_account(db,contact_id),
            'last_edit':repository.last_edit(db,contact_id)}


def create_contact(db, ctx, body):
    cid = uid()
    values,names = schema.contact_values(body)
    profile = schema.profile_values(body)
    repository.insert(db,cid,*values,ctx['id'])
    repository.insert_names(db,cid,*names)
    if profile is not None:
        repository.save_profile(db,cid,profile,ctx['name'])
    audit.record(db,ctx['name'],'contact.created',cid)
    db.commit()
    return cid


def update_contact(db, ctx, contact_id, body):
    require(contact_visible(db,contact_id,ctx),'ไม่พบลูกค้า',404)
    # Shared contact details are edited by managers to avoid cross-team mutations.
    require(ctx['role'] in ('admin','manager'),'เฉพาะเจ้าขององค์กรแก้ไขข้อมูลลูกค้าได้',403)
    values,names = schema.contact_values(body)
    profile = schema.profile_values(body)
    repository.update(db,contact_id,*values)
    repository.save_names(db,contact_id,*names)
    if profile is not None:
        repository.save_profile(db,contact_id,profile,ctx['name'])
    audit.record(db,ctx['name'],'contact.updated',contact_id)
    db.commit()


def merge_contacts(db, ctx, target_id, body):
    """Staff-confirmed merge of duplicate contacts: their cases and conversations move to the target, blank target
    details are filled from them, notes are combined, then the duplicates are deleted. Never done automatically.
    A support-page account that owned a duplicate owns the target afterwards (staff said they are the same person)."""
    require(ctx['role'] in ('admin','manager'),'เฉพาะเจ้าขององค์กรรวมข้อมูลลูกค้าได้',403)
    target = contact_visible(db,target_id,ctx)
    require(target,'ไม่พบลูกค้า',404)
    sources = [contact_visible(db,contact_id,ctx) for contact_id in schema.merge_sources(body,target_id)]
    require(all(sources),'ไม่พบลูกค้า',404)
    D.begin(db)
    fill = lambda key: target[key] or next((s[key] for s in sources if s[key]),'')
    notes = '\n\n'.join(n for n in [target['notes']]+[s['notes'] for s in sources] if n)[:3000]
    repository.update(db,target_id,target['name'],fill('email'),fill('phone'),fill('company'),notes)
    for source in sources:
        tickets.move_contact(db,source['id'],target_id)
        conversations.move_contact(db,source['id'],target_id)
        customer_accounts.move_contact(db,source['id'],target_id)
        guests.move_contact(db,source['id'],target_id)
        repository.move_profile(db,source['id'],target_id)
        repository.delete(db,source['id'])
    audit.record(db,ctx['name'],'contact.merged',target_id,', '.join(s['name'] for s in sources))
    db.commit()


def delete_contact(db, ctx, contact_id):
    """Remove a customer record. Refused while cases or conversations still point at it: those carry the history,
    so they are moved (merge) or dealt with first, and nothing is ever silently orphaned. What is removed goes to
    the recycle bin, so a delete aimed at the wrong row can be undone."""
    require(ctx['role'] in ('admin','manager'),'เฉพาะเจ้าขององค์กรลบข้อมูลลูกค้าได้',403)
    contact = contact_visible(db,contact_id,ctx)
    require(contact,'ไม่พบลูกค้า',404)
    counts = repository.linked_counts(db,contact_id)
    require(not counts['tickets'] and not counts['conversations'],
            f"ลบไม่ได้: ลูกค้ารายนี้มีเคส {counts['tickets']} รายการ และบทสนทนา {counts['conversations']} รายการ "
            'กรุณาลบเคส/บทสนทนา หรือรวมรายชื่อนี้เข้ากับรายชื่ออื่นก่อน',400)
    require(not customer_accounts.account_of_contact(db,contact_id),'ลบไม่ได้: รายชื่อนี้เป็นบัญชีที่ลูกค้าสมัครใช้หน้าลูกค้า',400)
    trash.capture(db,ctx,'contact',contact_id,contact['name'],
                  {'contacts':[contact],'contact_names':repository.names_of(db,contact_id),
                   'contact_profiles':repository.profile_rows(db,contact_id)},
                  detail=contact['email'] or contact['phone'] or contact['company'])
    repository.delete(db,contact_id)
    from backend.modules.guest import service as guest
    guest.forget_contact(db,contact_id)
    audit.record(db,ctx['name'],'contact.deleted',contact_id,contact['name'])
    db.commit()
