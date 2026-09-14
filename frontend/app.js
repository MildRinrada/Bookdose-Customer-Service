/* Entry point: hash router, the action/form dispatchers, global listeners and boot. */

'use strict';

/* Opening a screen takes one round of requests, not one request after another: the session, the workspace,
   the case list and the screen's own data all go out together. Screens whose access depends on the role
   (settings, audit, platform) are fetched once the role is known. */
function pageRequest(page,id){
  if(page==='dashboard')return api(dashboardPath());
  if(page==='automation')return api('/api/automation');
  if(page==='tickets'&&id)return api(`/api/tickets/${id}`);
  if(page==='inbox')return Promise.all([api('/api/conversations'),id?api(`/api/conversations/${id}`):null]);
  if(page==='contacts')return api('/api/contacts');
  if(page==='notifications')return api('/api/conversations');
  if(page==='knowledge')return api('/api/articles');
  return null;
}

// Screens that read the case list. The others keep the list already in memory (the sidebar count comes from it).
const CASE_LIST_SCREENS=['dashboard','tickets','contacts','reports','inbox','notifications',''];

function startRequests(page,id,warm){
  const requests={boot:api('/api/bootstrap')};
  if(warm){
    requests.work=api('/api/workspace');
    requests.alerts=api('/api/automation/alerts');
    if(CASE_LIST_SCREENS.includes(page)||!state.tickets.length)requests.cases=api('/api/tickets');
    requests.data=pageRequest(page,id);
  }
  // Failures are reported where the screen awaits the request; this only keeps them from being "unhandled".
  for(const request of Object.values(requests))request?.catch(()=>{});
  return requests;
}

/* Moving between screens behaves like a normal page change: a new screen opens at the top and Back returns
   to where the reader was. Positions are kept per screen; the entry itself remembers which screen it showed. */
const scrollByView=new Map();
try{history.scrollRestoration='manual';}catch{/* Not supported: the browser keeps its own behaviour. */}

function keepScroll(){if(state.viewKey)scrollByView.set(state.viewKey,window.scrollY);}

function restoreScroll(key){
  window.scrollTo(0,history.state?.viewKey===key?scrollByView.get(key)||0:0);
  history.replaceState({viewKey:key},'');
  state.viewKey=key;
}

