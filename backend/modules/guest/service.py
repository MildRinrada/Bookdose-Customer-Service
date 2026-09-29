"""Guest web chat (see model.py): a customer chats with an organization without an account and keeps following the
chat by this browser, a follow link by email or SMS, or LINE notices; the history later moves into a customer account.

Rules:
- A guest is known only by the cookie of its browser (a device). An unknown cookie counts as no guest.
- A guest reaches only the conversations it started; everything else answers 404.
- A follow link opens /support/<org>/resume#t=<token> (the token never travels in a query string): 30 days, 20 uses,
  revoked by a newer link of the same way or by a merge. Opening it proves the email or phone it was sent to.
- A team reply that stays unread past the delay of the account notices is told ONCE per conversation per unread spell
  on each channel the guest has proven (a verified email, a verified phone, a linked LINE), each with a fresh link.
  Never to an address that was not proven. Email and SMS carry the organization's name and the link, never messages.
- History moves into a customer account by an explicit claim from the browser holding the cookie, or on its own when
  an account with the same verified email signs in (a shared computer must not hand chats to whoever signs in next,
  so a device alone never merges without the claim).
Nothing is sent inside a database transaction."""
import json
import secrets
from urllib.parse import quote

from backend.database import audit, db as D
from backend.exceptions.errors import APIError, ChannelError
from backend.extensions import channel_transport as T, sms
from backend.modules.contacts import repository as contacts
from backend.modules.customers import notify, repository as accounts, schema as customer_schema, service as customers
from backend.modules.customers.line import NOT_AVAILABLE, unused_code
from backend.modules.guest import repository, schema
from backend.modules.guest.model import (CONTACT_SOURCE, COOKIE_PREFIX, COOKIE_REFRESH_SECONDS, DEFAULT_GUEST_CHAT, DEFAULT_WIDGET,
                                         DEVICE_UNUSED_DAYS, GUEST_NAME, LINE_CODE_MINUTES, LINK_DAYS, MAX_NOTICE_ATTEMPTS,
                                         START_PER_VISITOR_DAY)
from backend.modules.platform import repository as tenants, service as platform
from backend.modules.tickets import fields
from backend.utils.dates import after
from backend.utils.security import token_hash, uid
from backend.utils.validation import require

NOT_FOUND = 'ไม่พบเรื่องนี้ในแชทของคุณ'
DISABLED = 'องค์กรนี้ให้เริ่มแชทได้เฉพาะสมาชิกที่เข้าสู่ระบบ'
NO_CLAIM = 'ไม่พบแชทที่คุยไว้ก่อนเข้าสู่ระบบกับองค์กรนี้ในเบราว์เซอร์นี้'
CLEANUP_SECONDS = 600
_cleaned = {}


# Settings
def _json_setting(db, key, default):
    try:
        value = json.loads(repository.setting(db,key) or 'null')
    except ValueError:
        value = None
    return {**default,**value} if isinstance(value,dict) else dict(default)


def guest_chat_enabled(db):
    return _json_setting(db,'guest_chat',DEFAULT_GUEST_CHAT)['enabled'] is True


def require_enabled(db):
    require(guest_chat_enabled(db),DISABLED,403)



def settings_view(db):
    guest_chat,widget = _json_setting(db,'guest_chat',DEFAULT_GUEST_CHAT),_json_setting(db,'widget',DEFAULT_WIDGET)
    from backend.modules.customers import perks
    return {'guest_chat':{'enabled':guest_chat['enabled'] is True},
            'widget':{key:widget[key] for key in ('enabled','origins','position','theme','title')},
            'members_first':perks.members_first(db)}


def settings_page(cd, db, ctx, base):
    """The admin's settings with the public chat link and its QR (the widget snippet is built by the page)."""
    from backend.utils import qrcode
    url = f"{base}/support/{ctx['slug']}/tickets/new"
    return {**settings_view(db),'chat_url':url,'chat_qr':qrcode.data_url(url,'QR แชทบนเว็บไซต์')}


