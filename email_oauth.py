"""OAuth authorization-code + PKCE and token refresh for fixed mail providers.

Tokens and pending verifiers live only in per-tenant 0600 secret files. Callback
completion requires the initiating staff session, tenant and current admin role.
"""
import base64
import hashlib
import json
import secrets
import time
from urllib.parse import urlencode, urlsplit
import urllib.request
import urllib.error
import database as D
import channel_transport as T

PROVIDERS={
 'google':{'authorize':'https://accounts.google.com/o/oauth2/v2/auth','token':'https://oauth2.googleapis.com/token',
           'scope':'https://mail.google.com/','imap_host':'imap.gmail.com','smtp_host':'smtp.gmail.com','smtp_port':465},
 'microsoft':{'authorize':'https://login.microsoftonline.com/common/oauth2/v2.0/authorize','token':'https://login.microsoftonline.com/common/oauth2/v2.0/token',
              'scope':'offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send',
              'imap_host':'outlook.office365.com','smtp_host':'smtp.office365.com','smtp_port':587}}
CALLBACK='/oauth/email/callback'


def configure(cfg,body,secret):
    import channel_service as C
    mode=body.get('auth_mode',cfg.get('auth_mode','password'))
    C.check(mode in ('password',*PROVIDERS),'วิธีเข้าสู่ระบบอีเมลไม่ถูกต้อง')
    old_binding=binding(cfg)
    cfg['auth_mode']=mode
    if mode!='password':
        cfg.update({k:PROVIDERS[mode][k] for k in ('imap_host','smtp_host','smtp_port')})
        cfg['oauth_client_id']=C.text_field(body,'oauth_client_id',cfg.get('oauth_client_id',''),254)
        C.check(bool(cfg['oauth_client_id']),'กรุณาระบุ OAuth Client ID')
        uri=C.text_field(body,'oauth_redirect_uri',cfg.get('oauth_redirect_uri',''),500)
        parsed=urlsplit(uri)
        C.check(parsed.path==CALLBACK and not parsed.query and not parsed.fragment and not parsed.username and not parsed.password and parsed.hostname and
                (parsed.scheme=='https' or parsed.scheme=='http' and parsed.hostname in ('localhost','127.0.0.1')),'Redirect URI ต้องเป็น HTTPS หรือ localhost และลงท้าย /oauth/email/callback')
        cfg['oauth_redirect_uri']=uri
    client_secret=body.get('oauth_client_secret','')
    C.check(isinstance(client_secret,str) and len(client_secret)<=2000 and not any(ord(c)<32 for c in client_secret),'Client Secret ไม่ถูกต้อง')
    if old_binding!=binding(cfg) or client_secret:
        for key in ('oauth_tokens','oauth_pending'):secret.pop(key,None)
    if client_secret:secret['oauth_client_secret']=client_secret


def binding(cfg):return [cfg.get(k,'') for k in ('auth_mode','oauth_client_id','oauth_redirect_uri','username','address')]


def configured(cfg,secret):
    if cfg.get('auth_mode','password')=='password':return bool(secret.get('password'))
    token=secret.get('oauth_tokens',{})
    return bool(secret.get('oauth_client_secret') and token.get('refresh_token') and token.get('binding')==binding(cfg))


def token_request(provider,data):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):return None
    request=urllib.request.Request(PROVIDERS[provider]['token'],data=urlencode(data).encode(),headers={'Content-Type':'application/x-www-form-urlencoded'})
    try:
        with urllib.request.build_opener(NoRedirect).open(request,timeout=15) as response:raw=response.read(100001)
        if len(raw)>100000:raise ValueError()
        result=json.loads(raw)
        if not isinstance(result,dict) or not isinstance(result.get('access_token'),str) or not result['access_token'] or str(result.get('token_type','')).lower()!='bearer':raise ValueError()
        if any(ord(c)<32 for c in result['access_token']):raise ValueError()
        result['expires_at']=time.time()+max(0,min(86400,int(result.get('expires_in',3600))))
        return result
    except urllib.error.HTTPError as error:
        status=error.code;error.close()
        raise T.ChannelError('oauth_expired' if status in (400,401,403) else 'network',retryable=status>=500 or status==429) from None
    except (ValueError,TypeError,KeyError):raise T.ChannelError('oauth_expired') from None
    except (OSError,urllib.error.URLError):raise T.ChannelError('network',retryable=True) from None


def start(db,ctx,origin):
    import channel_service as C
    row=C.setting(db,'email');C.check(row and row['config'].get('auth_mode') in PROVIDERS,'บันทึกการตั้งค่า OAuth ก่อนเชื่อมบัญชี')
    cfg=row['config'];secret=C.read_secret(ctx['tenant_id'],'email')
    C.check(bool(secret.get('oauth_client_secret')),'กรุณาบันทึก OAuth Client Secret ก่อน')
    parsed=urlsplit(cfg['oauth_redirect_uri'])
    C.check(parsed.netloc==urlsplit(origin).netloc,'เปิดโปรแกรมผ่านโดเมนและพอร์ตเดียวกับ Redirect URI ก่อนเชื่อมบัญชี')
    state=secrets.token_urlsafe(32);verifier=secrets.token_urlsafe(64)
    pending={'state_hash':D.token_hash(state),'verifier':verifier,'session':ctx['session_token'],'user':ctx['id'],
             'generation':row['generation'],'expires_at':time.time()+600}
    secret['oauth_pending']=pending;C.write_secret(ctx['tenant_id'],'email',secret)
    query={'client_id':cfg['oauth_client_id'],'redirect_uri':cfg['oauth_redirect_uri'],'response_type':'code','scope':PROVIDERS[cfg['auth_mode']]['scope'],
           'state':state,'code_challenge':base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('='),'code_challenge_method':'S256',
           'login_hint':cfg['username']}
    if cfg['auth_mode']=='google':query.update(access_type='offline',prompt='consent')
    else:query.update(response_mode='query',prompt='select_account')
    D.audit(db,ctx['name'],'email.oauth_started',row['route_id']);db.commit()
    return {'url':PROVIDERS[cfg['auth_mode']]['authorize']+'?'+urlencode(query)}


