/* LINE, Email and Facebook Messenger: delivery status under messages, the settings panels (with Email OAuth)
   and their actions. Markup: modules/channels/*.html. */

'use strict';
const channelNames={web:'Web Support',line:'LINE',email:'Email',facebook:'Facebook',manual:'บันทึกเอง'};
const deliveryNames={queued:'รอส่ง',sending:'กำลังส่ง',accepted:'บริการปลายทางรับข้อความแล้ว',failed:'ส่งไม่สำเร็จ',unknown:'ไม่ทราบผลการส่ง'};

function channelDeliveryHTML(m){
  const delivery=m.channel_delivery;
  return render('modules/channels/channel-delivery',{tracked:!!delivery,id:m.id,label:deliveryNames[m.delivery]||m.delivery,accepted:m.delivery==='accepted',
    error:delivery?.error,hasFileLinks:delivery?.has_file_links,retryable:delivery?.retryable});
}
function channelSummaryHTML(){
  const fb=state.facebookSettings;
  return (state.channelSettings||[]).map(c=>render('modules/channels/channel-summary-row',{icon:icon(c.kind==='line'?'chat':'mail'),name:channelNames[c.kind],
    account:c.config.display_name||c.config.address||'ตั้งค่าบัญชีด้านล่าง',live:c.enabled&&c.credentials_configured})).join('')
    +(fb?render('modules/channels/channel-summary-row',{icon:icon('facebook'),name:'Facebook Messenger',account:fb.config.page_name||'ตั้งค่าเพจด้านล่าง',live:fb.enabled&&fb.credentials_configured}):'');
}

function facebookSettingsPanel(){
  const c=state.facebookSettings;if(!c)return '';
  const v=c.config,field=(name,label)=>render('modules/channels/channel-field',{kind:'facebook',name,label,type:'password',value:'',required:false,max:2000,autocomplete:'new-password',secret:true});
  return render('modules/channels/facebook-settings',{configured:c.credentials_configured,enabled:c.enabled,pageName:v.page_name,pageId:v.page_id,
    tokenField:field('page_access_token','Page Access Token'),secretField:field('app_secret','App Secret (Meta App)'),teamOptions:teamOptions(v.team_id),
    webhookURL:c.route_id?`${location.origin}/api/webhooks/facebook/${c.route_id}`:'',verifyToken:v.verify_token,lastError:c.last_error,
    lastChecked:c.last_checked?date(c.last_checked,true):'-',lastReceived:c.last_received?date(c.last_received,true):'-',
    outbox:c.outbox.map(o=>render('modules/channels/outbox-badge',{label:deliveryNames[o.status]||o.status,count:o.count})).join('')});
}

Object.assign(actions,{
  'facebook-test':async(button,id)=>{await api('/api/channels/facebook/test',{});toast('เชื่อมต่อเพจสำเร็จ (ยังไม่ได้ส่งข้อความจริง)');await route();},
  'facebook-copy':async(button,id)=>{await copyText(button.dataset.value);},
});

