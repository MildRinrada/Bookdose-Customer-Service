/* Notifications: what is waiting for the team right now, built from the cases and the conversations that are
   already loaded. The bell opens the panel; "see all" opens this screen.
   Markup: pages/notifications/, ui/filter-pill.html. */

'use strict';

const notificationKinds={ticket:{label:'เคสบริการ',icon:'ticket'},inbox:{label:'กล่องข้อความ',icon:'inbox'}};

/* One list, newest first. A case that is past its SLA or still unassigned needs someone; a conversation whose
   last message came from the customer is waiting for a reply. */
function notificationItems(){
  const items=[];
  for(const t of state.tickets||[]){
    if(overdue(t))items.push({kind:'ticket',tone:'late',icon:'clock',title:`BD-${t.number} เกินกำหนด SLA`,detail:t.subject,at:t.updated_at,href:`#tickets/${t.id}`});
    else if(t.status==='new'&&!t.assignee_id)items.push({kind:'ticket',tone:'new',icon:'ticket',title:`BD-${t.number} ยังไม่มีผู้รับผิดชอบ`,detail:t.subject,at:t.created_at,href:`#tickets/${t.id}`});
  }
  for(const c of state.conversations||[]){
    if(needsReply(c))items.push({kind:'inbox',tone:'waiting',icon:channelIcons[c.channel]||'chat',title:`${c.contact_name} รอคำตอบ`,detail:c.subject,at:c.updated_at,href:`#inbox/${c.id}`});
  }
  return items.sort((a,b)=>String(b.at).localeCompare(String(a.at)));
}

function notificationCount(){return notificationItems().length;}

function notificationHTML(items){
  return items.map(n=>render('pages/notifications/notification-item',{tone:n.tone,icon:icon(n.icon),title:n.title,detail:n.detail,
    ago:shortAgo(n.at),iso:n.at,full:date(n.at,true),href:n.href})).join('');
}

/* The bell drops its panel down from itself, attached to the button that opened it, so the eye does not have to
   travel and the screen behind stays where it was. It closes on a click anywhere else, on Escape, and on opening
   one of its items. */
function setNotificationMenu(open){
  const button=$('[data-action="notifications"]'),panel=$('#notification-menu');
  if(!button||!panel)return;
  panel.hidden=!open;
  button.setAttribute('aria-expanded',String(open));
}

/* Cases and messages are two tabs, not two stacked lists: whoever came for the messages presses "กล่องข้อความ"
   instead of scrolling past every case first. The tabs are the same pills the rest of the app filters with. */
function notificationMenuHTML(items,loading=false){
  const filter=uiState.notificationMenuFilter||'all';
  const shown=filter==='all'?items:items.filter(n=>n.kind===filter);
  // Only the kinds carry a number, and the head carries the total: 6 + 2 = 8, with nothing to add up twice.
  const tabs=[['all','ทั้งหมด',0],...Object.entries(notificationKinds).map(([kind,meta])=>[kind,meta.label,items.filter(n=>n.kind===kind).length])]
    .map(([key,label,count])=>filterPill('notification-tab',key,label,{pressed:filter===key,count})).join('');
  return render('pages/notifications/notifications-menu',{count:items.length,loading,tabs,
    shown:shown.length,list:notificationHTML(shown),
    empty:render('pages/notifications/notifications-clear',{all:filter==='all'})});
}

function refreshNotificationMenu(){
  const panel=$('#notification-menu');
  if(panel&&!panel.hidden)panel.innerHTML=notificationMenuHTML(notificationItems());
}

async function openNotifications(){
  const panel=$('#notification-menu');
  if(!panel)return;
  if(!panel.hidden)return setNotificationMenu(false);
  setProfileMenu(false);
  panel.innerHTML=notificationMenuHTML(notificationItems(),true);
  setNotificationMenu(true);
  if(state.work)state.conversations=(await api('/api/conversations')).conversations;
  if(panel.hidden)return;
  panel.innerHTML=notificationMenuHTML(notificationItems());
  updateNotificationBadge();
}

function notificationsPage(){
  const items=notificationItems(),filter=uiState.notificationFilter||'all';
  const shown=filter==='all'?items:items.filter(n=>n.kind===filter);
  const tabs=[['all','ทั้งหมด',items.length],...Object.entries(notificationKinds).map(([kind,meta])=>[kind,meta.label,items.filter(n=>n.kind===kind).length])]
    .map(([key,label,count])=>filterPill('notification-filter',key,label,{pressed:filter===key,count})).join('');
  return render('pages/notifications/notifications',{tabs,count:shown.length,
    list:shown.length?render('pages/notifications/notification-group',{label:'รายการทั้งหมด',icon:icon('bell'),count:shown.length,items:notificationHTML(shown)})
      :empty('ยังไม่มีเรื่องรอดูแล','เมื่อมีเคสเกิน SLA หรือบทสนทนารอตอบ จะแสดงที่นี่','checkCircle')});
}

function refreshNotificationsPage(){const list=$('#notification-list');if(list)$('#page').innerHTML=notificationsPage();}

// The bell wears the number of things waiting, so it is worth looking at.
function updateNotificationBadge(){
  const bell=$('[data-action="notifications"]');if(!bell)return;
  const count=notificationCount(),badge=$('.bell-count',bell);
  bell.setAttribute('aria-label',count?`การแจ้งเตือน ${count} รายการ`:'การแจ้งเตือน');
  if(count&&badge)badge.textContent=count>99?'99+':count;
  else if(count)bell.insertAdjacentHTML('beforeend',`<span class="bell-count">${count>99?'99+':count}</span>`);
  else badge?.remove();
}

Object.assign(actions,{
  'notifications':async(button,id)=>{return openNotifications();},
  'notification-filter':async(button,id)=>{uiState.notificationFilter=button.dataset.value;refreshNotificationsPage();return;},
  'notification-tab':async(button,id)=>{uiState.notificationMenuFilter=button.dataset.value;refreshNotificationMenu();$(`[data-action="notification-tab"][data-value="${button.dataset.value}"]`)?.focus();return;},
  // A notification opens exactly the case or the conversation it is about.
  'open-notification':async(button,id)=>{setNotificationMenu(false);location.hash=button.getAttribute('href');return;},
});

// Anywhere outside the bell closes the panel, and so does following one of its links.
document.addEventListener('click',event=>{
  if(!event.target.closest('.bell-menu')||event.target.closest('.note-dropdown a'))setNotificationMenu(false);
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!$('#notification-menu:not([hidden])'))return;
  setNotificationMenu(false);$('[data-action="notifications"]')?.focus();
});