def save_settings(db, ctx, body):
    current = settings_view(db)
    guest_chat,widget = schema.settings_form(body,current['guest_chat'],current['widget'])
    first = body.get('members_first',current['members_first'])
    require(isinstance(first,bool),'ข้อมูลคิวก่อนสำหรับสมาชิกไม่ถูกต้อง')
    D.begin(db)
    from backend.modules.customers import perks
    perks.set_members_first(db,first)
    repository.save_setting(db,'guest_chat',json.dumps(guest_chat))
    repository.save_setting(db,'widget',json.dumps(widget,ensure_ascii=False))
    audit.record(db,ctx['name'],'settings.updated',ctx['tenant_id'],'แชทบนเว็บไซต์')
    db.commit()


def widget_view(db):
    """What the widget script and the web app's framing rules read (public)."""
    view = settings_view(db)
    return {'enabled':view['widget']['enabled'],'guest_chat':view['guest_chat']['enabled'],
            **{key:view['widget'][key] for key in ('position','theme','title','origins')}}


# The browser's guest
def cookie_token(cookie_header, slug):
    """(token, present): the token of this organization's guest cookie when well-formed, and whether the browser
    sent a cookie of that name at all (a malformed one is cleared like an unknown one)."""
    name = COOKIE_PREFIX+slug
    for part in (cookie_header or '').split(';'):
        key,_,value = part.strip().partition('=')
        if key==name:
            value = value.strip()
            return (value if schema.TOKEN.fullmatch(value) else ''),True
    return '',False


def guest_cookies(cookie_header):
    """{org slug: token} of every well-formed guest cookie this browser sent (at most 20)."""
    found = {}
    for part in (cookie_header or '').split(';'):
        key,_,value = part.strip().partition('=')
        slug,value = key[len(COOKIE_PREFIX):],value.strip()
        if key.startswith(COOKIE_PREFIX) and customer_schema.SLUG.fullmatch(slug) and schema.TOKEN.fullmatch(value) and len(found)<20:
            found.setdefault(slug,value)
    return found


def read_guest(db, token):
    """{'visitor','device','token'} of a known browser, or None."""
    device = repository.device(db,token_hash(token))
    if not device:
        return None
    return {'visitor':repository.visitor(db,device['visitor_id']),'device':device,'token':token}


def touch(db, guest):
    """Write down that the browser is still used, at most once a day; True when written (the page's cookie is then
    sent again, so a remembered cookie never lapses while it is used)."""
    if (guest['device']['device_seen_at'] or '')>=after(seconds=-COOKIE_REFRESH_SECONDS):
        return False
    repository.touch_device(db,guest['device']['token_hash'])
    repository.touch_visitor(db,guest['visitor']['id'])
    db.commit()
    return True


def _line_add_url(row):
    basic_id = (row['config'].get('basic_id') or '') if row else ''
    return 'https://line.me/R/ti/p/'+quote(basic_id,safe='') if basic_id else ''


def _oa_name(row):
    return (row['config'].get('display_name') or 'LINE Official Account') if row else ''


def overview(cd, db, org, guest):
    """GET /guest: the browser's guest (or null), its conversations, how it can follow them, the categories, and the
    public key of the bot check the start form must pass."""
    from backend.extensions import turnstile
    from backend.modules.automation.service import SURVEY_DAYS
    line_row = notify.line_channel(db,org['id'])
    view,conversations = None,[]
    if guest:
        visitor,device = guest['visitor'],guest['device']
        view = {'name':visitor['name'],'email_masked':schema.mask_email(visitor['email']),'email_verified':bool(visitor['email_verified_at']),
                'phone_masked':schema.mask_phone(visitor['phone']),'phone_verified':bool(visitor['phone_verified_at']),
                'line_linked':bool(repository.line_link(db,visitor['id'])),'remember':bool(device['remember']),'csrf':device['csrf']}
        conversations = [{'id':c['id'],'subject':c['subject'],'status':c['status'],'ticket_status':c['ticket_status'],'updated_at':c['updated_at'],
                          'unread':c['last_kind']=='reply' and (not c['seen_at'] or c['seen_at']<c['updated_at']),
                          'survey_pending':bool(c['survey_pending'])}
                         for c in repository.conversations_of(db,visitor['id'],after(days=-SURVEY_DAYS))]
    return {'guest':view,'conversations':conversations,
            'follow':{'email_ready':customers.email_ready(cd),'sms_ready':sms.ready(cd),'line_ready':bool(line_row),
                      'line_oa_name':_oa_name(line_row),'line_add_url':_line_add_url(line_row)},
            'categories':[c['name'] for c in customers.categories(db)],
            'form_fields':fields.customer_fields(db),
            'organization':{'name':org['name'],'slug':org['slug'],'logo':org.get('logo','')},
            # The public key of the bot check on the start form ('' when the platform has not switched it on).
            'captcha':{'site_key':turnstile.site_key(cd),'action':turnstile.START_ACTION}}


