"""ถาม AI on the settings pages. A question asked from one of SECTIONS carries the page (page.settings, the browser's
?tab= or /automation), and the assistant answers it from that page's guide (ai/settings_guides.py, written from the
docs and the screens), the outside service's own steps where the page needs them (its 'reference': Meta's for
Facebook and Instagram, read from Meta's documentation and dated), and from what the page holds now.

What the page holds is picked field by field, never copied whole: a token, a key, a secret or a password is only ever
"set" or "not set", and no email address, phone number or webhook address goes. With the organization's AI not
connected, the guide itself is what the หัวหน้าทีม reads (GET /api/ai/settings-help/<section>)."""
import datetime as dt

from backend.utils.dates import now, today
from backend.utils.validation import require

SECTIONS = ('line','email','facebook','ai','automation','webchat','service','backup','security')


def section_of(page):
    """The settings page a question was asked from, or None."""
    value = page.get('settings') if isinstance(page,dict) else None
    return value if value in SECTIONS else None


def _guides():
    from backend.modules.ai.settings_guides import GUIDES
    return GUIDES


def view(section):
    """The guide as the page shows it: its title, the questions people get stuck on, the words, and the outside
    service's steps ('' when the page needs none)."""
    require(section in SECTIONS,'ไม่พบคู่มือของหน้านี้',404)
    guide = _guides()[section]
    return {'section':section,'title':guide['title'],'questions':list(guide['questions']),'guide':guide['guide'],
            'reference':guide.get('reference','')}


def _hours_ago(stamp):
    if not stamp:
        return None
    return round((dt.datetime.fromisoformat(now())-dt.datetime.fromisoformat(stamp)).total_seconds()/3600,1)


def _outbox(counts):
    """[{status, count}] (channels/repository.outbox_counts) as what failed and what still waits."""
    found = {row['status']:row['count'] for row in counts}
    return {'failed_to_send':found.get('failed',0),'waiting_to_send':sum(found.get(s,0) for s in ('queued','sending'))}


def _channel(db, tenant_id, kind):
    from backend.modules.channels import health, service as channels
    found = next(c for c in channels.overview(db,tenant_id) if c['kind']==kind)
    state = {'on':found['enabled'],'credentials_set':found['credentials_configured'],'problem':found['last_error'],
             'hours_since_last_check':_hours_ago(found['last_checked']),'hours_since_last_message_in':_hours_ago(found['last_received']),
             'chatbot_on':bool(found['config'].get('chatbot_enabled')),**_outbox(found['outbox'])}
    if kind=='line':
        hook = health.webhook(db)
        # Whether LINE sends its events here, not the address itself.
        state['line_webhook'] = {'checked':bool(hook),'active':bool(hook.get('active')),
                                 'points_here':bool(hook.get('endpoint') and found['route_id'] and found['route_id'] in hook['endpoint'])}
        state['channel_id_set'] = bool(found.get('channel_id'))
    else:
        state['google_or_microsoft_app_set'] = found['oauth_client_configured']
    return state


def _facebook(db, tenant_id):
    from backend.modules.channels import facebook
    found = facebook.overview(db,tenant_id)
    cfg = found['config']
    return {'on':found['enabled'],'credentials_set':found['credentials_configured'],'page_connected':bool(cfg.get('page_id')),
            'instagram_switch_on':cfg['instagram_enabled'],'instagram_linked':bool(cfg.get('instagram_id')),
            'instagram_receiving':found['instagram']['on'],'problem':found['last_error'],
            'hours_since_last_message_in':_hours_ago(found['last_received']),**_outbox(found['outbox'])}


def _ai(db, tenant_id):
    from backend.exceptions.errors import AI_ERRORS
    from backend.modules.ai import repository, service
    found = service.overview(db,tenant_id)
    failed = db.execute("SELECT error,COUNT(*) FROM ai_jobs WHERE created_at>=? AND status='failed' GROUP BY error",(today(),)).fetchall()
    return {'connected':found['key_configured'],'connected_by':{'n8n':'n8n Webhook','gemini':'Gemini','openai':'OpenAI'}.get(found['provider'],'')
            if found['key_configured'] else '','model':found['model'],
            'staff_ai_on':found['drafts_enabled'],'chatbot_on':found['chatbot_enabled'],'translate_on':found['translate_enabled'],
            'triage_on':found['triage_enabled'],'mood_on':found['mood_enabled'],
            'daily_limit':found['daily_limit'],'per_conversation_limit':found['conversation_limit'],'max_output_tokens':found['max_output_tokens'],
            'requests_today':repository.jobs_since(db,today()),'failed_today':{AI_ERRORS.get(e,e or 'อื่น ๆ'):n for e,n in failed}}


def _automation(cd, db, ctx):
    from backend.modules.automation import distribution
    from backend.modules.platform import team_size
    cfg = distribution.config(db)
    return {'team':'คนเดียว' if team_size.solo(cd,ctx['tenant_id']) else 'หลายคน',
            'auto_assign':{'on':cfg['enabled'],'cap_per_person':cfg['cap'],'all_teams':cfg['all_teams'],'teams_chosen':len(cfg['teams']),
                           'leads_included':cfg['owners'],'cases_waiting_for_it':len(distribution.waiting(db,cfg))}}


def _webchat(db):
    from backend.modules.guest import service as guest
    found = guest.settings_view(db)
    widget = found['widget']
    return {'chat_without_signing_in_on':found['guest_chat']['enabled'],'website_button_on':widget['enabled'],
            'websites_allowed':len(widget['origins'] or []),'button_position':widget['position']}


def _service(db):
    from backend.modules.organization import hours
    cfg = hours.config(db)
    return {'business_hours_on':cfg['enabled'],'sla_counts_business_hours_only':cfg['sla'],
            'open_days':sum(1 for d in cfg['days'] if d),'holidays_set':len(cfg['holidays'])}


def _backup(db):
    from backend.modules.organization import retention
    cfg = retention.config(db)
    return {'delete_old_data_on':cfg['enabled'],'keep_months':cfg['months'],'starts_deleting_at':retention.starts_at(cfg)}


def _security(cd, db, ctx):
    from backend.modules.organization import team_security
    found = team_security.overview(cd,db,ctx)
    return {'two_step_required':found['require_two_factor'],'members':len(found['members']),
            'members_without_two_step':sum(1 for m in found['members'] if not m['protected'])}


def state(cd, db, ctx, section):
    """What the page holds now, as its screen shows it (no secret, no contact detail)."""
    tenant_id = ctx['tenant_id']
    if section in ('line','email'):
        return _channel(db,tenant_id,section)
    return {'facebook':lambda:_facebook(db,tenant_id),'ai':lambda:_ai(db,tenant_id),'automation':lambda:_automation(cd,db,ctx),
            'webchat':lambda:_webchat(db),'service':lambda:_service(db),'backup':lambda:_backup(db),
            'security':lambda:_security(cd,db,ctx)}[section]()


def context(cd, db, ctx, page):
    """settings_page for the assistant's payload, or None when the question was not asked from one of SECTIONS (or by
    someone the page is not for: the settings pages are the หัวหน้าทีม's)."""
    section = section_of(page)
    if not section or ctx['role']!='admin':
        return None
    guide = _guides()[section]
    found = {'page':guide['title'],'guide':guide['guide'],'state':state(cd,db,ctx,section)}
    if guide.get('reference'):
        found['reference'] = guide['reference']
    return found
