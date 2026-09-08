'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  inbox:'M4 4h16v16H4z M4 13h4l2 3h4l2-3h4',
  ticket:'M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4z M15 6v3 M15 12v1 M15 16v2',
  users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  book:'M12 5C8 2 4 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-3-1-6-2-10 1z M12 5v16',
  chart:'M3 3v18h18 M7 16v-4 M12 16V8 M17 16V5',
  settings:'M9 3h6l1 3 3 1 2 5-2 4-3 1-1 4H9l-1-4-3-1-2-4 2-5 3-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  shield:'M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z M8 12l3 3 5-6',
  search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  plus:'M12 5v14 M5 12h14', clock:'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  check:'M5 12l4 4L19 6', checkCircle:'M9 12l2 2 4-4 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  arrow:'M5 12h14 M14 7l5 5-5 5', back:'M19 12H5 M10 7l-5 5 5 5', down:'M6 9l6 6 6-6',
  external:'M14 3h7v7 M10 14L21 3 M10 3H3v18h18v-7', download:'M12 3v12 M7 10l5 5 5-5 M3 16v5h18v-5',
  logout:'M9 5H3v14h6 M10 12h11 M17 8l4 4-4 4', close:'M6 6l12 12 M6 18L18 6',
  send:'M22 2L9 15 M22 2l-7 20-6-7-7-6z', paperclip:'M21 11l-9 9a6 6 0 0 1-8-8L14 2a4 4 0 0 1 6 6L10 18a2 2 0 0 1-3-3l9-9',
  globe:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M2 12h20 M12 2c6 6 6 14 0 20-6-6-6-14 0-20',
  mail:'M3 5h18v14H3z M3 5l9 8 9-8', chat:'M21 11a9 9 0 0 1-9 9H3l1-5a9 9 0 1 1 17-4 M8 10h8 M8 14h5',
  sparkle:'M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z', lock:'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4',
  menu:'M3 6h18 M3 12h18 M3 18h18', calendar:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16',
  edit:'M15 5l4 4 M3 21l5-1L21 7l-5-5L3 15z', file:'M5 2h9l5 5v15H5z M14 2v6h5 M8 13h8 M8 17h6',
  bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`;
const brand = () => '<a class="brand" href="/"><span class="brand-symbol">b.</span><span>bookdose<small>CUSTOMER SERVICE</small></span></a>';
const statusLabels = {new:'ใหม่',open:'กำลังดำเนินการ',pending_customer:'รอลูกค้า',pending_internal:'รอทีมภายใน',resolved:'แก้ไขแล้ว',closed:'ปิดเคสแล้ว'};
const priorityLabels = {low:'ต่ำ',normal:'ปกติ',high:'สูง',urgent:'เร่งด่วน'};
const roleLabels = {admin:'ผู้ดูแลองค์กร',manager:'หัวหน้าทีม',agent:'เจ้าหน้าที่'};
const pageLabels = {dashboard:'ภาพรวม',inbox:'กล่องข้อความ',tickets:'เคสบริการ',contacts:'ข้อมูลลูกค้า',knowledge:'คลังความรู้',reports:'รายงาน',settings:'ตั้งค่าองค์กร',audit:'ประวัติการทำงาน',platform:'จัดการแพลตฟอร์ม'};
const eventLabels = {'organization.created':'สร้างองค์กร','ticket.created':'เปิดเคสใหม่','ticket.updated':'อัปเดตเคส','message.reply':'ตอบกลับลูกค้า','message.note':'เพิ่มบันทึกภายใน','conversation.created':'รับเรื่องใหม่ผ่านเว็บ','conversation.linked':'เชื่อมบทสนทนากับเคส','conversation.closed':'ปิดบทสนทนา','conversation.open':'เปิดบทสนทนาอีกครั้ง','contact.created':'เพิ่มลูกค้า','contact.updated':'แก้ไขข้อมูลลูกค้า','article.saved':'บันทึกบทความ','settings.updated':'ปรับการตั้งค่า','team.created':'เพิ่มทีม','member.updated':'จัดการสมาชิก','tickets.exported':'ส่งออกรายงานเคส','backup.created':'สำรองข้อมูลองค์กร','tenant.created':'สร้างองค์กร','tenant.suspended':'ระงับองค์กร','tenant.active':'เปิดใช้งานองค์กร','auth.login':'เข้าสู่ระบบ'};
const state = {boot:null,work:null,tickets:[],contacts:[],conversations:[],articles:[],route:'dashboard',detail:null,filter:{},epoch:0,portal:null};
let toastTimer, pollTimer;

function avatar(name,index=0){return `<span class="avatar a${index%4}">${esc([...String(name || '?')].slice(0,2).join(''))}</span>`;}
function badge(status){return `<span class="badge ${esc(status)}">${esc(statusLabels[status] || ({active:'เปิดใช้งาน',suspended:'ระงับใช้งาน'}[status]) || status)}</span>`;}
function priority(value){return `<span class="priority ${esc(value)}">${esc(priorityLabels[value])}</span>`;}
function date(value,withTime=false){if(!value)return '—';return new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short',...(withTime?{hour:'2-digit',minute:'2-digit'}:{})}).format(new Date(value));}
function relative(value){const min=Math.max(0,Math.floor((Date.now()-new Date(value))/60000));return min<1?'เมื่อสักครู่':min<60?`${min} นาทีที่แล้ว`:min<1440?`${Math.floor(min/60)} ชม. ที่แล้ว`:date(value);}
function isDone(t){return ['resolved','closed'].includes(t.status);}
function overdue(t){return !isDone(t) && ((!t.first_response_at && new Date(t.first_response_due_at)<new Date()) || new Date(t.resolution_due_at)<new Date());}
function memberName(id){return state.work?.members.find(m=>m.id===id)?.name || 'ยังไม่มอบหมาย';}
function options(map,selected){return Object.entries(map).map(([value,label])=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`).join('');}
function teamOptions(selected){return (state.work?.teams || []).filter(t=>state.work.role!=='agent'||t.id===state.work.team_id).map(t=>`<option value="${t.id}" ${t.id===selected?'selected':''}>${esc(t.name)}</option>`).join('');}
function assigneeOptions(team,selected){return '<option value="">ยังไม่มอบหมาย</option>'+state.work.members.filter(m=>m.active&&m.team_id===team).map(m=>`<option value="${m.id}" ${m.id===selected?'selected':''}>${esc(m.name)}</option>`).join('');}
function empty(title,description='',symbol='inbox',action=''){return `<div class="empty">${icon(symbol)}<h3>${esc(title)}</h3><p>${esc(description)}</p>${action}</div>`;}
function toast(message,error=false){const node=$('#toast');node.textContent=message;node.className=`visible${error?' error':''}`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.className='',4500);}