def _contact_of(db, visitor):
    """The guest's contact; made again when staff deleted it meanwhile."""
    if contacts.find(db,visitor['contact_id']):
        return visitor['contact_id']
    contact_id = uid()
    contacts.insert(db,contact_id,visitor['name'] or f"{GUEST_NAME} {visitor['id'][:6].upper()}",'','','','',CONTACT_SOURCE)
    repository.set_visitor_contact(db,visitor['id'],contact_id)
    return contact_id


def _rename(db, visitor, name):
    """The guest's name, also on its contact while that is still the one made for the guest."""
    repository.set_name(db,visitor['id'],name)
    contact = contacts.find(db,visitor['contact_id'])
    if contact and contact['created_by']==CONTACT_SOURCE and name:
        contacts.update(db,contact['id'],name,contact['email'],contact['phone'],contact['company'],contact['notes'])


def start(cd, db, org, guest, body, client, base):
    """POST /guest/conversations: a new chat, as the browser's guest or as a new one. An email address and a phone
    number are optional: the follow link goes to each one given (after the chat is saved; a link that cannot be sent
    does not undo the chat). A new guest who asks this browser not to remember them must give one of them, or the chat
    would be lost when the browser closes. Returns ({id, csrf, links}, the new cookie token or None, remember)."""
    name,remember = schema.start_form(body)
    email,phone,reference = schema.reach_form(body,customers.email_ready(cd),sms.ready(cd))
    require(guest or remember or email or phone,'เลือก “จำแชทในเครื่องนี้” หรือกรอกอีเมลหรือเบอร์โทรเพื่อรับลิงก์ติดตามแชท')
    request = schema.request_body(body,body.get('body'))
    subject,category = customers.request_form(db,request)
    # A blocked guest or address, or an address that started too many chats today (blocks.py).
    from backend.modules.guest import blocks
    blocks.check_start(db,guest,client.get('ip',''))
    D.begin(db)
    token = None
    if guest:
        visitor,csrf = guest['visitor'],guest['device']['csrf']
        remember = bool(guest['device']['remember'])
        require(repository.started_since(db,visitor['id'],after(days=-1))<START_PER_VISITOR_DAY,
                'เริ่มแชทใหม่ได้ไม่เกิน 10 เรื่องต่อวัน กรุณาคุยต่อในแชทเดิม',429)
        if name and name!=visitor['name']:
            _rename(db,visitor,name)
            visitor = {**visitor,'name':name}
    else:
        visitor_id,contact_id = uid(),uid()
        contacts.insert(db,contact_id,name or f'{GUEST_NAME} {visitor_id[:6].upper()}','','','','',CONTACT_SOURCE)
        repository.insert_visitor(db,visitor_id,contact_id,name)
        token,csrf = secrets.token_urlsafe(32),secrets.token_urlsafe(24)
        repository.insert_device(db,token_hash(token),visitor_id,csrf,remember,client.get('user_agent',''),client.get('ip',''))
        visitor = repository.visitor(db,visitor_id)
    contact_id = _contact_of(db,visitor)
    conv_id = customers.new_web_conversation(db,org,contact_id,schema.display_name(visitor),subject,category,request)
    repository.add_conversation(db,conv_id,visitor['id'],blocks.address(client.get('ip','')))
    repository.mark_seen(db,visitor['id'],conv_id)
    if reference:
        accounts.set_reference(db,conv_id,reference)
    audit.record(db,schema.display_name(visitor),'guest.started',conv_id,'ผู้เยี่ยมชมใหม่' if token else '')
    db.commit()
    links = []
    for via,target in (('email',email),('sms',phone)):
        if target:
            try:
                links.append({'via':via,'to_masked':_deliver_link(cd,db,org,visitor,via,target,base),'sent':True})
            except APIError as failure:
                links.append({'via':via,'to_masked':schema.mask(via,target),'sent':False,'error':failure.message})
    return {'id':conv_id,'csrf':csrf,'links':links},token,remember


