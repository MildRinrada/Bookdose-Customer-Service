/* App frame around every staff screen: sidebar (collapsible), top bar, workspace switch and the account menu.
   Markup: shell/. */

'use strict';

try{if(localStorage.getItem('bookdose.sidebar')==='collapsed')document.documentElement.classList.add('sidebar-collapsed');}catch{/* Storage may be disabled. */}

// The frame (sidebar, top bar) only changes when the account or the workspace changes. While it stays the same,
// a page switch replaces just <main id="page">: less DOM work per click, and the search box, the text-size menu
// and the sidebar scroll position survive the switch.
let shellSignature='';

function shell(content){
  const w=state.work,b=state.boot;
  // Platform mode swaps the organization switch, search and alerts for a banner: nothing on screen belongs to one organization.
  document.documentElement.classList.toggle('platform-mode',state.route==='platform'&&Boolean(b.user.platform_admin));
  const signature=[b.tenant_id,b.user.id,b.user.name,b.avatar||'',b.user.platform_admin,w?.role||'',w?.tenant.name||'',w?.tenant.slug||'',
    b.memberships.filter(m=>m.status==='active').map(m=>m.id+m.name).join(',')].join('|');
  const page=$('#page');
  if(page&&signature===shellSignature){updateShellChrome();page.innerHTML=content;return;}
  shellSignature=signature;
  buildShell(content);
}

// Nav highlight, open-case count and breadcrumb: the only parts of the frame a page switch touches.
function updateShellChrome(){
  const openCases=state.tickets.filter(t=>!isDone(t)).length;
  // A page change closes whatever was open on top of the frame, the way leaving a page always did.
  setProfileMenu(false);
  setNotificationMenu(false);
  const textSize=$('.text-size-panel');
  if(textSize&&!textSize.hidden){textSize.hidden=true;$('.text-size-toggle')?.setAttribute('aria-expanded','false');}
  $$('.sidebar .nav-item').forEach(item=>{
    const key=item.getAttribute('href')?.slice(1)||'';
    item.classList.toggle('active',key===state.route);
    if(key==='tickets'){
      const badge=$('.nav-count',item);
      if(openCases&&badge)badge.textContent=openCases;
      else if(openCases)item.insertAdjacentHTML('beforeend',`<span class="nav-count">${openCases}</span>`);
      else badge?.remove();
    }
  });
  const crumb=$('.breadcrumb b');if(crumb)crumb.textContent=pageLabels[state.route]||'เคสบริการ';
  const root=$('.crumb-root'),{label,href}=crumbRoot();if(root){root.textContent=label;root.setAttribute('href',href);}
  updateNotificationBadge();
}

function buildShell(content){
  const w=state.work,b=state.boot,route=state.route,openCases=state.tickets.filter(t=>!isDone(t)).length;
  const nav=(key,symbol)=>render('shell/nav-item',{key,label:pageLabels[key],icon:icon(symbol),active:route===key,count:key==='tickets'?openCases:0});
  $('#app').innerHTML=render('shell/app-shell',{
    brand:brand(),sidebarToggle:sidebarToggleButton(),workspaceAvatar:avatar(w?.tenant.name||'B'),
    workspaceOptions:b.memberships.filter(m=>m.status==='active').map(m=>option(m.id,m.name,m.id===b.tenant_id)).join(''),
    workspaceNav:w?nav('dashboard','dashboard')+nav('inbox','inbox')+nav('tickets','ticket')+nav('contacts','users')+nav('knowledge','book')+nav('reports','chart'):'',
    // Organization tools and platform tools are separate sections: they act on different scopes.
    manageNav:(w&&w.role!=='agent'?nav('audit','shield')+nav('trash','trash'):'')+(w?.role==='admin'?nav('settings','settings'):''),
    platformNav:b.user.platform_admin?nav('platform','globe'):'',
    tenantSlug:w?.tenant.slug||'',profilePhoto:userAvatar(),userName:b.user.name,roleLabel:w?roleLabels[w.role]:'ผู้ดูแลแพลตฟอร์ม',
    crumbLabel:crumbRoot().label,crumbHref:crumbRoot().href,
    pageLabel:pageLabels[route]||'เคสบริการ',searchShortcut,alerts:notificationCount(),content});
}

