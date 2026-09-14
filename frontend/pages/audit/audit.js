/* Activity log: who did what, grouped by day, filtered by person, kind and date.
   Markup: pages/audit/, ui/filter-pill.html, ui/search-input.html, ui/pager.html. */

'use strict';

const auditEventLabels={'email.oauth_started':'เริ่มเชื่อมบัญชีอีเมล','email.oauth_connected':'เชื่อมบัญชีอีเมลสำเร็จ','channel.settings_updated':'ปรับการเชื่อมต่อช่องทาง','channel.message_received':'รับข้อความจากลูกค้า','channel.retry_requested':'ขอส่งข้อความอีกครั้ง','channel.accepted':'ผู้ให้บริการรับข้อความแล้ว','channel.failed':'ส่งข้อความไม่สำเร็จ','channel.unknown':'ไม่ทราบผลการส่งข้อความ','line.join':'เข้าร่วมกลุ่ม LINE','line.leave':'ออกจากกลุ่ม LINE','ai.handoff':'โอนเคสให้เจ้าหน้าที่ดูแลต่อ','ai.completed':'AI ประมวลผลคำตอบสำเร็จ','ai.queued':'นำคำขอ AI เข้าคิว','ai.failed':'AI ประมวลผลไม่สำเร็จ','ai.cancelled':'ยกเลิกคำขอ AI','ai.resumed':'ให้ AI ดูแลต่อ','ai.settings_updated':'ปรับการตั้งค่า AI','conversation.created':'รับเรื่องใหม่','conversation.closed':'ปิดบทสนทนา','conversation.open':'เปิดบทสนทนาอีกครั้ง','message.reply':'ตอบกลับลูกค้า','message.note':'เพิ่มบันทึกภายใน','message.files_revoked':'ยกเลิกลิงก์ไฟล์แนบ','auth.email_verified':'ยืนยันอีเมล','tenant.register':'สมัครองค์กรใหม่','registration.settings_updated':'ตั้งค่าอีเมลยืนยัน','account.profile_updated':'ปรับรูปโปรไฟล์และชื่อ'};

const auditGroups={work:{label:'งานบริการ',icon:'ticket'},ai:{label:'ระบบ AI',icon:'sparkle'},security:{label:'บัญชีและสิทธิ์',icon:'lock'},settings:{label:'ตั้งค่าระบบ',icon:'settings'}};

// The icon says what kind of activity it was, so a day of work can be skimmed instead of read.
const auditIcons={'message.reply':'send','message.note':'lock','message.files_revoked':'paperclip',
  'conversation.created':'chat','conversation.closed':'checkCircle','conversation.open':'chat','conversation.linked':'ticket',
  'ticket.created':'plus','ticket.updated':'edit','ticket.deleted':'close','tickets.exported':'download',
  'contact.created':'users','contact.updated':'edit','contact.merged':'users','contact.deleted':'close',
  'article.saved':'book','article.deleted':'close',
  'ticket.restored':'restore','contact.restored':'restore','article.restored':'restore',
  'ticket.purged':'trash','contact.purged':'trash','article.purged':'trash','auth.login':'lock','auth.email_verified':'checkCircle',
  'account.profile_updated':'edit','member.updated':'users','team.created':'users','settings.updated':'settings',
  'backup.created':'download','channel.message_received':'mail','channel.failed':'close','channel.accepted':'checkCircle'};

function auditIcon(action){return auditIcons[action]||auditGroups[auditEventGroup(action)].icon;}

function auditEventGroup(action){
  return action.startsWith('ai.')?'ai'
    :/^(auth|account|member|tenant|registration|team)\./.test(action)?'security'
    :/settings|channel|oauth|backup|export/.test(action)?'settings':'work';
}

// A removal is not the same as a reply: the log says so at a glance.
function auditTone(action){return /\.(deleted|purged|suspended|failed|revoked)/.test(action)?'danger':auditEventGroup(action);}

/* The audit row points at what it changed, so a question ("who closed this case?") ends on the case itself. */
function auditLink(event){
  const [kind]=event.action.split('.');
  if(/\.(deleted|purged)$/.test(event.action))return '';
  if(kind==='ticket')return `#tickets/${event.entity}`;
  if(kind==='message'||kind==='conversation'||kind==='line')return `#inbox/${event.entity}`;
  if(kind==='article')return `#knowledge/${event.entity}`;
  if(kind==='contact')return `#tickets?contact=${event.entity}`;
  return '';
}

// What actually changed on a case, in words: "สถานะ: ใหม่ → กำลังดำเนินการ".
const auditFieldLabels={status:'สถานะ',priority:'ความเร่งด่วน',team_id:'ทีม',assignee_id:'ผู้รับผิดชอบ'};