def current_conversation(db, guest, conversation_id):
    """A conversation the guest started; 404 for any other."""
    well_formed = isinstance(conversation_id,str) and customer_schema.ID.fullmatch(conversation_id)
    conv = repository.owned_conversation(db,guest['visitor']['id'],conversation_id) if well_formed else None
    require(conv,NOT_FOUND,404)
    return conv


def mark_seen(db, guest, conversation_id):
    from backend.realtime import events as realtime
    realtime.customer_read(db,conversation_id,visitor_id=guest['visitor']['id'])
    repository.mark_seen(db,guest['visitor']['id'],conversation_id)


def case_detail(db, guest, case_id):
    visitor_id = guest['visitor']['id']
    ticket = repository.owned_case(db,visitor_id,case_id) if customer_schema.ID.fullmatch(case_id or '') else None
    require(ticket,'ไม่พบเคสนี้ในแชทของคุณ',404)
    from backend.modules.tickets import journey
    return customer_schema.case_view(ticket,repository.case_conversations(db,visitor_id,ticket['id']),
                                     accounts.case_followups(db,ticket['id']),accounts.case_rating(db,ticket['id']),
                                     journey.of(db,ticket))


def set_name(db, guest, body):
    name = schema.name_form(body)
    D.begin(db)
    _rename(db,guest['visitor'],name)
    db.commit()


def set_remember(db, guest, body):
    remember = schema.remember_form(body)
    D.begin(db)
    repository.set_remember(db,guest['device']['token_hash'],remember)
    db.commit()
    return remember


def forget(db, guest):
    """Forget this browser only (the guest's other browsers and links keep working)."""
    D.begin(db)
    repository.delete_device(db,guest['device']['token_hash'])
    db.commit()


# Follow links
def _follow_url(base, slug, token):
    return f"{(base or '').rstrip('/')}/support/{slug}/resume#t={token}"


def _notice_base(cd, line_row):
    """Where links in notices point: the platform's public address, else the one set for LINE file links."""
    return (platform.registration_config(cd).get('public_base_url') or (line_row['config'].get('public_base_url') if line_row else '') or '').rstrip('/')


def _email(cd, recipient, subject, text):
    customers._send(platform.registration_config(cd),platform.registration_secret(),recipient,subject,text)


def send_link(cd, db, org, guest, body, base):
    """POST /guest/link: a follow link by email or SMS; returns the masked address. A newer link revokes the older
    ones sent the same way once it went out. A proven address stays on the guest until the new one is proven."""
    via,target = schema.link_form(body)
    if via=='email':
        require(customers.email_ready(cd),'ยังส่งอีเมลไม่ได้ กรุณาเลือกช่องทางอื่น',409)
    else:
        require(sms.ready(cd),'ยังส่ง SMS ไม่ได้ กรุณาเลือกช่องทางอื่น',409)
    return _deliver_link(cd,db,org,guest['visitor'],via,target,base)