async function api(path,body,method){
  const headers = {};
  if(state.boot?.csrf)headers['X-CSRF-Token']=state.boot.csrf;
  if(state.boot?.tenant_id)headers['X-Tenant-ID']=state.boot.tenant_id;
  if(state.portal?.token)headers['X-Portal-Token']=state.portal.token;
  if(body!==undefined)headers['Content-Type']='application/json';
  let response;
  try{response=await fetch(path,{method:method || (body===undefined?'GET':'POST'),headers,body:body===undefined?undefined:JSON.stringify(body)});}
  catch{throw new Error('ติดต่อโปรแกรมไม่ได้ กรุณาตรวจสอบว่าหน้าต่าง Bookdose ยังเปิดอยู่');}
  if(!response.ok){let error;try{error=(await response.json()).error;}catch{error='เกิดข้อผิดพลาด กรุณาลองใหม่';}throw new Error(error);}
  return response.headers.get('content-type')?.includes('application/json')?response.json():response.blob();
}
async function download(path,filename){const blob=await api(path);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function heading(title,subtitle,actions=''){return `<div class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="flex">${actions}</div></div>`;}
function newTicketButton(){return `<button class="btn primary" data-action="new-ticket">${icon('plus')}เปิดเคสใหม่</button>`;}
function modal(title,content){$('#modal-content').innerHTML=`<div class="modal-header"><h2>${esc(title)}</h2><button class="icon-btn" data-action="close-modal" aria-label="ปิด">${icon('close')}</button></div><div class="modal-body">${content}</div>`;$('#modal').showModal();}
function closeModal(){$('#modal').close();}
function formActions(label='บันทึก'){return `<div class="form-actions"><button type="button" class="btn" data-action="close-modal">ยกเลิก</button><button class="btn primary" type="submit">${esc(label)}</button></div>`;}
function inputField(label,name,{value='',type='text',placeholder='',required=true,max=300}={}){return `<div class="field"><label for="f-${esc(name)}">${esc(label)}</label><input id="f-${esc(name)}" name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required?'required':''} maxlength="${max}" ${type==='password'?'minlength="10" autocomplete="new-password"':''}></div>`;}

function shell(content){
  const w=state.work,b=state.boot,route=state.route;
  const nav=(key,symbol)=>`<a href="#${key}" class="nav-item ${route===key?'active':''}">${icon(symbol)}<span>${pageLabels[key]}</span>${key==='tickets'&&state.tickets.filter(t=>!isDone(t)).length?`<span class="nav-count">${state.tickets.filter(t=>!isDone(t)).length}</span>`:''}</a>`;
  $('#app').innerHTML=`<div class="mobile-overlay" data-action="toggle-menu"></div><aside class="sidebar">${brand()}
    <div class="workspace-select">${avatar(w?.tenant.name||'B')}<div class="grow"><div class="tiny muted">พื้นที่ทำงาน</div><select id="tenant-switch" aria-label="เลือกองค์กร">${b.memberships.filter(m=>m.status==='active').map(m=>`<option value="${m.id}" ${m.id===b.tenant_id?'selected':''}>${esc(m.name)}</option>`).join('')||'<option>ไม่มีองค์กรที่ใช้งานอยู่</option>'}</select></div></div>
    <div class="nav-label">WORKSPACE</div><nav>${w?nav('dashboard','dashboard')+nav('inbox','inbox')+nav('tickets','ticket')+nav('contacts','users')+nav('knowledge','book')+nav('reports','chart'):''}
    <div class="nav-label nav-space">MANAGE</div>${w&&w.role!=='agent'?nav('audit','shield'):''}${w?.role==='admin'?nav('settings','settings'):''}${b.user.platform_admin?nav('platform','globe'):''}</nav>
    <div class="sidebar-bottom">${w?`<div class="help-card"><div class="flex">${icon('chat')}<strong class="small">ใกล้ชิดลูกค้ายิ่งขึ้น</strong></div><p>แชร์หน้าช่วยเหลือขององค์กร<br>เพื่อให้ลูกค้าส่งเรื่องถึงทีมได้ทันที</p><a class="btn" href="/support/${esc(w.tenant.slug)}" target="_blank" rel="noopener">เปิดหน้าช่วยเหลือ ${icon('external')}</a></div>`:''}
    <div class="profile flex">${avatar(b.user.name,2)}<div class="grow"><strong class="truncate">${esc(b.user.name)}</strong><div class="tiny muted">${esc(w?roleLabels[w.role]:'ผู้ดูแลแพลตฟอร์ม')}</div></div><button class="icon-btn" data-action="account" aria-label="จัดการบัญชี">${icon('settings')}</button></div></div></aside>
    <div class="app-main"><header class="topbar"><div class="breadcrumb"><button class="icon-btn mobile-toggle" data-action="toggle-menu" aria-label="เปิดเมนู">${icon('menu')}</button><span>พื้นที่ทำงาน</span><span>/</span><b>${pageLabels[route]||'เคสบริการ'}</b></div><div class="top-actions">${w?`<form id="global-search" class="global-search">${icon('search')}<input aria-label="ค้นหาเคสทั้งหมด" name="q" placeholder="ค้นหาเคส ลูกค้า…"><span class="kbd">↵</span></form><span class="online">ระบบพร้อมใช้งาน</span><a class="icon-btn" href="#tickets?filter=overdue" aria-label="ดูเคสเกิน SLA">${icon('bell')}</a>`:''}${avatar(b.user.name,2)}</div></header><main class="content" id="page">${content}</main></div>`;
}

function authPage(setup){
  $('#app').innerHTML=`<main class="auth-page"><section class="auth-story">${brand()}<div><div class="story-label">A LITTLE CARE. A BETTER CONNECTION.</div><h1>ทุกคำถามมีความหมาย<br>ทุกการดูแลอยู่ที่เดียว</h1><p class="story-copy">พื้นที่ทำงานของทีมบริการลูกค้า ที่ช่วยให้คุณรับฟัง<br>ติดตาม และส่งต่อความใส่ใจได้ในทุกวัน</p><div class="story-preview"><div class="flex">${avatar('ทีม',1)}<div><strong class="small">ทีมที่พร้อมดูแลลูกค้าของคุณ</strong><div class="tiny muted">หนึ่งพื้นที่ทำงาน · ทุกบทสนทนา</div></div><span class="badge resolved">${icon('check')}</span></div><div class="preview-line"></div><div class="preview-line short"></div></div></div><div class="story-footer">Bookdose Customer Service · Made for meaningful support.</div></section>
    <section class="auth-form-wrap"><form class="auth-form" data-form="${setup?'setup':'login'}"><div class="eyebrow">${setup?'LET’S GET STARTED':'WELCOME BACK'}</div><h2>${setup?'สร้างพื้นที่ดูแลลูกค้าของคุณ':'ยินดีต้อนรับกลับมาครับ'}</h2><p>${setup?'ตั้งค่าผู้ดูแลและองค์กรแรก ใช้เวลาเพียงนิดเดียว':'เข้าสู่ระบบเพื่อเริ่มต้นวันดี ๆ ของทีมบริการลูกค้า'}</p>
    ${setup?inputField('ชื่อผู้ดูแล','name',{placeholder:'ชื่อที่ต้องการให้ทีมเห็น',max:100}):''}${inputField('อีเมล','email',{type:'email',placeholder:'you@bookdose.com',max:254})}
    <div class="field"><label for="auth-password">รหัสผ่าน${setup?' (อย่างน้อย 10 ตัวอักษร)':''}</label><input id="auth-password" name="password" type="password" required ${setup?'minlength="10"':''} maxlength="200" autocomplete="${setup?'new-password':'current-password'}" placeholder="${setup?'สร้างรหัสผ่านของคุณ':'รหัสผ่านของคุณ'}"></div>
    ${setup?`${inputField('ชื่อองค์กร','organization',{value:'Bookdose',max:100})}${inputField('รหัสองค์กรในลิงก์หน้าช่วยเหลือ','slug',{value:'bookdose',placeholder:'bookdose',max:60})}<label class="check"><input name="demo" type="checkbox" checked>เพิ่มเคสตัวอย่าง 5 เคสและคู่มือ เพื่อทดลองใช้งาน</label>`:''}
    <button class="btn primary" type="submit">${setup?'สร้างพื้นที่ทำงาน':'เข้าสู่ระบบ'} ${icon('arrow')}</button><div class="auth-foot">${icon('lock')} ${setup?'คุณจะเป็นผู้ดูแลแพลตฟอร์มและผู้ดูแลองค์กรแรก':'ข้อมูลแต่ละองค์กรแยกพื้นที่จัดเก็บอย่างอิสระ'}</div></form></section></main>`;
}

function statCard(label,value,symbol,color,foot,href){return `<a href="${href}" class="stat-card"><div class="stat-top">${esc(label)}<span class="stat-icon ${color}">${icon(symbol)}</span></div><div class="stat-value mono">${value}</div><div class="stat-foot ${color==='green'?'good':''}">${esc(foot)} ${icon('arrow')}</div></a>`;}
function ticketRows(tickets,compact=false){return tickets.map((t,index)=>`<tr><td><a class="ticket-title" href="#tickets/${t.id}" title="${esc(t.subject)}">${esc(t.subject)}</a><span class="ticket-id">BD-${t.number} <span class="muted">· ${esc(t.category)}</span></span></td><td class="customer-col"><div class="flex">${avatar(t.contact_name,index)}<div><div class="customer-name">${esc(t.contact_name)}</div><div class="customer-company">${esc(t.company || 'ลูกค้าทั่วไป')}</div></div></div></td><td>${badge(t.status)}</td><td>${priority(t.priority)}</td>${compact?'':`<td class="small muted">${esc(memberName(t.assignee_id))}</td><td>${overdue(t)?'<span class="badge suspended">เกิน SLA</span>':`<span class="small muted">${date(t.updated_at)}</span>`}</td>`}</tr>`).join('');}
function ticketTable(tickets,compact=false){return tickets.length?`<div class="table-scroll"><table class="${compact?'dashboard-table':''}"><thead><tr><th>เรื่อง / หมายเลขเคส</th><th class="customer-col">ลูกค้า</th><th>สถานะ</th><th>ความเร่งด่วน</th>${compact?'':'<th>ผู้รับผิดชอบ</th><th>อัปเดต / SLA</th>'}</tr></thead><tbody>${ticketRows(tickets,compact)}</tbody></table></div>`:empty('ยังไม่มีเคสในรายการนี้','เคสใหม่และความคืบหน้าของทีมจะแสดงที่นี่','ticket');}
function dashboard(){
  const tickets=state.tickets,active=tickets.filter(t=>!isDone(t)),late=tickets.filter(overdue),mine=active.filter(t=>t.assignee_id===state.boot.user.id);
  const today=new Date().toDateString(),resolvedToday=tickets.filter(t=>isDone(t)&&new Date(t.resolved_at).toDateString()===today).length;
  const dates=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);return d;});
  const counts=dates.map(d=>tickets.filter(t=>new Date(t.created_at).toDateString()===d.toDateString()).length),max=Math.max(...counts,1);
  return heading(`สวัสดี, ${state.boot.user.name.split(' ')[0]} 👋`,'มาดูภาพรวมการดูแลลูกค้าของทีมวันนี้กันครับ',`<span class="date-label">${icon('calendar')} ${new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'long',year:'numeric'}).format(new Date())}</span>${newTicketButton()}`)+
    `<section class="hero-strip"><div><h2>ทุกการดูแลที่ดี เริ่มจากทีมของคุณ</h2><p>${active.length?`วันนี้มี ${active.length} เคสที่รอการดูแล มาช่วยให้ลูกค้ามีวันที่ดีไปด้วยกัน`:'พื้นที่ทำงานพร้อมแล้ว แชร์หน้าช่วยเหลือเพื่อเริ่มรับเรื่องจากลูกค้าได้เลย'}</p></div><div class="hero-art">${icon('chat')}${icon('checkCircle')}${icon('sparkle')}</div></section>
    <div class="stats-grid">${statCard('เคสที่กำลังดูแล',active.length,'ticket','','เคสที่ยังไม่แก้ไขหรือปิด','#tickets?filter=active')}${statCard('เคสที่มอบหมายให้ฉัน',mine.length,'users','amber','งานที่คุณเป็นผู้รับผิดชอบ','#tickets?filter=mine')}${statCard('แก้ไขสำเร็จวันนี้',resolvedToday,'checkCircle','green','นับจากเวลาแก้ไขเคสสำเร็จ','#tickets?filter=resolved_today')}${statCard('เคสที่เกิน SLA',late.length,'clock','red','เวลาตอบกลับหรือเวลาแก้ไข','#tickets?filter=overdue')}</div>
    <div class="dashboard-grid"><section class="card"><div class="card-header"><div><h2>เคสล่าสุด</h2><p>ติดตามทุกเรื่องให้ได้รับการดูแลอย่างต่อเนื่อง</p></div><a class="btn subtle small" href="#tickets">ดูทั้งหมด ${icon('arrow')}</a></div><div class="tabs"><button class="tab active" data-action="dashboard-tab" data-filter="all">ทั้งหมด <span>${tickets.length}</span></button><button class="tab" data-action="dashboard-tab" data-filter="mine">มอบหมายให้ฉัน <span>${mine.length}</span></button><button class="tab" data-action="dashboard-tab" data-filter="new">เคสใหม่ <span>${tickets.filter(t=>t.status==='new').length}</span></button></div><div id="dashboard-tickets">${ticketTable(tickets.slice(0,6),true)}</div><div class="table-footer"><span>แสดงสูงสุด 6 เคสล่าสุด</span><a href="#tickets">ไปที่เคสบริการ →</a></div></section>
    <aside class="stack dashboard-aside"><section class="card"><div class="card-header"><h2>ต้องการการดูแล</h2><span class="badge suspended">${late.length} เคส</span></div><div class="card-body">${late.slice(0,3).map(t=>`<div class="sla-item"><div class="flex between"><span class="ticket-id">BD-${t.number}</span>${priority(t.priority)}</div><a href="#tickets/${t.id}" class="truncate">${esc(t.subject)}</a><div class="time">${icon('clock')} ${!t.first_response_at&&new Date(t.first_response_due_at)<new Date()?'เกินเวลาตอบกลับครั้งแรก':'เกินเวลาแก้ไขเคส'}</div></div>`).join('')||'<div class="empty-mini">ไม่มีเคสเกิน SLA ในขณะนี้ ✨</div>'}</div></section>
    <section class="card"><div class="card-header"><div><h2>เคสเข้าใหม่</h2><p>ย้อนหลัง 7 วัน</p></div>${icon('chart')}</div><div class="card-body"><div class="mini-chart">${dates.map((d,i)=>`<div class="chart-col"><b>${counts[i]}</b><progress value="${counts[i]}" max="${max}" aria-label="${date(d)} ${counts[i]} เคส"></progress><small>${new Intl.DateTimeFormat('th-TH',{weekday:'short'}).format(d)}</small></div>`).join('')}</div><div class="chart-legend">จำนวนเคสที่สร้าง</div></div></section></aside></div><div class="section-bottom"><span>พื้นที่ทำงาน ${esc(state.work.tenant.name)} · ข้อมูลตามสิทธิ์ของคุณ</span><span>Made for meaningful support. ♡</span></div>`;
}