def complete(cd,db,ctx,body):
    import channel_service as C
    state=body.get('state','');code=body.get('code','')
    C.check(isinstance(state,str) and 20<=len(state)<=200 and isinstance(code,str) and 1<=len(code)<=10000,'OAuth callback ไม่ถูกต้อง')
    db.execute('BEGIN IMMEDIATE')
    row=C.setting(db,'email');secret=C.read_secret(ctx['tenant_id'],'email');pending=secret.get('oauth_pending',{})
    C.check(row and pending.get('state_hash')==D.token_hash(state) and pending.get('session')==ctx['session_token'] and pending.get('user')==ctx['id'] and
            pending.get('generation')==row['generation'] and pending.get('expires_at',0)>time.time(),'คำขอ OAuth หมดอายุ หรือไม่ตรงเซสชัน/องค์กร กรุณาเชื่อมบัญชีใหม่')
    secret.pop('oauth_pending',None);C.write_secret(ctx['tenant_id'],'email',secret);db.commit()
    cfg=row['config'];provider=cfg['auth_mode']
    result=token_request(provider,{'grant_type':'authorization_code','client_id':cfg['oauth_client_id'],'client_secret':secret['oauth_client_secret'],
                                 'code':code,'redirect_uri':cfg['oauth_redirect_uri'],'code_verifier':pending['verifier']})
    C.check(isinstance(result.get('refresh_token'),str) and result['refresh_token'],'ไม่ได้รับ Refresh Token กรุณาอนุญาตการเข้าถึงแบบออฟไลน์อีกครั้ง')
    # IMAP authentication proves the token can access the configured mailbox; SMTP validates sending auth.
    T.verify_email(cfg,{'auth_token':result['access_token']})
    cd.execute('BEGIN IMMEDIATE');db.execute('BEGIN IMMEDIATE')
    current=C.setting(db,'email')
    member=D.one(cd,"SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id JOIN sessions s ON s.user_id=m.user_id WHERE m.tenant_id=? AND m.user_id=? AND m.role='admin' AND m.active=1 AND t.status='active' AND s.token=? AND s.expires_at>?",(ctx['tenant_id'],ctx['id'],ctx['session_token'],D.now()))
    C.check(member and current['generation']==row['generation'],'สิทธิ์หรือการตั้งค่าเปลี่ยนระหว่างเชื่อมบัญชี กรุณาเริ่มใหม่')
    latest=C.read_secret(ctx['tenant_id'],'email')
    latest['oauth_tokens']={'access_token':result['access_token'],'refresh_token':result['refresh_token'],'expires_at':result['expires_at'],'binding':binding(cfg)}
    C.write_secret(ctx['tenant_id'],'email',latest)
    D.audit(db,ctx['name'],'email.oauth_connected',row['route_id']);db.commit();cd.commit()
    return {'ok':True}


def access_secret(tenant_id,cfg,secret=None):
    import channel_service as C
    secret=secret if secret is not None else C.read_secret(tenant_id,'email')
    if cfg.get('auth_mode','password')=='password':return secret
    if not configured(cfg,secret):raise T.ChannelError('oauth_expired')
    token=secret['oauth_tokens']
    if token.get('expires_at',0)>time.time()+60:return {'auth_token':token['access_token']}
    # Short lease coordinates refreshes across workers/processes without holding a DB lock during HTTPS.
    lease=D.uid()
    with D.tenant(tenant_id) as db:
        db.execute('BEGIN IMMEDIATE')
        row=C.setting(db,'email')
        if not row or binding(row['config'])!=binding(cfg):raise T.ChannelError('changed')
        lock=D.one(db,"SELECT * FROM oauth_refresh WHERE kind='email'")
        if lock and lock['expires_at']>time.time():raise T.ChannelError('network',retryable=True)
        db.execute("INSERT OR REPLACE INTO oauth_refresh VALUES('email',?,?)",(lease,time.time()+60))
        generation=row['generation']
    try:
        result=token_request(cfg['auth_mode'],{'grant_type':'refresh_token','client_id':cfg['oauth_client_id'],'client_secret':secret['oauth_client_secret'],'refresh_token':token['refresh_token']})
        with D.tenant(tenant_id) as db:
            db.execute('BEGIN IMMEDIATE');current=C.setting(db,'email');latest=C.read_secret(tenant_id,'email')
            lock=D.one(db,"SELECT * FROM oauth_refresh WHERE kind='email'")
            if not lock or lock['lease']!=lease or current['generation']!=generation or latest.get('oauth_tokens',{}).get('refresh_token')!=token['refresh_token']:
                raise T.ChannelError('changed')
            latest['oauth_tokens']={**token,'access_token':result['access_token'],'refresh_token':result.get('refresh_token') or token['refresh_token'],'expires_at':result['expires_at']}
            C.write_secret(tenant_id,'email',latest)
        return {'auth_token':result['access_token']}
    finally:
        with D.tenant(tenant_id) as db:db.execute("DELETE FROM oauth_refresh WHERE kind='email' AND lease=?",(lease,))