def _deliver_link(cd, db, org, visitor, via, target, base):
    """Make a follow link, remember the (unproven) address on the guest and send it; returns the masked address."""
    token = secrets.token_urlsafe(32)
    D.begin(db)
    repository.insert_link(db,token_hash(token),visitor['id'],via,target,after(days=LINK_DAYS))
    if via=='email' and not visitor['email_verified_at']:
        repository.set_email(db,visitor['id'],target,False)
    if via=='sms' and not visitor['phone_verified_at']:
        repository.set_phone(db,visitor['id'],target,False)
    db.commit()
    url = _follow_url(base,org['slug'],token)
    try:
        if via=='email':
            _email(cd,target,f"ลิงก์ติดตามแชทกับ {org['name']}",
                   f"เปิดลิงก์นี้เพื่อคุยต่อในแชทกับ {org['name']} จากเครื่องใดก็ได้:\n{url}\n\n"
                   'ลิงก์ใช้ได้ 30 วัน อย่าส่งต่อให้ผู้อื่น เพราะผู้ที่มีลิงก์จะอ่านแชทนี้ได้\nหากคุณไม่ได้ขอลิงก์นี้ ไม่ต้องทำอะไร\n')
        else:
            sms.send(cd,target,f"{org['name']}: ลิงก์ติดตามแชทของคุณ {url}")
    except ChannelError as failure:
        if not failure.uncertain:
            D.begin(db)
            repository.delete_link(db,token_hash(token))
            db.commit()
            raise APIError(503,'ส่งลิงก์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง') from None
        raise APIError(503,customers.UNCERTAIN_MAIL) from None
    D.begin(db)
    repository.revoke_older_links(db,visitor['id'],via,token_hash(token))
    audit.record(db,schema.display_name(visitor),'guest.link_sent',visitor['contact_id'],f'{via} {schema.mask(via,target)}')
    db.commit()
    return schema.mask(via,target)


def resume(cd, db, org, guest, body, client):
    """POST /guest/resume: open a follow link in this browser; the address it was sent to is proven when the guest
    asked for the link to its own address. A browser already following another guest's chats keeps them: it is told
    to say so (replace) before this link takes the browser over. Returns (the guest's latest conversation id, the
    cookie token)."""
    value = schema.token(body)
    D.begin(db)
    link = repository.live_link(db,token_hash(value))
    visitor = repository.visitor(db,link['visitor_id']) if link else None
    require(link and visitor and not visitor['account_id'],schema.LINK_GONE,410)
    # This browser is following someone else's chats: they are not thrown away for whoever sent this link.
    other = bool(guest and guest['visitor']['id']!=visitor['id'])
    if other and body.get('replace') is not True:
        db.rollback()
        raise APIError(409,'เบราว์เซอร์นี้มีแชทของคุณอยู่แล้ว เปิดลิงก์นี้เพื่อดูแชทอีกรายการหรือไม่',extra={'code':'guest_other_chats'})
    repository.use_link(db,link['token_hash'])
    # Proven only when the address is the one this guest itself gave (_deliver_link recorded it unproven); a link
    # sent to someone else's address never makes that address the guest's.
    own_address = ((visitor['email'] or '').lower()==link['target'].lower() if link['via']=='email'
                   else (visitor['phone'] or '')==link['target'])
    if own_address and link['via']=='email':
        repository.set_email(db,visitor['id'],link['target'],True)
    elif own_address and link['via']=='sms':
        repository.set_phone(db,visitor['id'],link['target'],True)
    if guest and guest['visitor']['id']==visitor['id']:
        token = guest['token']
        repository.set_remember(db,guest['device']['token_hash'],True)
    else:
        token = secrets.token_urlsafe(32)
        repository.insert_device(db,token_hash(token),visitor['id'],secrets.token_urlsafe(24),True,client.get('user_agent',''),client.get('ip',''))
    repository.touch_visitor(db,visitor['id'])
    audit.record(db,schema.display_name(visitor),'guest.resumed',visitor['contact_id'],f"{link['via']} {schema.mask(link['via'],link['target'])}".strip())
    conversation_id = repository.latest_conversation(db,visitor['id'])
    db.commit()
    # Only a proven address of this guest goes into the index a customer account takes its chats over by.
    if own_address and link['via']=='email':
        repository.index_email(cd,link['target'],org['id'])
        cd.commit()
    return conversation_id,token