// The first breadcrumb names the level being worked on: the whole platform, or the selected organization.
function crumbRoot(){
  if(state.route==='platform')return {label:'แพลตฟอร์ม (ทุกองค์กร)',href:'#platform'};
  return {label:state.work?.tenant.name||'พื้นที่ทำงาน',href:'#dashboard'};
}

async function switchTenant(tenantId){
  await api('/api/session/tenant',{tenant_id:tenantId});
  if(location.hash==='#dashboard')await route();else location.hash='dashboard';
}

const searchShortcut=/Mac|iPhone|iPad/.test(navigator.platform)?'⌘K':'Ctrl K';

function sidebarToggleButton(){const collapsed=document.documentElement.classList.contains('sidebar-collapsed');return render('shell/sidebar-toggle',{expanded:!collapsed,label:collapsed?'ขยายเมนู':'ยุบเมนู'});}

function setProfileMenu(open){const button=$('[data-action="profile-menu"]'),panel=$('#profile-menu');if(!button||!panel)return;panel.hidden=!open;button.setAttribute('aria-expanded',String(open));}

Object.assign(actions,{
  'profile-menu':async(button,id)=>{setProfileMenu(button.getAttribute('aria-expanded')!=='true');return;},
  'toggle-menu':async(button,id)=>{$('.sidebar')?.classList.toggle('mobile-open');$('.mobile-overlay')?.classList.toggle('visible');return;},
  'toggle-sidebar':async(button,id)=>{const collapsed=document.documentElement.classList.toggle('sidebar-collapsed');try{localStorage.setItem('bookdose.sidebar',collapsed?'collapsed':'');}catch{/* Still works for this page. */}button.outerHTML=sidebarToggleButton();document.querySelector('.sidebar-collapse')?.focus();return;},
  'account':async(button,id)=>{modal('จัดการบัญชี',render('shell/account',{photoPicker:photoPicker(),nameField:inputField('ชื่อที่แสดง','name',{value:state.boot.user.name,max:100}),currentPasswordField:inputField('รหัสผ่านเดิม','current_password',{type:'password',max:200}),newPasswordField:inputField('รหัสผ่านใหม่','password',{type:'password',max:200})}));return;},
  'logout':async(button,id)=>{await api('/api/logout',{});closeModal();state.boot=null;return route();},
});

Object.assign(forms,{
  'account-password':async(form,data)=>{await api('/api/account/password',data);closeModal();await route();toast('เปลี่ยนรหัสผ่านและออกจากเซสชันอื่นแล้ว');return;},
  // The picture was already cropped in the dialog; the form carries the finished square.
  'profile':async(form,data)=>{await api('/api/account/profile',{name:data.name,avatar:data.avatar||''});closeModal(true);await route();toast('บันทึกโปรไฟล์แล้ว');return;},
});

document.addEventListener('change',async event=>{const n=event.target;
  try{if(n.id==='tenant-switch')await switchTenant(n.value);}
  catch(error){toast(error.message,true);}
});

// The profile menu closes on any click outside it or on one of its items.
document.addEventListener('click',event=>{if(!event.target.closest('.profile-menu')||event.target.closest('.menu-item'))setProfileMenu(false);});

// Ctrl+K / ⌘K jumps to case search (by key position, so it also works with a Thai keyboard layout).
document.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.code==='KeyK'){const input=$('#global-search input');if(input&&!$('#modal').open){event.preventDefault();input.focus();input.select();}}
  else if(event.key==='Escape'&&$('#profile-menu:not([hidden])')){setProfileMenu(false);$('[data-action="profile-menu"]').focus();}
});