async function route(){
  clearInterval(pollTimer);
  keepScroll();
  const epoch=++state.epoch;
  const [path,search='']=(location.hash.slice(1)||'dashboard').split('?');
  const [page,id]=path.split('/');state.route=page;state.detail=null;
  // A warm start (the session is already known) sends every request for the next screen at once. If the session
  // or the organization turns out to have changed meanwhile, the screen is opened again the careful way.
  const known=state.boot,warm=Boolean(known?.user&&!state.coldStart&&page!=='knowledge');
  state.coldStart=false;
  const requests=startRequests(page,id,warm);
  try{
    state.boot=await requests.boot;
    if(epoch!==state.epoch)return;
    if(warm&&(!state.boot.user||state.boot.tenant_id!==known.tenant_id)){state.coldStart=true;return route();}
    // Signed-out screens replace the whole app, so they start at the top like any other page change.
    if(['verify-email','check-email','resend-email'].includes(page)){state.viewKey='';window.scrollTo(0,0);return verificationPage(page,search);}
    if(!state.boot.user){
      state.viewKey='';window.scrollTo(0,0);
      if(page==='register'&&state.boot.setup_required){
        $('#app').innerHTML=render('pages/auth/registration-closed',{brand:brand(),message:'เจ้าของระบบต้องตั้งค่าครั้งแรกก่อน จึงจะสมัครองค์กรใหม่ได้',linkLabel:'กลับหน้าหลัก'});
        return;
      }
      if(page==='register'&&!state.boot.registration_available){
        $('#app').innerHTML=render('pages/auth/registration-closed',{brand:brand(),message:'กรุณาติดต่อ Bookdose เพื่อเปิดใช้งานอีเมลยืนยันการสมัคร',linkLabel:'กลับหน้าเข้าสู่ระบบ'});
        return;
      }
      return authPage(state.boot.setup_required,page==='register');
    }
    const linkedTenant=page==='knowledge'?new URLSearchParams(search).get('tenant'):null;
    if(linkedTenant&&linkedTenant!==state.boot.tenant_id){
      if(!state.boot.memberships.some(m=>m.id===linkedTenant&&m.status==='active'))throw new Error('ไม่มีสิทธิ์เข้าถึงองค์กรของบทความนี้');
      await api('/api/session/tenant',{tenant_id:linkedTenant});state.boot=await api('/api/bootstrap');
    }
    resetViewStateForTenant();
    const membership=state.boot.memberships.find(m=>m.id===state.boot.tenant_id&&m.status==='active');
    let pageData=requests.data;
    if(membership){
      if(!pageData){pageData=pageRequest(page,id);pageData?.catch(()=>{/* Reported where the screen awaits it. */});}
      try{
        const [work,cases,alerts]=await Promise.all([requests.work??api('/api/workspace'),requests.cases??(state.tickets.length?null:api('/api/tickets')),
          requests.alerts??api('/api/automation/alerts')]);
        state.work=work;state.alerts=alerts;if(cases)state.tickets=cases.tickets;
      }catch(error){if(!warm)throw error;state.coldStart=true;return route();}
    }else{state.work=null;state.tickets=[];state.alerts=null;}
    if(epoch!==state.epoch)return;
    let content;
    if(page==='platform'&&state.boot.user.platform_admin){content=platformPage(await api('/api/platform/tenants'))+registrationSettingsPanel(await api('/api/platform/registration'));}
    else if(!state.work){content=empty('ไม่มีพื้นที่ทำงานที่ใช้งานอยู่','เลือกองค์กรอื่นจากเมนู หรือติดต่อผู้ดูแลองค์กรเพื่อเปิดใช้งานอีกครั้ง','lock',state.boot.user.platform_admin?render('pages/platform/platform-admin-link'):'');}
    else if(page==='tickets'&&id){state.detail=await pageData;content=ticketDetail(state.detail);}
    else if(page==='tickets'){state.filter=Object.fromEntries(new URLSearchParams(search));content=ticketsPage();}
    else if(page==='inbox'){
      const [list,opened]=await pageData;
      state.conversations=list.conversations;
      // Narrow screens show the list first; wider screens open a conversation from the current tab beside it.
      const selected=id||(inboxSinglePane()?null:(state.conversations.find(c=>inboxMatches(c))||state.conversations[0])?.id);
      // Put the default conversation in the URL so clicking it again doesn't re-render and wipe a draft.
      if(!id&&selected)history.replaceState(null,'',`#inbox/${selected}`);
      state.detail=id?opened:(selected?await api(`/api/conversations/${selected}`):null);
      content=inboxPage(state.detail);
    }else if(page==='contacts'){state.contacts=(await pageData).contacts;content=contactsPage();}
    else if(page==='knowledge'){state.articles=(await pageData).articles;content=knowledgePage();}
    else if(page==='notifications'){state.conversations=(await pageData).conversations;content=notificationsPage();}
    else if(page==='reports'){content=reportsPage();}
    else if(page==='settings'&&state.work.role==='admin'){[state.aiSettings,state.channelSettings,state.facebookSettings]=await Promise.all([api('/api/ai/settings'),api('/api/channels'),api('/api/channels/facebook')]);content=settingsPage();}
    else if(page==='automation'&&state.work.role!=='agent'){content=automationPage(await pageData);}
    else if(page==='audit'&&state.work.role!=='agent'){content=auditPage((await api('/api/audit')).events);}
    else if(page==='trash'&&state.work.role!=='agent'){content=trashPage(await api('/api/trash'));}
    else{
      // The overview's own data (reminders, mentions, manager view); without it the rest of the overview still opens.
      state.route='dashboard';
      state.dash=await (page==='dashboard'&&pageData?pageData:api(dashboardPath())).catch(()=>null);
      if(state.dash)state.alerts=state.dash.me;
      content=dashboard();
    }
    if(epoch!==state.epoch)return;
    shell(content);state.lastHash=location.hash;if(page==='knowledge'&&id)openArticle(id);document.title=`${pageLabels[state.route]||'Bookdose'} · Bookdose`;
    markMentionsSeen();
    $$('input[name$="_hours"]').forEach(n=>{n.min='0.25';n.max='8760';n.step='0.25';});
    initRichFields();
    restoreScroll(`${state.route}/${id||''}`);
    scrollThreadsToEnd();$('.inbox-item.selected')?.scrollIntoView({block:'nearest'});
    if(state.detail||state.route==='inbox')pollTimer=setInterval(pollStaffMessages,12000);
    else if(state.route==='dashboard')pollTimer=setInterval(refreshDashboard,30000);
  }catch(error){if(epoch!==state.epoch)return;const content=empty('เปิดพื้นที่ทำงานไม่สำเร็จ',error.message,'lock',render('ui/retry-actions'));if(state.boot?.user)shell(content);else $('#app').innerHTML=content;}
}