# LINE
def line_code(db, org, guest):
    """POST /guest/line-code: a 6-digit code to send to the organization's LINE (the earlier one stops working)."""
    row = notify.line_channel(db,org['id'])
    require(row,NOT_AVAILABLE,409)
    D.begin(db)
    code = unused_code(db)
    expires_at = after(minutes=LINE_CODE_MINUTES)
    repository.replace_line_code(db,token_hash(code),guest['visitor']['id'],expires_at)
    db.commit()
    return {'code':code,'expires_at':expires_at,'oa_name':_oa_name(row),'add_url':_line_add_url(row)}


def line_unlink(db, guest):
    D.begin(db)
    repository.delete_line_link(db,guest['visitor']['id'])
    repository.delete_line_codes(db,guest['visitor']['id'])
    db.commit()


def link_line(db, visitor_id, line_user_id):
    """customers.line.take_code found a guest's live code (inside the webhook's transaction): link that LINE user and
    queue the confirmation."""
    repository.set_line_link(db,visitor_id,line_user_id)
    repository.delete_line_codes(db,visitor_id)
    visitor = repository.visitor(db,visitor_id)
    audit.record(db,'LINE','guest.line_linked',visitor['contact_id'] if visitor else visitor_id)
    repository.insert_notice(db,uid(),visitor_id,'','line','linked')


# Notices of replies
def _proven(db, visitor):
    found = []
    if visitor['email'] and visitor['email_verified_at']:
        found.append('email')
    if visitor['phone'] and visitor['phone_verified_at']:
        found.append('sms')
    if repository.line_link(db,visitor['id']):
        found.append('line')
    return found


def notify_reply(db, conversation_id, event='reply'):
    """Something new in a web conversation (inside the transaction that stored it): the team wrote ('reply'), the
    chatbot answered ('ai') or passed it to the team ('handoff'). When a guest started it, queue a notice on each
    channel the guest has proven, unless this unread spell already has one."""
    visitor = repository.visitor_of_conversation(db,conversation_id)
    if not visitor:
        return
    for channel in _proven(db,visitor):
        if not repository.notice_open(db,visitor['id'],conversation_id,channel):
            repository.insert_notice(db,uid(),visitor['id'],conversation_id,channel,event=event)


# (email subject, sentence, short SMS words) of each thing a guest hears about; never the messages themselves.
EVENT_WORDS = {'reply':('มีคำตอบใหม่จาก {org}','ทีมงาน {org} ตอบกลับในแชทของคุณแล้ว','ทีมงานตอบกลับในแชทของคุณแล้ว'),
               'ai':('มีคำตอบใหม่จาก {org}','ผู้ช่วย AI ของ {org} ตอบคำถามในแชทของคุณแล้ว','มีคำตอบใหม่ในแชทของคุณ'),
               'handoff':('ส่งต่อให้เจ้าหน้าที่ของ {org} แล้ว','แชทของคุณถูกส่งต่อให้เจ้าหน้าที่ของ {org} แล้ว เจ้าหน้าที่จะตอบกลับในแชทนี้',
                          'ส่งต่อแชทให้เจ้าหน้าที่แล้ว')}


def _text(org, job):
    """(subject, text) of a notice: the organization's name and a link, never the messages."""
    if job['kind']=='linked':
        return '',f"เชื่อม LINE กับแชทบนเว็บไซต์ของ {org['name']} เรียบร้อยแล้ว เมื่อทีมงานตอบกลับจะแจ้งที่แชทนี้"
    what = EVENT_WORDS.get(job.get('event') or 'reply',EVENT_WORDS['reply'])
    if job['channel']=='email':
        return (what[0].format(org=org['name']),
                f"{what[1].format(org=org['name'])}\n\nเปิดแชทต่อได้ที่:\n{job['link']}\n\n"
                'ลิงก์ใช้ได้ 30 วัน อย่าส่งต่อให้ผู้อื่น เพราะผู้ที่มีลิงก์จะอ่านแชทนี้ได้\n')
    if job['channel']=='sms':
        return '',f"{org['name']}: {what[2]} {job['link']}"
    return '',f"{what[1].format(org=org['name'])} เปิดแชทต่อได้ที่\n{job['link']}"