function auditChanges(event){
  if(event.action!=='ticket.updated'||!event.detail)return '';
  let changes;
  try{changes=JSON.parse(event.detail);}catch{return event.detail;}
  const name=(field,value)=>field==='status'?statusLabels[value]||value:field==='priority'?priorityLabels[value]||value
    :field==='assignee_id'?(value?memberName(value):'ยังไม่มอบหมาย'):state.work?.teams.find(t=>t.id===value)?.name||value||'-';
  return Object.entries(changes).map(([field,change])=>`${auditFieldLabels[field]||field}: ${name(field,change.before)} → ${name(field,change.after)}`).join(' · ');
}

function auditEntityName(event){
  if(/\.(deleted|purged|restored)$/.test(event.action)&&event.detail)return event.detail;
  return event.entity_display&&event.entity_display!=='รายการที่เกี่ยวข้อง'?event.entity_display:'';
}

function auditEvents(){
  const f=uiState.audit,term=(f.actor||'').toLowerCase();
  return (state.auditEvents||[]).filter(e=>{
    const label=auditEventLabels[e.action]||eventLabels[e.action]||e.action;
    return (!term||[e.actor_display,e.actor,label,auditEntityName(e)].some(v=>String(v||'').toLowerCase().includes(term)))
      &&(!f.group||auditEventGroup(e.action)===f.group)
      &&(!f.from||new Date(e.created_at)>=new Date(f.from+'T00:00:00'))
      &&(!f.to||new Date(e.created_at)<=new Date(f.to+'T23:59:59.999'));
  });
}

/* Events are read newest first, in days: the header answers "when", the rows answer "what". */
function auditHTML(events){
  if(!events.length)return render('pages/audit/audit-empty');
  const days=new Map();
  for(const e of events){
    const when=new Date(e.created_at),key=when.toDateString();
    (days.get(key)??days.set(key,{when,list:[]}).get(key)).list.push(e);
  }
  return [...days.values()].map(day=>render('pages/audit/audit-day',{label:dayLabel(day.when),count:day.list.length,
    items:day.list.map(e=>{
      const group=auditEventGroup(e.action),href=auditLink(e),name=auditEntityName(e);
      return render('pages/audit/audit-event',{tone:auditTone(e.action),groupLabel:auditGroups[group].label,icon:icon(auditIcon(e.action)),
        actor:e.actor,actorName:e.actor_display||(/^[a-f0-9]{32}$/.test(e.actor)?'ผู้ใช้งาน':e.actor),
        label:auditEventLabels[e.action]||eventLabels[e.action]||'อัปเดตรายการ',
        entityName:name,entityHref:name?href:'',changes:auditChanges(e),
        time:clockTime.format(new Date(e.created_at)),full:date(e.created_at,true),iso:e.created_at});
    }).join('')})).join('');
}

function auditPage(events){
  if(events)state.auditEvents=events;
  const f=uiState.audit,visible=auditEvents();
  const counts=kind=>(state.auditEvents||[]).filter(e=>!kind||auditEventGroup(e.action)===kind).length;
  const slice=paginate('audit',visible,{size:25,refresh:refreshAudit});
  return render('pages/audit/audit',{from:f.from||'',to:f.to||'',count:visible.length,
    filtered:Boolean(f.actor||f.group||f.from||f.to),
    search:searchInput('audit-search','ค้นหาในประวัติการทำงาน','ค้นหาชื่อผู้ทำ กิจกรรม หรือรายการ',f.actor||''),
    groupPills:[['','ทั้งหมด'],...Object.entries(auditGroups).map(([key,meta])=>[key,meta.label])]
      .filter(([key])=>!key||counts(key)||f.group===key)
      .map(([key,label])=>filterPill('audit-group',key,label,{pressed:(f.group||'')===key,count:counts(key)})).join(''),
    events:auditHTML(slice.shown)+(visible.length?pagerHTML(slice,'กิจกรรม',[25,50,100]):'')});
}

function refreshAudit(){const host=$('#page');if(host&&state.route==='audit')host.innerHTML=auditPage();}

Object.assign(actions,{
  'clear-audit':async(button,id)=>{uiState.audit={};goToPage('audit',1);refreshAudit();return;},
  'audit-group':async(button,id)=>{uiState.audit={...uiState.audit,group:button.dataset.value};goToPage('audit',1);refreshAudit();return;},
});

document.addEventListener('input',event=>{
  if(event.target.id!=='audit-search')return;
  uiState.audit={...uiState.audit,actor:event.target.value};goToPage('audit',1);refreshAudit();
  $('#audit-search')?.focus();
});
document.addEventListener('change',event=>{
  const node=event.target;
  if(node.id!=='audit-from'&&node.id!=='audit-to')return;
  const key=node.id==='audit-from'?'from':'to';
  uiState.audit={...uiState.audit,[key]:node.value};goToPage('audit',1);refreshAudit();
  $('#'+node.id)?.focus();
});