Object.assign(forms,{
  'facebook-settings':async(form,data)=>{
    data.enabled=form.elements.enabled.checked;data.remove_credentials=form.elements.remove_credentials.checked;
    await api('/api/channels/facebook',data,'PATCH');toast('บันทึก Facebook Messenger แล้ว');await route();
  },
});
function channelSettingsPanel(){return state.channelSettings.map(c=>{
  const k=c.kind,v=c.config;
  const field=(name,label,type='text',value='',required=false)=>render('modules/channels/channel-field',{kind:k,name,label,type,value,required,max:type==='password'?2000:254,autocomplete:type==='password'?'new-password':'off',secret:type==='password'});
  const fields=k==='line'?{
    channelSecretField:field('channel_secret','Channel Secret','password'),accessTokenField:field('access_token','Channel Access Token','password'),
    publicBaseURLField:field('public_base_url','โดเมน HTTPS สำหรับส่งไฟล์','url',v.public_base_url||''),groupsEnabled:v.groups_enabled,groupChatbotEnabled:v.group_chatbot_enabled}:{
    oauthFields:emailOAuthFields(c,field),addressField:field('address','อีเมลรับเรื่อง','email',v.address||'',true),usernameField:field('username','ชื่อผู้ใช้ IMAP / SMTP','text',v.username||''),
    passwordField:field('password','รหัสผ่าน / App Password','password'),imapHostField:field('imap_host','เซิร์ฟเวอร์ IMAP','text',v.imap_host||'',true),
    smtpHostField:field('smtp_host','เซิร์ฟเวอร์ SMTP','text',v.smtp_host||'',true),smtpPortOptions:options({465:'465 · TLS',587:'587 · STARTTLS'},String(v.smtp_port||465)),pollSeconds:v.poll_seconds||60};
  return render('modules/channels/channel-settings',{kind:k,name:channelNames[k],configured:c.credentials_configured,line:k==='line',email:k==='email',...fields,
    teamOptions:teamOptions(v.team_id),enabled:c.enabled,chatbotEnabled:v.chatbot_enabled,
    webhookURL:k==='line'&&c.route_id?location.origin+'/api/webhooks/line/'+c.route_id:'',routeId:c.route_id,lastError:c.last_error,
    lastChecked:c.last_checked?date(c.last_checked,true):'-',lastReceived:c.last_received?date(c.last_received,true):'-',
    outbox:c.outbox.map(o=>render('modules/channels/outbox-badge',{label:deliveryNames[o.status]||o.status,count:o.count})).join('')});
}).join('');}
async function channelHandleForm(form){
  const data=Object.fromEntries(new FormData(form));
  for(const key of ['chatbot_enabled','groups_enabled','group_chatbot_enabled'])if(form.elements[key])data[key]=form.elements[key].checked;
  data.enabled=form.elements.enabled.checked;data.remove_credentials=form.elements.remove_credentials.checked;
  if(form.dataset.kind==='email'){data.smtp_port=Number(data.smtp_port);data.poll_seconds=Number(data.poll_seconds);}
  await api('/api/channels/'+form.dataset.kind,data,'PATCH');toast('บันทึกช่องทางแล้ว');await route();
}
async function channelAction(button){
  const k=button.dataset.kind;
  if(button.dataset.action==='channel-oauth'){const result=await api('/api/channels/email/oauth/start',{});location.assign(result.url);return;}
  if(button.dataset.action==='channel-revoke-files'){await api('/api/messages/'+button.dataset.id+'/revoke-files',{});await pollStaffMessages();toast('ถอนลิงก์ไฟล์แล้ว');return;}
  if(button.dataset.action==='channel-copy'){await navigator.clipboard.writeText(location.origin+'/api/webhooks/line/'+button.dataset.route);toast('คัดลอก Webhook URL แล้ว');return;}
  if(button.dataset.action==='channel-retry'){await api('/api/messages/'+button.dataset.id+'/retry',{});await pollStaffMessages();toast('นำข้อความกลับเข้าคิวแล้ว');return;}
  await api('/api/channels/'+k+'/'+(button.dataset.action==='channel-test'?'test':'sync'),{});
  toast(button.dataset.action==='channel-test'?'เชื่อมต่อบัญชีสำเร็จ':'กำหนดให้ตรวจอีเมลรอบถัดไปแล้ว');await route();
}
function emailOAuthFields(c,field){
  const v=c.config;
  return render('modules/channels/email-oauth-fields',{authModeOptions:options({password:'รหัสผ่าน / App Password',google:'Google Workspace / Gmail OAuth',microsoft:'Microsoft 365 / Outlook OAuth'},v.auth_mode||'password'),
    clientIdField:field('oauth_client_id','OAuth Client ID','text',v.oauth_client_id||''),clientSecretField:field('oauth_client_secret','OAuth Client Secret','password'),
    redirectURIField:field('oauth_redirect_uri','OAuth Redirect URI','url',v.oauth_redirect_uri||location.origin+'/oauth/email/callback'),
    canConnect:v.auth_mode&&v.auth_mode!=='password'&&c.oauth_client_configured,configured:c.credentials_configured});
}
document.addEventListener('change',event=>{
  const form=event.target.closest('form[data-channel="line"]');
  if(form&&event.target.name==='kind')form.elements.body.maxLength=form.elements.kind.value==='reply'?5000:20000;
  if(event.target.id==='email-auth_mode'){
    const form=event.target.form,provider=event.target.value;
    if(provider!=='password'){
      form.elements.imap_host.value=provider==='google'?'imap.gmail.com':'outlook.office365.com';
      form.elements.smtp_host.value=provider==='google'?'smtp.gmail.com':'smtp.office365.com';
      form.elements.smtp_port.value=provider==='google'?'465':'587';
      form.elements.enabled.checked=false;
    }
  }
});