def send_notices(tenant_id):
    """Send the guest notices that are due (automation worker); returns how many went out."""
    from backend.modules.channels import service as channels
    import uuid
    jobs = []
    with D.control() as cd:
        org = tenants.tenant_summary(cd,tenant_id)
        mail,sms_on = customers.email_ready(cd),sms.ready(cd)
        with D.tenant(tenant_id) as db:
            line_row = notify.line_channel(db,tenant_id)
            base = _notice_base(cd,line_row)
            D.begin(db)
            for notice in repository.due_notices(db,after(seconds=-customers.NOTICE_DELAY_SECONDS),MAX_NOTICE_ATTEMPTS):
                if notice['kind']=='reply' and notice['seen_at'] and notice['seen_at']>=notice['created_at']:
                    repository.finish_notice(db,notice['id'],'seen')
                    continue
                visitor = repository.visitor(db,notice['visitor_id'])
                recipient = None
                if visitor and not visitor['account_id']:
                    if notice['channel']=='email' and mail and visitor['email_verified_at']:
                        recipient = visitor['email']
                    elif notice['channel']=='sms' and sms_on and visitor['phone_verified_at']:
                        recipient = visitor['phone']
                    elif notice['channel']=='line' and line_row:
                        link = repository.line_link(db,visitor['id'])
                        recipient = link['line_user_id'] if link else None
                if not recipient:
                    repository.finish_notice(db,notice['id'],'off')
                    continue
                job = {**notice,'recipient':recipient,'link':'','link_hash':None}
                if notice['kind']=='reply':
                    token = secrets.token_urlsafe(32)
                    job['link_hash'] = token_hash(token)
                    repository.insert_link(db,job['link_hash'],visitor['id'],notice['channel'],'' if notice['channel']=='line' else recipient,after(days=LINK_DAYS))
                    job['link'] = _follow_url(base,org['slug'],token)
                repository.claim_notice(db,notice['id'])
                jobs.append(job)
        line_secret = channels.read_secret(tenant_id,'line') if any(j['channel']=='line' for j in jobs) else {}
    results = []
    for job in jobs:
        subject,text = _text(org,job)
        error = None
        try:
            if job['channel']=='email':
                with D.control() as cd:
                    _email(cd,job['recipient'],subject,text)
            elif job['channel']=='sms':
                with D.control() as cd:
                    sms.send(cd,job['recipient'],text)
            else:
                T.send_line(line_secret,job['recipient'],text[:4900],str(uuid.UUID(job['id'])))
        except ChannelError as failure:
            error = failure
        except Exception:
            error = ChannelError('unknown',uncertain=True)
        results.append((job,error))
    with D.tenant(tenant_id) as db:
        D.begin(db)
        for job,error in results:
            if not error:
                repository.finish_notice(db,job['id'])
                if job['link_hash']:
                    repository.revoke_older_links(db,job['visitor_id'],job['channel'],job['link_hash'])
            elif error.retryable and job['attempts']+1<MAX_NOTICE_ATTEMPTS:
                repository.fail_notice(db,job['id'],error.code)
                if job['link_hash']:
                    repository.delete_link(db,job['link_hash'])
            else:
                repository.finish_notice(db,job['id'],'unknown' if error.uncertain else error.code)
                if job['link_hash'] and not error.uncertain:
                    repository.delete_link(db,job['link_hash'])
    return sum(1 for _,error in results if not error)


def cleanup(tenant_id, force=False):
    """Browsers unused for 400 days, dead links, expired LINE codes, held addresses whose days are over and the
    addresses of older chats are deleted (at most every 10 minutes)."""
    from backend.modules.guest import blocks
    import time
    moment = time.monotonic()
    if not force and moment-_cleaned.get(tenant_id,-CLEANUP_SECONDS)<CLEANUP_SECONDS:
        return
    _cleaned[tenant_id] = moment
    with D.tenant(tenant_id) as db:
        D.begin(db)
        repository.delete_unused_devices(db,after(days=-DEVICE_UNUSED_DAYS))
        repository.delete_dead_links(db)
        repository.delete_expired_codes(db)
        blocks.cleanup(db)
        db.commit()