function filteredTickets(){
  const f=state.filter,q=(f.q||'').toLowerCase();
  return state.tickets.filter(t=>(!q||[t.subject,t.contact_name,t.company,`BD-${t.number}`,t.category].some(v=>String(v).toLowerCase().includes(q)))&&(!f.status||t.status===f.status)&&(!f.priority||t.priority===f.priority)&&(!f.filter||f.filter==='all'||(f.filter==='active'&&!isDone(t))||(f.filter==='mine'&&!isDone(t)&&t.assignee_id===state.boot.user.id)||(f.filter==='overdue'&&overdue(t))||(f.filter==='resolved_today'&&isDone(t)&&new Date(t.resolved_at).toDateString()===new Date().toDateString())));
}
function ticketsPage(){return heading('เคสบริการ','ติดตาม จัดลำดับ และมอบหมายทุกเรื่องให้ทีมของคุณ',`<button class="btn" data-action="export">${icon('download')}ส่งออก CSV</button>${newTicketButton()}`)+`<section class="card"><div class="filters"><div class="input-wrap">${icon('search')}<input id="ticket-search" placeholder="ค้นหาหมายเลขเคส เรื่อง หรือลูกค้า" value="${esc(state.filter.q||'')}" aria-label="ค้นหาเคส"></div><select id="ticket-status" aria-label="กรองสถานะ"><option value="">ทุกสถานะ</option>${options(statusLabels,state.filter.status)}</select><select id="ticket-priority" aria-label="กรองความเร่งด่วน"><option value="">ทุกความเร่งด่วน</option>${options(priorityLabels,state.filter.priority)}</select><select id="ticket-filter" aria-label="กรองผู้รับผิดชอบหรือ SLA">${options({all:'ทุกเคส',active:'เคสที่กำลังดูแล',mine:'มอบหมายให้ฉัน',overdue:'เกิน SLA',resolved_today:'แก้ไขสำเร็จวันนี้'},state.filter.filter||'all')}</select></div><div id="ticket-table">${ticketTable(filteredTickets())}</div><div class="table-footer"><span id="ticket-count">${filteredTickets().length} เคส</span><span>ข้อมูลตามองค์กรและทีมที่คุณมีสิทธิ์</span></div></section>`;}
function refreshTicketFilter(){$('#ticket-table').innerHTML=ticketTable(filteredTickets());$('#ticket-count').textContent=`${filteredTickets().length} เคส`;}

function messagesHTML(messages,publicView=false){return messages.length?messages.map(m=>`<article class="message ${esc(m.kind)}">${avatar(m.author_name,m.kind==='customer'?2:0)}<div class="grow"><div class="message-header"><strong>${esc(m.author_name)}${m.kind==='note'?' · บันทึกภายใน':''}</strong><span>${date(m.created_at,true)}</span></div><div class="bubble">${esc(m.body)}${m.attachments.length?`<div class="message-files">${m.attachments.map(a=>`<button class="file-chip" data-action="download-file" data-id="${a.id}" data-name="${esc(a.name)}" data-public="${publicView?'yes':'no'}">${icon('paperclip')}${esc(a.name)} · ${Math.ceil(a.size/1024)} KB</button>`).join('')}</div>`:''}</div>${m.kind==='reply'?'<div class="message-footer">พร้อมอ่านในหน้าติดตามเรื่อง</div>':''}</div></article>`).join(''):empty('ยังไม่มีข้อความ','เริ่มบันทึกรายละเอียดการดูแลในเคสนี้','chat');}
function composer(conversationId,{publicView=false,manual=false}={}){return `<form class="composer" data-form="${publicView?'portal-message':'message'}" data-conversation="${conversationId}"><div class="composer-tabs">${publicView?'<span class="small muted">ส่งข้อความเพิ่มเติม</span>':`<label><input type="radio" name="kind" value="reply" ${manual?'disabled':'checked'}>ตอบกลับลูกค้า</label><label><input type="radio" name="kind" value="note" ${manual?'checked':''}>${icon('lock')} บันทึกภายใน</label><button type="button" class="btn subtle tiny" data-action="canned">คำตอบสำเร็จรูป</button>`}</div><label class="sr-only" for="compose-${conversationId}">ข้อความ</label><textarea id="compose-${conversationId}" name="body" maxlength="20000" placeholder="${manual?'บันทึกรายละเอียดการติดตามงาน…':'พิมพ์ข้อความของคุณที่นี่…'}"></textarea><div class="composer-bottom"><div><input class="file-input" type="file" name="files" multiple accept=".png,.jpg,.jpeg,.pdf,.txt" aria-label="แนบไฟล์ สูงสุด 3 ไฟล์ รวม 5 MB"><div class="composer-tip">PNG, JPG, PDF, TXT · รวมไม่เกิน 5 MB</div></div><button class="btn primary" type="submit">${icon('send')}${manual?'บันทึก':'ส่งข้อความ'}</button></div>${manual?'<p class="tiny muted mt">เคสนี้บันทึกโดยเจ้าหน้าที่ ยังไม่มีหน้าติดตามสำหรับลูกค้า</p>':''}</form>`;}
function ticketDetail(data){
  const t=data.ticket,c=data.contact;
  return `<a href="#tickets" class="back-link">${icon('back')}กลับไปเคสบริการ</a>`+heading(t.subject,`BD-${t.number} · เปิดเรื่อง ${date(t.created_at,true)} · ${t.category}`,badge(t.status))+
    `<div class="detail-layout"><div class="stack">${data.conversations.map(conv=>`<section class="card"><div class="card-header"><div class="flex">${icon(conv.channel==='web'?'globe':'file')}<h2>${conv.channel==='web'?'บทสนทนาผ่านหน้าช่วยเหลือ':'บันทึกการติดตามเคส'}</h2></div><span class="tiny muted">${esc(c.name)}</span></div><div class="thread" data-thread="${conv.id}">${messagesHTML(conv.messages)}</div>${composer(conv.id,{manual:conv.channel==='manual'})}</section>`).join('')}<section class="card"><div class="card-header"><h2>ประวัติเคส</h2></div><div class="card-body">${auditHTML(data.events)}</div></section></div>
    <aside class="card detail-sidebar"><form class="info-block" data-form="ticket-update" data-id="${t.id}"><h3>จัดการเคส</h3><div class="field"><label for="case-status">สถานะ</label><select id="case-status" name="status">${options(statusLabels,t.status)}</select></div><div class="field"><label for="case-priority">ความเร่งด่วน</label><select id="case-priority" name="priority">${options(priorityLabels,t.priority)}</select></div><div class="field"><label for="case-team">ทีมรับผิดชอบ</label><select id="case-team" name="team_id">${teamOptions(t.team_id)}</select></div><div class="field"><label for="case-assignee">ผู้รับผิดชอบ</label><select id="case-assignee" name="assignee_id">${assigneeOptions(t.team_id,t.assignee_id)}</select></div><button class="btn primary" type="submit">บันทึกการเปลี่ยนแปลง</button></form>
    <div class="info-block"><h3>ข้อมูลลูกค้า</h3><div class="flex">${avatar(c.name,2)}<strong class="small">${esc(c.name)}</strong></div><div class="info-pair"><strong>อีเมลที่ลูกค้าระบุ</strong>${esc(c.email||'—')}</div><div class="info-pair"><strong>โทรศัพท์</strong>${esc(c.phone||'—')}</div><div class="info-pair"><strong>องค์กร / บริษัท</strong>${esc(c.company||'—')}</div><div class="info-pair"><strong>เวลาตอบกลับครั้งแรก</strong>${t.first_response_at?`ตอบแล้ว ${date(t.first_response_at,true)}`:`ภายใน ${date(t.first_response_due_at,true)}`}</div><div class="info-pair"><strong>กำหนดแก้ไขเคส</strong>${date(t.resolution_due_at,true)}</div>${overdue(t)?'<span class="badge suspended">เกินกำหนด SLA</span>':''}<p class="tiny muted mt">SLA นับเวลาต่อเนื่อง 24 ชั่วโมง ไม่หยุดนับระหว่างรอลูกค้า</p></div></aside></div>`;
}