/* Opening the conversation (or the case holding it) where someone @mentioned you counts as reading the mention. */
function markMentionsSeen(){
  const open=state.route==='inbox'&&state.detail?.conversation?[state.detail.conversation.id]
    :state.route==='tickets'&&state.detail?.conversations?state.detail.conversations.map(c=>c.id):[];
  const seen=[...new Set((state.alerts?.mentions||[]).filter(m=>open.includes(m.conversation_id)).map(m=>m.conversation_id))];
  if(!seen.length)return;
  state.alerts.mentions=state.alerts.mentions.filter(m=>!seen.includes(m.conversation_id));
  updateNotificationBadge();
  seen.forEach(id=>api('/api/mentions/read',{conversation_id:id}).catch(()=>{}));
}

function resetViewStateForTenant(){if(uiState.tenantId!==state.boot.tenant_id){uiState.tenantId=state.boot.tenant_id;uiState.selected.clear();uiState.report={};uiState.category='';uiState.visibility='';uiState.articleQuery='';}}

Object.assign(actions,{
  'refresh':async(button,id)=>{return state.portal?initPortal():route();},
});

async function action(button){
  const name=button.dataset.action,handler=actions[name];
  if(handler)return handler(button,button.dataset.id);
  if(name.startsWith('channel-'))return channelAction(button);
  if(name.startsWith('ai-'))return aiAction(button);
}
async function handleForm(form){
  const kind=form.dataset.form,data=Object.fromEntries(new FormData(form)),handler=forms[kind];
  if(handler)return handler(form,data);
  if(await registrationForm(form,data))return;
  if(kind==='channel-settings')return channelHandleForm(form);
  if(kind==='ai-settings')return aiHandleForm(form);
}

document.addEventListener('submit',async event=>{
  const form=event.target;
  if(form.id==='global-search'){event.preventDefault();location.hash=`tickets?q=${encodeURIComponent(new FormData(form).get('q'))}`;return;}
  if(!form.dataset.form)return;
  event.preventDefault();if(form.dataset.busy)return;form.dataset.busy='1';
  $$('.error-message',form).forEach(n=>n.remove());
  const buttons=$$('button[type="submit"],button:not([type])',form);buttons.forEach(n=>n.disabled=true);
  try{await handleForm(form);}catch(error){const node=document.createElement('div');node.className='error-message';node.setAttribute('role','alert');node.textContent=error.message;form.prepend(node);node.scrollIntoView({block:'nearest'});}
  finally{buttons.forEach(n=>n.disabled=false);delete form.dataset.busy;}
});

document.addEventListener('click',async event=>{const button=event.target.closest('[data-action]');if(button){event.preventDefault();try{await action(button);}catch(error){toast(error.message,true);}}if(event.target.closest('#modal a[href^="#"]'))closeModal();});

window.addEventListener('hashchange',()=>{if(!location.pathname.startsWith('/support/')){if(closeModal())route();else history.replaceState(null,'',state.lastHash||'#knowledge');}else{const token=new URLSearchParams(location.hash.slice(1)).get('case');if(token!==state.portal?.token)initPortal();}});

// Screens are built from HTML templates, so load them before the first render.
loadTemplates().then(()=>{if(location.pathname.startsWith('/support/'))initPortal();else route();}).catch(error=>{$('#app').textContent=error.message;});