# Staff side
def reach(db, contact_ids):
    """{contact_id: {'follow': ['browser','email','sms','line']}} for contacts of guests not merged into an account:
    how the team's reply can reach them."""
    found = {}
    for contact_id,visitors in repository.reach(db,contact_ids).items():
        found[contact_id] = {'follow':[way for way,key in (('browser','browser'),('email','email_verified_at'),('sms','phone_verified_at'),('line','line'))
                                       if any(v[key] for v in visitors)]}
    return found


def forget_contact(db, contact_id):
    """Staff deleted the contact: its guests are deleted too (their browsers and links stop working)."""
    for visitor_id in repository.visitors_of_contact(db,contact_id):
        repository.delete_visitor(db,visitor_id)


# Moving the history into a customer account
def _merge(db, account, visitor):
    """The guest's conversations become the account's (same effect as a claim), inside the caller's transaction;
    returns how many moved."""
    customers.ensure_member(db,account)
    accounts.link_contact(db,account['id'],visitor['contact_id'])
    repository.copy_seen(db,visitor['id'],account['id'])
    repository.set_account(db,visitor['id'],account['id'])
    repository.forget_visitor(db,visitor['id'])
    moved = repository.conversation_count(db,visitor['id'])
    audit.record(db,account['name'],'guest.claimed',visitor['contact_id'],f'{moved} เรื่อง')
    return moved


def claims(cd, cookie_header):
    """GET /api/customer/guest-claims: the organizations whose guest cookie this browser holds, with chats to move."""
    found = []
    for slug,token in guest_cookies(cookie_header).items():
        org = tenants.find_active_by_slug(cd,slug)
        if not org:
            continue
        with D.tenant(org['id']) as db:
            device = repository.device(db,token_hash(token))
            count = repository.conversation_count(db,device['visitor_id']) if device else 0
        if count:
            found.append({'org_slug':org['slug'],'org_name':org['name'],'conversations':count})
    return {'claims':found}


def claim(cd, session, body, cookie_header):
    """POST /api/customer/guest-claims: move the chats of this browser's guest of one organization into the signed-in
    account. Returns (slug, how many moved)."""
    slug = schema.claim_org(body)
    token = guest_cookies(cookie_header).get(slug)
    org = tenants.find_active_by_slug(cd,slug)
    require(token and org,NO_CLAIM,404)
    account = accounts.find(cd,session['account_id'])
    with D.tenant(org['id']) as db:
        D.begin(db)
        device = repository.device(db,token_hash(token))
        require(device,NO_CLAIM,404)
        visitor = repository.visitor(db,device['visitor_id'])
        moved = _merge(db,account,visitor)
        db.commit()
        left = repository.verified_visitors(db,visitor['email']) if visitor['email'] else []
    accounts.join_org(cd,account['id'],org['id'])
    if visitor['email'] and not left:
        repository.unindex_email(cd,visitor['email'],org['id'])
    cd.commit()
    return slug,moved


def merge_verified(cd, account_id):
    """An account with a verified email signed in (or confirmed its email): guests of any organization whose proven
    email is the same move into it. Returns how many conversations moved."""
    account = accounts.find(cd,account_id)
    if not account or not account['email_verified']:
        return 0
    moved = 0
    for tenant_id in repository.tenants_with_email(cd,account['email']):
        if not tenants.find_active(cd,tenant_id):
            continue
        with D.tenant(tenant_id) as db:
            D.begin(db)
            for visitor in repository.verified_visitors(db,account['email']):
                moved += _merge(db,account,visitor)
            db.commit()
        accounts.join_org(cd,account_id,tenant_id)
        repository.unindex_email(cd,account['email'],tenant_id)
    cd.commit()
    return moved


def after_sign_in(cd, token):
    """Called once a customer's session cookie is made: merge guests with the account's verified email. A failure
    here never stops the sign-in (it is tried again at the next one)."""
    try:
        session = accounts.find_session(cd,token_hash(token)) if token else None
        if session:
            merge_verified(cd,session['account_id'])
    except Exception as error:
        cd.rollback()
        print(f'Guest chat merge: {type(error).__name__}; tried again at the next sign-in',flush=True)