function inboxPage(selected){return heading('กล่องข้อความ','ทุกบทสนทนาจากหน้าช่วยเหลือขององค์กรอยู่ที่นี่',`<a class="btn" href="/support/${esc(state.work.tenant.slug)}" target="_blank" rel="noopener">${icon('external')}หน้าช่วยเหลือ</a>`)+`<section class="card inbox-layout"><div class="inbox-list"><div class="card-header"><h2>บทสนทนาทั้งหมด</h2><span class="badge">${state.conversations.length}</span></div>${state.conversations.map(c=>`<a class="inbox-item ${selected?.conversation.id===c.id?'selected':''}" href="#inbox/${c.id}"><div class="flex between"><div class="flex">${avatar(c.contact_name,2)}<strong>${esc(c.contact_name)}</strong></div><span class="small">${relative(c.updated_at)}</span></div><h3>${c.last_kind==='customer'&&c.status==='open'?'<span class="unread-dot" title="ข้อความล่าสุดจากลูกค้า"></span>':''}${esc(c.subject)}</h3><p>${c.last_kind==='note'?'บันทึกภายใน: ':''}${esc(c.preview||'ยังไม่มีข้อความ')}</p><div class="flex between mt"><span class="badge">${c.channel==='web'?'Web Support':'บันทึกเอง'}</span><span class="tiny muted">${c.ticket_number?'BD-'+c.ticket_number:c.status==='closed'?'ปิดบทสนทนาแล้ว':'ยังไม่เปิดเคส'}</span></div></a>`).join('')||empty('ยังไม่มีข้อความ','แชร์หน้าช่วยเหลือเพื่อเริ่มรับเรื่องจากลูกค้า','chat')}</div><div class="inbox-detail">${selected?inboxDetail(selected):empty('เลือกบทสนทนาเพื่อเริ่มดูแล','เมื่อมีลูกค้าส่งเรื่อง ข้อความจะแสดงทางด้านซ้าย','chat')}</div></section>`;}
function inboxDetail(data){const c=data.conversation;return `<div class="card-header"><div class="grow"><h2>${esc(c.subject)}</h2><p>${esc(data.contact.name)} · ${esc(data.contact.email)}</p></div><div class="flex wrap">${data.ticket?`<a class="btn sm" href="#tickets/${data.ticket.id}">BD-${data.ticket.number} ${icon('arrow')}</a>`:`<button class="btn sm primary" data-action="conversation-ticket" data-id="${c.id}">${icon('plus')}เปิดเคส</button>`}<button class="icon-btn" data-action="conversation-status" data-id="${c.id}" data-status="${c.status==='open'?'closed':'open'}" aria-label="${c.status==='open'?'ปิดบทสนทนา':'เปิดบทสนทนาอีกครั้ง'}" title="${c.status==='open'?'ปิดบทสนทนา':'เปิดบทสนทนาอีกครั้ง'}">${icon(c.status==='open'?'checkCircle':'chat')}</button></div></div><div class="thread" data-thread="${c.id}">${messagesHTML(data.messages)}</div>${composer(c.id,{manual:c.channel==='manual'})}`;}

function contactsPage(){return heading('ข้อมูลลูกค้า','รู้จักลูกค้าของคุณ พร้อมประวัติการดูแลในองค์กร',`<button class="btn primary" data-action="new-contact">${icon('plus')}เพิ่มลูกค้า</button>`)+`<section class="card"><div class="filters"><div class="input-wrap">${icon('search')}<input id="contact-search" placeholder="ค้นหาชื่อ อีเมล หรือองค์กร" aria-label="ค้นหาลูกค้า"></div><span class="small muted">${state.contacts.length} รายชื่อ</span></div><div id="contacts-table">${contactsTable(state.contacts)}</div></section>`;}
function contactsTable(contacts){return contacts.length?`<div class="table-scroll"><table><thead><tr><th>ลูกค้า</th><th>อีเมล / โทรศัพท์</th><th>องค์กร / บริษัท</th><th>เคสบริการ</th><th></th></tr></thead><tbody>${contacts.map((c,i)=>`<tr><td><div class="flex">${avatar(c.name,i)}<div><strong class="small">${esc(c.name)}</strong><div class="tiny muted">เพิ่มเมื่อ ${date(c.created_at)}</div></div></div></td><td><div class="small">${esc(c.email||'—')}</div><div class="tiny muted">${esc(c.phone||'')}</div></td><td class="muted">${esc(c.company||'—')}</td><td><button class="btn subtle" data-action="contact-history" data-id="${c.id}">${state.tickets.filter(t=>t.contact_id===c.id).length} เคส ${icon('arrow')}</button></td><td>${state.work.role!=='agent'?`<button class="icon-btn" data-action="edit-contact" data-id="${c.id}" aria-label="แก้ไข ${esc(c.name)}">${icon('edit')}</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:empty('ยังไม่มีข้อมูลลูกค้า','เพิ่มลูกค้าหรือรับเรื่องผ่านหน้าช่วยเหลือเพื่อเริ่มต้น','users');}
function knowledgePage(){return heading('คลังความรู้','รวบรวมคำตอบที่ช่วยให้ทุกการดูแลง่ายขึ้น',state.work.role!=='agent'?`<button class="btn primary" data-action="new-article">${icon('plus')}เขียนบทความ</button>`:'')+`<div class="input-wrap mb">${icon('search')}<input id="article-search" aria-label="ค้นหาบทความ" placeholder="ค้นหาบทความ คำถาม หรือวิธีแก้ไข"></div><div class="article-grid" id="articles-grid">${articleCards(state.articles)}</div>`;}
function articleCards(articles){return articles.length?articles.map(a=>`<article class="card article-card"><div class="flex between"><div class="article-icon">${icon('book')}</div><span class="badge ${a.visibility==='public'?'resolved':''}">${a.visibility==='public'?'เผยแพร่ให้ลูกค้า':'ภายในองค์กร'}</span></div><h3>${esc(a.title)}</h3><p>${esc(a.body)}</p><div class="flex between"><span class="tiny muted">${esc(a.category)}</span><button class="btn subtle" data-action="read-article" data-id="${a.id}">อ่านบทความ ${icon('arrow')}</button></div></article>`).join(''):empty('ยังไม่มีบทความ','เพิ่มความรู้จากทีม เพื่อช่วยตอบคำถามครั้งต่อไปได้เร็วขึ้น','book');}

function reportsPage(){
  const ts=state.tickets,done=ts.filter(isDone),responded=ts.filter(t=>t.first_response_at),onTime=responded.filter(t=>new Date(t.first_response_at)<=new Date(t.first_response_due_at));
  const avg=responded.length?responded.reduce((s,t)=>s+Math.max(0,(new Date(t.first_response_at)-new Date(t.created_at))/60000),0)/responded.length:0;
  const rate=responded.length?Math.round(onTime.length/responded.length*100):null;
  const bars=(map,key)=>Object.entries(map).map(([value,label])=>{const count=ts.filter(t=>t[key]===value).length;return `<div class="bar-row"><span>${esc(label)}</span><progress value="${count}" max="${Math.max(ts.length,1)}" aria-label="${esc(label)} ${count} เคส"></progress><span>${count} เคส</span></div>`;}).join('');
  return heading('รายงานการบริการ','ผลการดูแลจากเคสทั้งหมดที่คุณมีสิทธิ์เข้าถึง',`<button class="btn" data-action="export">${icon('download')}ดาวน์โหลด CSV</button>`)+`<div class="stats-grid">${statCard('เคสทั้งหมด',ts.length,'ticket','','ข้อมูลทั้งหมดในพื้นที่ทำงาน','#tickets')}${statCard('แก้ไขแล้ว / ปิดแล้ว',done.length,'checkCircle','green','จำนวนเคสที่ดำเนินการสำเร็จ','#tickets')}${statCard('ตอบกลับเฉลี่ย',responded.length?`${Math.round(avg)}<span class="small"> นาที</span>`:'—','clock','amber',`จาก ${responded.length} เคสที่ตอบแล้ว`,'#tickets')}${statCard('ตอบทัน SLA',rate===null?'—':`${rate}%`,'chart','','เฉพาะเคสที่ตอบครั้งแรกแล้ว','#tickets')}</div><div class="report-grid"><section class="card"><div class="card-header"><h2>เคสตามสถานะ</h2></div><div class="card-body">${bars(statusLabels,'status')}</div></section><section class="card"><div class="card-header"><h2>เคสตามความเร่งด่วน</h2></div><div class="card-body">${bars(priorityLabels,'priority')}<div class="notice mt">เคสที่ยังไม่ตอบและเกินกำหนด: ${ts.filter(t=>!t.first_response_at&&!isDone(t)&&new Date(t.first_response_due_at)<new Date()).length} เคส<br>SLA ใช้เวลาต่อเนื่องตลอด 24 ชั่วโมง</div></div></section><section class="card span-2"><div class="card-header"><h2>ภาระงานของทีม</h2><span class="tiny muted">เคสที่ยังไม่แก้ไขหรือปิด</span></div><div class="table-scroll"><table><thead><tr><th>เจ้าหน้าที่</th><th>ทีม</th><th>เคสในความดูแล</th><th>เกิน SLA</th></tr></thead><tbody>${state.work.members.filter(m=>m.active).map((m,i)=>`<tr><td><div class="flex">${avatar(m.name,i)}${esc(m.name)}</div></td><td class="muted">${esc(state.work.teams.find(t=>t.id===m.team_id)?.name||'—')}</td><td>${ts.filter(t=>!isDone(t)&&t.assignee_id===m.id).length}</td><td>${ts.filter(t=>t.assignee_id===m.id&&overdue(t)).length}</td></tr>`).join('')}<tr><td>ยังไม่มอบหมาย</td><td>—</td><td>${ts.filter(t=>!isDone(t)&&!t.assignee_id).length}</td><td>${ts.filter(t=>!t.assignee_id&&overdue(t)).length}</td></tr></tbody></table></div></section></div>`;
}
function settingsPage(){const s=state.work.settings;return heading('ตั้งค่าองค์กร','จัดการทีม ช่องทางรับเรื่อง และมาตรฐานการดูแลลูกค้า')+`<div class="settings-layout"><section class="card"><div class="card-header"><h2>ช่องทางรับเรื่อง</h2></div><div class="card-body"><div class="channel-row"><div class="channel-icon">${icon('globe')}</div><div class="grow"><h3>Web Support</h3><p>รับเรื่องและสนทนาผ่านหน้าช่วยเหลือ</p></div><span class="badge resolved">พร้อมใช้งาน</span></div><div class="notice mt"><a href="/support/${esc(state.work.tenant.slug)}" target="_blank" rel="noopener">${esc(location.origin)}/support/${esc(state.work.tenant.slug)}</a><button class="btn subtle" data-action="copy-portal">คัดลอกลิงก์ ${icon('external')}</button></div>${[['chat','LINE Official Account','ต้องเชื่อมบัญชี LINE และ Webhook'],['mail','Email','ต้องตั้งค่าบริการรับและส่งอีเมล'],['sparkle','AI Assistant','โมดูลเพิ่มเติมสำหรับระยะถัดไป']].map(([symbol,title,desc])=>`<div class="channel-row"><div class="channel-icon">${icon(symbol)}</div><div class="grow"><h3>${title}</h3><p>${desc}</p></div><span class="badge">ยังไม่เชื่อมต่อ</span></div>`).join('')}</div></section>
    <section class="card"><div class="card-header"><h2>มาตรฐานการบริการ</h2></div><form class="card-body" data-form="settings"><div class="form-grid">${inputField('ตอบกลับครั้งแรกภายใน (ชม.)','response_hours',{type:'number',value:s.response_hours})}${inputField('แก้ไขเคสภายใน (ชม.)','resolution_hours',{type:'number',value:s.resolution_hours})}</div><p class="tiny muted">ใช้กับเคสที่สร้างใหม่ · นับต่อเนื่อง 24 ชั่วโมง รวมวันหยุด</p><div class="field"><label for="welcome">ข้อความต้อนรับในหน้าช่วยเหลือ</label><textarea id="welcome" name="welcome" maxlength="500" required>${esc(s.welcome)}</textarea></div><div class="field"><label for="canned-reply">คำตอบสำเร็จรูปของทีม</label><textarea id="canned-reply" name="canned_reply" maxlength="3000" required>${esc(s.canned_reply)}</textarea></div><button class="btn primary">บันทึกการตั้งค่า</button></form></section>
    <section class="card span-2"><div class="card-header"><div><h2>สมาชิกในองค์กร</h2><p>ผู้ดูแลองค์กรและหัวหน้าทีมเห็นงานทุกทีม เจ้าหน้าที่เห็นเฉพาะทีมของตน</p></div><button class="btn" data-action="new-member">${icon('plus')}เพิ่มสมาชิก</button></div><div class="table-scroll"><table><thead><tr><th>สมาชิก</th><th>อีเมล</th><th>บทบาท</th><th>ทีม</th><th>สถานะ</th><th></th></tr></thead><tbody>${state.work.members.map((m,i)=>`<tr><td><div class="flex">${avatar(m.name,i)}${esc(m.name)}</div></td><td class="muted">${esc(m.email)}</td><td>${roleLabels[m.role]}</td><td>${esc(state.work.teams.find(t=>t.id===m.team_id)?.name||'—')}</td><td>${badge(m.active?'active':'suspended')}</td><td><button class="icon-btn" data-action="edit-member" data-id="${m.id}" aria-label="แก้ไขสมาชิก ${esc(m.name)}">${icon('edit')}</button></td></tr>`).join('')}</tbody></table></div></section>
    <section class="card"><div class="card-header"><h2>ทีมในองค์กร</h2><button class="btn sm" data-action="new-team">${icon('plus')}เพิ่มทีม</button></div><div class="card-body">${state.work.teams.map(t=>`<div class="channel-row"><div class="channel-icon">${icon('users')}</div><div class="grow"><h3>${esc(t.name)}</h3><p>${state.work.members.filter(m=>m.active&&m.team_id===t.id).length} สมาชิก</p></div></div>`).join('')}</div></section><section class="card"><div class="card-header"><h2>ข้อมูลและการสำรอง</h2>${icon('shield')}</div><div class="card-body"><p class="small muted">ดาวน์โหลดฐานข้อมูลและไฟล์แนบขององค์กรนี้ในรูปแบบ ZIP เพื่อเก็บสำรอง ข้อมูลที่ดาวน์โหลดมีรายละเอียดลูกค้าและบันทึกภายใน</p><button class="btn" data-action="backup">${icon('download')}สำรองข้อมูลองค์กร</button><p class="tiny muted mt">การสำรองทั้งระบบและกู้คืนทำผ่านคำสั่งที่อธิบายใน README.md</p></div></section></div>`;}

function auditHTML(events){return events.length?events.map(ev=>`<div class="audit-event"><span class="event-dot"></span><div class="grow"><strong>${esc(ev.actor)}</strong> · ${esc(eventLabels[ev.action]||ev.action)}<p>${date(ev.created_at,true)} · อ้างอิง ${esc(ev.entity.slice(0,10))}</p></div></div>`).join(''):'<div class="empty-mini">ยังไม่มีประวัติการทำงาน</div>';}
function auditPage(events){return heading('ประวัติการทำงาน','ตรวจสอบการดำเนินการในองค์กร ย้อนหลังสูงสุด 300 รายการ')+`<section class="card"><div class="card-header"><h2>กิจกรรมล่าสุด</h2>${icon('shield')}</div><div class="card-body">${auditHTML(events)}</div></section>`;}
function platformPage(data){return heading('จัดการแพลตฟอร์ม','พื้นที่บริหารองค์กรสำหรับ Bookdose',`<button class="btn primary" data-action="new-tenant">${icon('plus')}สร้างองค์กร</button>`)+`<div class="notice mb">สิทธิ์ผู้ดูแลแพลตฟอร์มใช้บริหารองค์กร การอ่านเคสและบทสนทนาต้องมีสมาชิกและสิทธิ์ในองค์กรนั้นแยกต่างหาก</div><section class="card"><div class="card-header"><h2>องค์กรทั้งหมด</h2><span class="badge">${data.tenants.length} องค์กร</span></div><div class="table-scroll"><table><thead><tr><th>องค์กร</th><th>หน้าช่วยเหลือ</th><th>สมาชิก</th><th>สถานะ</th><th></th></tr></thead><tbody>${data.tenants.map((t,i)=>`<tr><td><div class="flex">${avatar(t.name,i)}<div><strong>${esc(t.name)}</strong><div class="tiny muted">สร้าง ${date(t.created_at)}</div></div></div></td><td><a href="/support/${esc(t.slug)}" target="_blank" rel="noopener">/support/${esc(t.slug)}</a></td><td>${t.member_count}</td><td>${badge(t.status)}</td><td><button class="btn sm ${t.status==='active'?'danger':''}" data-action="tenant-status" data-id="${t.id}" data-status="${t.status==='active'?'suspended':'active'}" data-name="${esc(t.name)}">${t.status==='active'?'ระงับองค์กร':'เปิดใช้งาน'}</button></td></tr>`).join('')}</tbody></table></div></section><section class="card mt"><div class="card-header"><h2>ประวัติแพลตฟอร์ม</h2></div><div class="card-body">${auditHTML(data.audit)}</div></section>`;}

async function route(){
  clearInterval(pollTimer);
  const epoch=++state.epoch;
  const [path,search='']=(location.hash.slice(1)||'dashboard').split('?');
  const [page,id]=path.split('/');state.route=page;state.detail=null;
  try{
    state.boot=await api('/api/bootstrap');
    if(epoch!==state.epoch)return;
    if(!state.boot.user)return authPage(state.boot.setup_required);
    const membership=state.boot.memberships.find(m=>m.id===state.boot.tenant_id&&m.status==='active');
    state.work=membership?await api('/api/workspace'):null;
    if(state.work){state.tickets=(await api('/api/tickets')).tickets;}else state.tickets=[];
    if(epoch!==state.epoch)return;
    let content;
    if(page==='platform'&&state.boot.user.platform_admin){content=platformPage(await api('/api/platform/tenants'));}
    else if(!state.work){content=empty('ไม่มีพื้นที่ทำงานที่ใช้งานอยู่','เลือกองค์กรอื่นจากเมนู หรือติดต่อผู้ดูแลองค์กรเพื่อเปิดใช้งานอีกครั้ง','lock',state.boot.user.platform_admin?'<a class="btn primary" href="#platform">จัดการแพลตฟอร์ม</a>':'');}
    else if(page==='tickets'&&id){state.detail=await api(`/api/tickets/${id}`);content=ticketDetail(state.detail);}
    else if(page==='tickets'){state.filter=Object.fromEntries(new URLSearchParams(search));content=ticketsPage();}
    else if(page==='inbox'){
      state.conversations=(await api('/api/conversations')).conversations;
      const selected=id||state.conversations[0]?.id;
      state.detail=selected?await api(`/api/conversations/${selected}`):null;
      content=inboxPage(state.detail);
    }else if(page==='contacts'){state.contacts=(await api('/api/contacts')).contacts;content=contactsPage();}
    else if(page==='knowledge'){state.articles=(await api('/api/articles')).articles;content=knowledgePage();}
    else if(page==='reports'){content=reportsPage();}
    else if(page==='settings'&&state.work.role==='admin'){content=settingsPage();}
    else if(page==='audit'&&state.work.role!=='agent'){content=auditPage((await api('/api/audit')).events);}
    else{state.route='dashboard';content=dashboard();}
    if(epoch!==state.epoch)return;
    shell(content);document.title=`${pageLabels[state.route]||'Bookdose'} · Bookdose`;
    $$('input[name$="_hours"]').forEach(n=>{n.min='0.25';n.max='8760';n.step='0.25';});
    $$('[data-thread]').forEach(n=>n.scrollTop=n.scrollHeight);
    if(state.detail)pollTimer=setInterval(pollStaffMessages,12000);
  }catch(error){if(epoch!==state.epoch)return;const content=empty('เปิดพื้นที่ทำงานไม่สำเร็จ',error.message,'lock','<button class="btn primary" data-action="refresh">ลองใหม่</button> <button class="btn" data-action="logout">ออกจากระบบ</button>');if(state.boot?.user)shell(content);else $('#app').innerHTML=content;}
}

async function pollStaffMessages(){
  if(document.hidden||$('#modal').open)return;
  const epoch=state.epoch;
  try{
    const detail=state.detail;if(!detail)return;
    const path=detail.ticket&&detail.conversations?`/api/tickets/${detail.ticket.id}`:`/api/conversations/${detail.conversation.id}`;
    const fresh=await api(path);if(epoch!==state.epoch)return;
    const list=fresh.conversations||[{id:fresh.conversation.id,messages:fresh.messages}];
    list.forEach(c=>{const node=$(`[data-thread="${c.id}"]`);if(node){const html=messagesHTML(c.messages);if(node.innerHTML!==html){const bottom=node.scrollHeight-node.scrollTop-node.clientHeight<100;node.innerHTML=html;if(bottom)node.scrollTop=node.scrollHeight;}}});
  }catch(error){clearInterval(pollTimer);toast(error.message,true);}
}

async function openNewTicket(){
  state.contacts=(await api('/api/contacts')).contacts;
  if(!state.contacts.length)return contactModal(null,true);
  modal('เปิดเคสบริการใหม่',`<form data-form="ticket"><div class="form-grid"><div class="field span-2"><label for="new-subject">เรื่องที่ต้องการให้ช่วยเหลือ</label><input id="new-subject" name="subject" required maxlength="300" placeholder="สรุปเรื่องให้ทีมเข้าใจได้ง่าย"></div><div class="field span-2"><label for="new-contact">ลูกค้า</label><select id="new-contact" name="contact_id" required><option value="">เลือกลูกค้า</option>${state.contacts.map(c=>`<option value="${c.id}">${esc(c.name)} ${c.company?'· '+esc(c.company):''}</option>`).join('')}</select><button type="button" class="btn subtle" data-action="contact-for-ticket">+ เพิ่มลูกค้าใหม่</button></div><div class="field"><label for="new-priority">ความเร่งด่วน</label><select id="new-priority" name="priority">${options(priorityLabels,'normal')}</select></div>${inputField('หมวดหมู่','category',{value:'ทั่วไป',max:80})}<div class="field"><label for="new-team">ทีมรับผิดชอบ</label><select id="new-team" name="team_id">${teamOptions(state.work.team_id)}</select></div><div class="field"><label for="new-assignee">ผู้รับผิดชอบ</label><select id="new-assignee" name="assignee_id">${assigneeOptions(state.work.team_id,'')}</select></div><div class="field span-2"><label for="new-body">รายละเอียด / บันทึกภายใน</label><textarea id="new-body" name="body" maxlength="20000" placeholder="รายละเอียดปัญหาและข้อมูลที่ทีมควรทราบ"></textarea></div></div>${formActions('เปิดเคส')}</form>`);
}
function contactModal(contact,thenTicket=false){const c=contact||{};modal(contact?'แก้ไขข้อมูลลูกค้า':'เพิ่มลูกค้าใหม่',`<form data-form="contact" data-id="${c.id||''}" data-next="${thenTicket?'ticket':''}"><div class="form-grid">${inputField('ชื่อลูกค้า','name',{value:c.name,max:100})}${inputField('อีเมล','email',{value:c.email,type:'email',required:false,max:254})}${inputField('โทรศัพท์','phone',{value:c.phone,required:false,max:40})}${inputField('องค์กร / บริษัท','company',{value:c.company,required:false,max:150})}<div class="field span-2"><label for="contact-notes">หมายเหตุภายใน</label><textarea id="contact-notes" name="notes" maxlength="3000">${esc(c.notes||'')}</textarea></div></div>${formActions()}</form>`);}
function articleModal(article){const a=article||{};modal(article?'แก้ไขบทความ':'เขียนบทความใหม่',`<form data-form="article" data-id="${a.id||''}"><div class="stack">${inputField('ชื่อบทความ','title',{value:a.title,max:200})}<div class="form-grid">${inputField('หมวดหมู่','category',{value:a.category||'ทั่วไป',max:80})}<div class="field"><label for="article-visibility">สิทธิ์การอ่าน</label><select name="visibility" id="article-visibility">${options({internal:'ภายในองค์กร',public:'เผยแพร่ให้ลูกค้า'},a.visibility||'internal')}</select></div></div><div class="field"><label for="article-body">เนื้อหาบทความ</label><textarea id="article-body" name="body" rows="10" maxlength="50000" required>${esc(a.body||'')}</textarea></div></div>${formActions('บันทึกบทความ')}</form>`);}
function memberModal(member){const m=member||{};modal(member?'จัดการสมาชิก':'เพิ่มสมาชิกใหม่',`<form data-form="member" data-id="${m.id||''}">${member?`<p>${esc(m.name)} · ${esc(m.email)}</p>`:`<div class="notice">สร้างบัญชีให้สมาชิกใหม่ แล้วแจ้งอีเมลและรหัสผ่านให้เจ้าตัวโดยตรง ระบบรุ่นนี้ไม่ส่งอีเมลเชิญ</div><div class="stack mb">${inputField('ชื่อสมาชิก','name',{max:100})}${inputField('อีเมล','email',{type:'email',max:254})}${inputField('รหัสผ่านเริ่มต้น','password',{type:'password',max:200})}</div>`}<div class="form-grid"><div class="field"><label for="member-role">บทบาท</label><select id="member-role" name="role">${options(roleLabels,m.role||'agent')}</select></div><div class="field"><label for="member-team">ทีม</label><select id="member-team" name="team_id">${teamOptions(m.team_id||state.work.team_id)}</select></div>${member?`<label class="check span-2"><input name="active" type="checkbox" ${m.active?'checked':''}>อนุญาตให้เข้าใช้งานองค์กร</label>`:''}</div>${formActions()}</form>`);}

async function getFiles(form){
  const files=[...($('input[type="file"]',form)?.files||[])];
  if(files.length>3||files.reduce((s,f)=>s+f.size,0)>5*1024*1024)throw new Error('แนบได้สูงสุด 3 ไฟล์ ขนาดรวมไม่เกิน 5 MB');
  return Promise.all(files.map(file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,data:reader.result.split(',')[1]});reader.onerror=()=>reject(new Error('อ่านไฟล์ไม่สำเร็จ'));reader.readAsDataURL(file);})));
}

async function handleForm(form){
  const kind=form.dataset.form,data=Object.fromEntries(new FormData(form));
  if(kind==='setup'||kind==='login'){if(kind==='setup')data.demo=$('[name="demo"]',form).checked;await api(`/api/${kind}`,data);location.hash='dashboard';await route();return;}
  if(kind==='ticket'){const result=await api('/api/tickets',data);closeModal();location.hash=`tickets/${result.id}`;toast('เปิดเคสเรียบร้อยแล้ว');return;}
  if(kind==='ticket-update'){await api(`/api/tickets/${form.dataset.id}`,data,'PATCH');toast('บันทึกเคสเรียบร้อยแล้ว');await route();return;}
  if(kind==='contact'){const id=form.dataset.id;await api(`/api/contacts${id?'/'+id:''}`,data,id?'PATCH':'POST');closeModal();toast('บันทึกข้อมูลลูกค้าแล้ว');if(form.dataset.next==='ticket')await openNewTicket();else await route();return;}
  if(kind==='message'){
    delete data.files;data.attachments=await getFiles(form);
    await api(`/api/conversations/${form.dataset.conversation}/messages`,data);
    $('[name="body"]',form).value='';$('input[type="file"]',form).value='';
    await pollStaffMessages();toast(data.kind==='note'?'บันทึกภายในแล้ว':'ข้อความพร้อมอ่านในหน้าติดตามของลูกค้า');return;
  }
  if(kind==='article'){const id=form.dataset.id;await api(`/api/articles${id?'/'+id:''}`,data,id?'PATCH':'POST');closeModal();toast('บันทึกบทความเรียบร้อยแล้ว');await route();return;}
  if(kind==='settings'){await api('/api/settings',data,'PATCH');toast('บันทึกการตั้งค่าแล้ว');await route();return;}
  if(kind==='team'){await api('/api/teams',data);closeModal();toast('เพิ่มทีมแล้ว');await route();return;}
  if(kind==='member'){const id=form.dataset.id;if(id)data.active=$('[name="active"]',form).checked;await api(`/api/members${id?'/'+id:''}`,data,id?'PATCH':'POST');closeModal();toast('บันทึกสมาชิกแล้ว');await route();return;}
  if(kind==='tenant'){await api('/api/platform/tenants',data);closeModal();toast('สร้างองค์กรเรียบร้อยแล้ว');await route();return;}
  if(kind==='password'){await api('/api/account/password',data);closeModal();toast('เปลี่ยนรหัสผ่านแล้ว เซสชันอื่นออกจากระบบเรียบร้อย');await route();return;}
  if(kind==='tenant-status'){await api(`/api/platform/tenants/${form.dataset.id}`,{status:form.dataset.status},'PATCH');closeModal();toast('เปลี่ยนสถานะองค์กรแล้ว');await route();return;}
  if(kind==='portal-request'){
    delete data.files;data.attachments=await getFiles(form);
    const result=await api(`/api/public/${state.portal.slug}/conversations`,data);
    state.portal.token=result.token;location.hash=`case=${result.token}`;
    toast('ส่งเรื่องถึงทีมงานแล้ว เก็บลิงก์นี้ไว้ติดตามคำตอบ');await loadPortalSession();return;
  }
  if(kind==='portal-message'){
    delete data.files;data.attachments=await getFiles(form);await api(`/api/public/${state.portal.slug}/messages`,data);
    $('[name="body"]',form).value='';$('input[type="file"]',form).value='';await pollPortal();toast('ส่งข้อความแล้ว');return;
  }
}

async function action(button){const id=button.dataset.id;
  switch(button.dataset.action){
    case 'close-modal':return closeModal();
    case 'toggle-menu':$('.sidebar')?.classList.toggle('mobile-open');$('.mobile-overlay')?.classList.toggle('visible');return;
    case 'refresh':return state.portal?initPortal():route();
    case 'logout':await api('/api/logout',{});closeModal();state.boot=null;return route();
    case 'account':return modal('บัญชีของคุณ',`<div class="flex mb">${avatar(state.boot.user.name,2)}<div><strong>${esc(state.boot.user.name)}</strong><p class="small muted">${esc(state.boot.user.email)}</p></div></div><form data-form="password"><div class="stack">${inputField('รหัสผ่านปัจจุบัน','current_password',{type:'password',max:200})}${inputField('รหัสผ่านใหม่ (อย่างน้อย 10 ตัวอักษร)','password',{type:'password',max:200})}</div><div class="form-actions"><button class="btn danger" type="button" data-action="logout">${icon('logout')}ออกจากระบบ</button><button class="btn primary">เปลี่ยนรหัสผ่าน</button></div></form>`);
    case 'new-ticket':return openNewTicket();
    case 'new-contact':return contactModal();
    case 'contact-for-ticket':return contactModal(null,true);
    case 'edit-contact':return contactModal(state.contacts.find(c=>c.id===id));
    case 'contact-history':{const c=state.contacts.find(c=>c.id===id);return modal(`เคสของ ${c.name}`,ticketTable(state.tickets.filter(t=>t.contact_id===id),true));}
    case 'new-article':return articleModal();
    case 'edit-article':return articleModal(state.articles.find(a=>a.id===id));
    case 'read-article':{const a=(state.portal?state.portal.info.articles:state.articles).find(a=>a.id===id);return modal(a.title,`<div class="flex between mb"><span class="badge">${esc(a.category)}</span><span class="tiny muted">อัปเดต ${date(a.updated_at)}</span></div><div class="pre small">${esc(a.body)}</div>${!state.portal&&state.work.role!=='agent'?`<div class="form-actions"><button class="btn" data-action="edit-article" data-id="${a.id}">${icon('edit')}แก้ไขบทความ</button></div>`:''}`);}
    case 'new-team':return modal('เพิ่มทีมใหม่',`<form data-form="team">${inputField('ชื่อทีม','name',{max:100})}${formActions('เพิ่มทีม')}</form>`);
    case 'new-member':return memberModal();
    case 'edit-member':return memberModal(state.work.members.find(m=>m.id===id));
    case 'new-tenant':return modal('สร้างองค์กรใหม่',`<form data-form="tenant"><div class="notice">องค์กรใหม่มีพื้นที่ข้อมูลแยกของตัวเอง ระบุผู้ดูแลองค์กรด้านล่าง หากอีเมลมีบัญชีอยู่แล้ว ระบบจะใช้บัญชีเดิมและไม่เปลี่ยนรหัสผ่าน</div><div class="form-grid">${inputField('ชื่อองค์กร','name',{max:100})}${inputField('รหัสองค์กร (a-z, 0-9, -)','slug',{max:60})}${inputField('ชื่อผู้ดูแลองค์กร','admin_name',{max:100})}${inputField('อีเมลผู้ดูแล','email',{type:'email',max:254})}<div class="span-2">${inputField('รหัสผ่านเริ่มต้น (กรอกสำหรับบัญชีใหม่)','password',{type:'password',required:false,max:200})}</div></div>${formActions('สร้างองค์กร')}</form>`);
    case 'tenant-status':return modal(button.dataset.status==='suspended'?'ระงับการใช้งานองค์กร':'เปิดใช้งานองค์กร',`<form data-form="tenant-status" data-id="${id}" data-status="${esc(button.dataset.status)}"><p class="small">${button.dataset.status==='suspended'?'สมาชิกและลูกค้าจะเข้าใช้งานองค์กรนี้ไม่ได้จนกว่าจะเปิดใช้งานอีกครั้ง ข้อมูลเดิมยังคงอยู่':'สมาชิกและลูกค้าจะกลับมาเข้าใช้งานองค์กรนี้ได้'}</p><strong>${esc(button.dataset.name)}</strong>${formActions('ยืนยันการเปลี่ยนสถานะ')}</form>`);
    case 'conversation-ticket':{const result=await api(`/api/conversations/${id}/ticket`,{});toast('เปิดเคสจากบทสนทนาแล้ว');location.hash=`tickets/${result.id}`;return;}
    case 'conversation-status':await api(`/api/conversations/${id}`,{status:button.dataset.status},'PATCH');toast(button.dataset.status==='closed'?'ปิดบทสนทนาแล้ว':'เปิดบทสนทนาแล้ว');return route();
    case 'canned':{const form=button.closest('form'),area=$('textarea',form);area.value=state.work.settings.canned_reply;area.focus();return;}
    case 'export':await download('/api/export/tickets.csv',`bookdose-tickets-${new Date().toISOString().slice(0,10)}.csv`);toast('ดาวน์โหลดรายงานเคสทั้งหมดตามสิทธิ์แล้ว');return;
    case 'backup':button.disabled=true;try{await download('/api/backup',`bookdose-${state.work.tenant.slug}-backup.zip`);toast('ดาวน์โหลดไฟล์สำรองแล้ว');}finally{button.disabled=false;}return;
    case 'copy-portal':await copyText(`${location.origin}/support/${state.work.tenant.slug}`);return;
    case 'copy-tracking':await copyText(location.href);return;
    case 'portal-new':location.hash='';state.portal.token=null;clearInterval(pollTimer);renderPortalHome();return;
    case 'download-file':return download(button.dataset.public==='yes'?`/api/public/${state.portal.slug}/attachments/${id}`:`/api/attachments/${id}`,button.dataset.name);
    case 'dashboard-tab':{
      $$('.tab',button.parentElement).forEach(n=>n.classList.toggle('active',n===button));const filter=button.dataset.filter;
      const tickets=state.tickets.filter(t=>filter==='all'||filter==='mine'&&t.assignee_id===state.boot.user.id&&!isDone(t)||filter==='new'&&t.status==='new');
      $('#dashboard-tickets').innerHTML=ticketTable(tickets.slice(0,6),true);return;
    }
  }
}
async function copyText(value){try{await navigator.clipboard.writeText(value);toast('คัดลอกลิงก์แล้ว');}catch{modal('คัดลอกลิงก์',`<div class="field"><label for="copy-url">เลือกลิงก์ด้านล่างแล้วคัดลอก</label><input id="copy-url" value="${esc(value)}" readonly></div>`);$('#copy-url').select();}}

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
document.addEventListener('input',event=>{const n=event.target;if(n.id==='ticket-search'){state.filter.q=n.value;refreshTicketFilter();}if(n.id==='contact-search'){const q=n.value.toLowerCase();$('#contacts-table').innerHTML=contactsTable(state.contacts.filter(c=>[c.name,c.email,c.company,c.phone].some(v=>v.toLowerCase().includes(q))));}if(n.id==='article-search'){const q=n.value.toLowerCase();$('#articles-grid').innerHTML=articleCards(state.articles.filter(a=>[a.title,a.body,a.category].some(v=>v.toLowerCase().includes(q))));}});
document.addEventListener('change',async event=>{const n=event.target;
  try{
    if(n.id==='tenant-switch'){await api('/api/session/tenant',{tenant_id:n.value});if(location.hash==='#dashboard')await route();else location.hash='dashboard';}
    if(n.id==='ticket-status'){state.filter.status=n.value;refreshTicketFilter();}
    if(n.id==='ticket-priority'){state.filter.priority=n.value;refreshTicketFilter();}
    if(n.id==='ticket-filter'){state.filter.filter=n.value;refreshTicketFilter();}
    if(n.name==='team_id'){const select=$('[name="assignee_id"]',n.closest('form'));if(select)select.innerHTML=assigneeOptions(n.value,'');}
  }catch(error){toast(error.message,true);}
});

function portalShell(content){$('#app').innerHTML=`<main class="portal"><header class="portal-header">${brand()}<span class="muted small">ศูนย์ช่วยเหลือ ${esc(state.portal.info.organization.name)}</span></header>${content}<div class="section-bottom"><span>การดูแลโดย ${esc(state.portal.info.organization.name)}</span><span>Powered by Bookdose</span></div></main>`;}
function renderPortalHome(){
  const info=state.portal.info;
  portalShell(`<div class="portal-hero"><div class="eyebrow">WE’RE HERE TO HELP</div><h1>มีอะไรให้เราช่วยไหมครับ?</h1><p>${esc(info.welcome)}</p></div><div class="portal-grid"><section class="card"><div class="card-header"><h2>ส่งเรื่องถึงทีมงาน</h2>${icon('chat')}</div><form class="card-body" data-form="portal-request">${inputField('ชื่อของคุณ','name',{max:100})}${inputField('อีเมลสำหรับติดต่อ','email',{type:'email',max:254})}${inputField('เรื่องที่ต้องการความช่วยเหลือ','subject',{max:300})}<div class="field"><label for="request-body">รายละเอียด</label><textarea id="request-body" name="body" required maxlength="20000" rows="5" placeholder="เล่าให้เราฟังว่าเกิดอะไรขึ้น เพื่อให้ทีมช่วยคุณได้ตรงจุด"></textarea></div><div class="field"><label for="request-files">แนบไฟล์ (รวมไม่เกิน 5 MB)</label><input id="request-files" class="file-input" name="files" type="file" multiple accept=".png,.jpg,.jpeg,.pdf,.txt"></div><p class="tiny muted">หลังส่งเรื่อง คุณจะได้รับลิงก์สำหรับอ่านคำตอบและติดตามเรื่องผ่านหน้านี้ กรุณาอย่าส่งรหัสผ่านหรือข้อมูลบัตรชำระเงิน</p><button class="btn primary">ส่งเรื่องถึงทีมงาน ${icon('send')}</button></form></section><section class="card"><div class="card-header"><h2>คำตอบที่อาจช่วยคุณได้</h2>${icon('book')}</div><div class="card-body">${info.articles.map(a=>`<button class="portal-article" data-action="read-article" data-id="${a.id}">${icon('file')}${esc(a.title)}</button>`).join('')||empty('ทีมงานพร้อมช่วยเหลือ','ส่งรายละเอียดทางแบบฟอร์ม แล้วกลับมาอ่านคำตอบผ่านลิงก์ติดตามเรื่องของคุณ','chat')}<div class="notice mt">มีเรื่องที่เคยติดต่อไว้แล้ว? เปิดลิงก์ติดตามที่ได้รับหลังส่งเรื่อง เพื่อกลับเข้าสู่บทสนทนาเดิม</div></div></section></div>`);
}
async function loadPortalSession(){
  clearInterval(pollTimer);
  const data=await api(`/api/public/${state.portal.slug}/session`);state.portal.session=data;
  portalShell(heading('ติดตามเรื่องของคุณ',data.conversation.subject,`<button class="btn" data-action="portal-new">ส่งเรื่องใหม่</button>`)+`<div class="notice flex between wrap"><span>เก็บลิงก์หน้านี้ไว้เพื่อติดตามคำตอบ ผู้ที่มีลิงก์จะอ่านและตอบบทสนทนานี้ได้</span><button class="btn sm" data-action="copy-tracking">คัดลอกลิงก์ติดตาม</button></div><section class="card"><div class="card-header"><div><h2>${esc(data.conversation.subject)}</h2><p id="portal-status">${data.ticket?`BD-${data.ticket.number} · ${statusLabels[data.ticket.status]}`:'ทีมงานได้รับเรื่องแล้ว'}</p></div>${icon('chat')}</div><div class="thread" id="portal-thread">${messagesHTML(data.messages,true)}</div>${composer(data.conversation.id,{publicView:true})}</section>`);
  $('#portal-thread').scrollTop=$('#portal-thread').scrollHeight;pollTimer=setInterval(()=>pollPortal().catch(()=>{}),10000);
}
async function pollPortal(){if(document.hidden)return;const token=state.portal.token;if(!token)return;try{const data=await api(`/api/public/${state.portal.slug}/session`);if(state.portal.token!==token)return;const node=$('#portal-thread');if(!node)return;const html=messagesHTML(data.messages,true);if(node.innerHTML!==html){const bottom=node.scrollHeight-node.scrollTop-node.clientHeight<100;node.innerHTML=html;if(bottom)node.scrollTop=node.scrollHeight;}$('#portal-status').textContent=data.ticket?`BD-${data.ticket.number} · ${statusLabels[data.ticket.status]}`:data.conversation.status==='closed'?'บทสนทนานี้ดำเนินการเรียบร้อยแล้ว':'ทีมงานได้รับเรื่องแล้ว';}catch(error){clearInterval(pollTimer);toast(error.message,true);throw error;}}
async function initPortal(){
  clearInterval(pollTimer);const slug=location.pathname.split('/')[2];state.portal={slug,token:new URLSearchParams(location.hash.slice(1)).get('case')};
  try{state.portal.info=await api(`/api/public/${slug}`);document.title=`ศูนย์ช่วยเหลือ ${state.portal.info.organization.name} · Bookdose`;if(state.portal.token)await loadPortalSession();else renderPortalHome();}
  catch(error){$('#app').innerHTML=`<main class="portal">${brand()}${empty('เปิดหน้าช่วยเหลือไม่สำเร็จ',error.message,'lock','<button class="btn" data-action="refresh">ลองใหม่</button>')}</main>`;}
}
window.addEventListener('hashchange',()=>{if(!location.pathname.startsWith('/support/')){closeModal();route();}else{const token=new URLSearchParams(location.hash.slice(1)).get('case');if(token!==state.portal?.token)initPortal();}});
if(location.pathname.startsWith('/support/'))initPortal();else route();
