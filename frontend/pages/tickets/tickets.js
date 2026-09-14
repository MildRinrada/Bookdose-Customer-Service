/* Cases: list with filters, selection and bulk actions, quick row actions and quick view, CSV; case detail; new-case form.
   Markup: pages/tickets/, ui/search-input.html, ui/filter-select.html; the conversation itself comes from pages/inbox/. */

'use strict';

function newTicketButton(){return render('pages/tickets/new-ticket-button');}

const ticketScopes={all:'ทุกเคส',active:'กำลังดูแล',mine:'งานของฉัน',overdue:'⚠ เกิน SLA',resolved_today:'แก้ไขสำเร็จวันนี้'};

function inScope(t,scope){
  return !scope||scope==='all'||(scope==='active'&&!isDone(t))||(scope==='mine'&&!isDone(t)&&t.assignee_id===state.boot.user.id)
    ||(scope==='overdue'&&overdue(t))||(scope==='resolved_today'&&isDone(t)&&new Date(t.resolved_at).toDateString()===new Date().toDateString());
}

// Search, customer, status and priority; the scope (all / mine / overdue …) is applied on top of them.
function matchesTicketFilters(t){
  const f=state.filter,q=(f.q||'').toLowerCase();
  return (!q||[t.subject,t.contact_name,t.company,`BD-${t.number}`,t.category].some(v=>String(v).toLowerCase().includes(q)))
    &&(!f.contact||t.contact_id===f.contact)&&(!f.status||t.status===f.status)&&(!f.priority||t.priority===f.priority);
}

function filteredTickets(){return state.tickets.filter(t=>matchesTicketFilters(t)&&inScope(t,state.filter.filter));}

function ticketsPage(){
  const visible=filteredTickets();
  return render('pages/tickets/tickets',{newTicketButton:newTicketButton(),
    search:searchInput('ticket-search','ค้นหาเคส','ค้นหาหมายเลขเคส เรื่อง หรือลูกค้า',state.filter.q||''),
    statusFilter:filterSelect('ticket-status','กรองสถานะ',options(statusLabels,state.filter.status),'ทุกสถานะ'),
    priorityFilter:filterSelect('ticket-priority','กรองความเร่งด่วน',options(priorityLabels,state.filter.priority),'ทุกความเร่งด่วน'),
    toolbar:ticketToolbar(visible.length),table:ticketTable(visible)});
}

function refreshTicketFilter(){const visible=filteredTickets(),ids=new Set(visible.map(t=>t.id));uiState.selected=new Set([...uiState.selected].filter(id=>ids.has(id)));$('#ticket-table').innerHTML=ticketTable(visible);updateTicketToolbar(visible);}

/* The scope filters are pills with a count, the same control the other screens use; they live in the address
   so a filtered list can be shared. */
function ticketScopePills(){
  const matching=state.tickets.filter(matchesTicketFilters),current=state.filter.filter||'all';
  const keep=Object.entries(state.filter).filter(([key,value])=>key!=='filter'&&value).map(([key,value])=>`${key}=${encodeURIComponent(value)}`);
  return Object.entries(ticketScopes).map(([scope,label])=>{
    const query=[...keep,...(scope==='all'?[]:[`filter=${scope}`])].join('&');
    return filterLink('#tickets'+(query?'?'+query:''),scope,label,{active:current===scope,count:matching.filter(t=>inScope(t,scope)).length});
  }).join('');
}

function ticketToolbar(count){
  return render('pages/tickets/ticket-toolbar',{densityOptions:options({comfortable:'อ่านสบาย',compact:'กระชับ'},uiState.density),count,
    selectedCount:uiState.selected.size,bulkAssignOptions:bulkAssignOptions(),scopePills:ticketScopePills(),
    filtered:Boolean(state.filter.q||state.filter.status||state.filter.priority||state.filter.contact||(state.filter.filter&&state.filter.filter!=='all')),
    contactName:state.filter.contact?(state.tickets.find(t=>t.contact_id===state.filter.contact)?.contact_name||'ที่เลือก'):''});
}

/* Selecting cases swaps the filter bar for the bulk-action bar; this keeps both in step with the selection and filters. */
function updateTicketToolbar(visible=filteredTickets()){
  const count=uiState.selected.size,bulk=$('[data-bulk-bar]');if(!bulk)return;
  bulk.hidden=!count;$('[data-filter-bar]').hidden=count>0;
  $('[data-selection-count]').textContent=`เลือก ${count} เคส`;
  $('[data-bulk-assign]').innerHTML=bulkAssignOptions();
  $('#ticket-count').textContent=`${visible.length} เคส`;
  const chips=$('.filter-chips');if(chips)chips.innerHTML=ticketScopePills();
  const all=$('[data-select-all]');if(all){const picked=visible.filter(t=>uiState.selected.has(t.id)).length;all.checked=picked>0&&picked===visible.length;all.indeterminate=picked>0&&picked<visible.length;}
}

// An assignee must belong to the case's team, so members are offered only when every selected case is in one team.
function bulkAssignOptions(){
  const teams=new Set(state.tickets.filter(t=>uiState.selected.has(t.id)).map(t=>t.team_id));
  const members=teams.size===1?state.work.members.filter(m=>m.active&&teams.has(m.team_id)):[];
  return option('',teams.size>1?'มอบหมาย: เลือกเคสจากทีมเดียวกัน':'เปลี่ยนผู้รับผิดชอบ…',true)+option('none','ยกเลิกการมอบหมาย')+members.map(m=>option(m.id,m.name)).join('');
}

async function bulkUpdateTickets(changes,message){
  const picked=state.tickets.filter(t=>uiState.selected.has(t.id)),failed=[];
  const pending=picked.filter(t=>Object.entries(changes).some(([key,value])=>(t[key]||'')!==(value||'')));
  const controls=$$('[data-bulk-bar] button,[data-bulk-bar] select');controls.forEach(n=>n.disabled=true);
  try{for(const t of pending){try{await api(`/api/tickets/${t.id}`,changes,'PATCH');}catch(error){failed.push({t,error});}}}
  finally{
    state.tickets=(await api('/api/tickets')).tickets;
    uiState.selected=new Set(failed.map(f=>f.t.id));
    controls.forEach(n=>n.disabled=false);
    if(state.route==='tickets'&&!state.detail)refreshTicketFilter();
  }
  if(failed.length)throw new Error(`${message} ${pending.length-failed.length} จาก ${pending.length} เคส · BD-${failed[0].t.number}: ${failed[0].error.message}`);
  toast(`${message} · ${picked.length} เคส`);
}

// How long a case has been past its SLA ('' when it isn't), e.g. '2 ชม.'.
function lateBy(t){
  if(!overdue(t))return '';
  const due=[!t.first_response_at&&t.first_response_due_at,t.resolution_due_at].filter(d=>d&&new Date(d)<new Date()).map(d=>new Date(d).getTime());
  const min=Math.max(1,Math.floor((Date.now()-Math.min(...due))/60000));
  return min<60?`${min} นาที`:min<1440?`${Math.floor(min/60)} ชม.`:`${Math.floor(min/1440)} วัน`;
}

function ticketTable(tickets,compact=false){
  if(!tickets.length)return empty('ยังไม่มีเคสในรายการนี้','ลองล้างตัวกรองหรือเปิดเคสใหม่','ticket');
  const selectable=!compact&&state.route==='tickets'&&!state.detail;
  // The overview shows a short list; the cases screen pages through everything that matches.
  const slice=compact?null:paginate('tickets',tickets,{size:25,refresh:refreshTicketFilter});
  const rows=(slice?slice.shown:tickets).map((t,i)=>render('pages/tickets/ticket-row',{id:t.id,number:t.number,subject:t.subject,category:t.category,
    customer:t.contact_name,company:t.company||'-',avatar:avatar(t.contact_name,i),status:badge(t.status),priority:priority(t.priority),
    assignee:memberName(t.assignee_id),late:lateBy(t),updated:date(t.updated_at),compact,selectable,selected:uiState.selected.has(t.id),
    escalated:t.escalated_at&&!isDone(t)?escalationReasons[t.escalation_reason]||'ยกระดับแล้ว':'',
    actions:state.work?ticketQuickActions(t,compact):''})).join('');
  return render('pages/tickets/ticket-table',{density:uiState.density,compact,selectable,rows,pager:slice?pagerHTML(slice,'เคส'):''});
}

function ticketPreview(data){
  const t=data.ticket,c=data.contact,messages=data.conversations.flatMap(conv=>conv.messages).sort((a,b)=>a.created_at.localeCompare(b.created_at)).slice(-3);
  return render('pages/tickets/ticket-preview',{id:t.id,subject:t.subject,category:t.category,created:date(t.created_at,true),status:badge(t.status),priority:priority(t.priority),
    assignee:memberName(t.assignee_id),team:state.work.teams.find(team=>team.id===t.team_id)?.name||'-',resolutionDue:date(t.resolution_due_at,true),late:lateBy(t),
    contactName:c.name,contactEmail:c.email||'-',contactPhone:c.phone||'-',messages:messagesHTML(messages)});
}

/* Row quick actions: revealed on hover/focus so common changes don't require opening the case.
   Each dropdown starts with only the value it shows; the rest of the list is built the first time the row is
   reached, which keeps a page of 25 rows from creating hundreds of options nobody opens. */
function ticketQuickActions(t,menu=false){
  const me=state.boot.user.id,canClaim=!isDone(t)&&t.assignee_id!==me&&state.work.members.some(m=>m.id===me&&m.active&&m.team_id===t.team_id);
  return render('pages/tickets/ticket-quick-actions',{id:t.id,number:t.number,canClaim,menu,
    statusOptions:option(t.status,statusLabels[t.status],true),assigneeOptions:option(t.assignee_id||'',memberName(t.assignee_id),true)});
}

function fillQuickSelect(select){
  const ticket=state.tickets.find(t=>t.id===select.dataset.id);
  if(!ticket)return;
  select.innerHTML=select.dataset.quick==='status'?options(statusLabels,ticket.status):assigneeOptions(ticket.team_id,ticket.assignee_id||'');
  delete select.dataset.lazy;
}

function fillRowQuickSelects(node){
  const row=node?.closest?.('tr');
  if(row)$$('[data-quick][data-lazy]',row).forEach(fillQuickSelect);
}

document.addEventListener('pointerover',event=>fillRowQuickSelects(event.target),{passive:true});
document.addEventListener('focusin',event=>fillRowQuickSelects(event.target));

// Native popovers support click-away dismissal and Escape without covering the row on hover.
document.addEventListener('toggle',event=>{
  const menu=event.target;
  if(!menu.matches?.('.dashboard-quick-menu')||event.newState!=='open')return;
  const button=document.querySelector(`[popovertarget="${menu.id}"]`);
  if(!button)return;
  fillRowQuickSelects(button);
  const anchor=button.getBoundingClientRect(),box=menu.getBoundingClientRect(),gap=6,edge=12;
  menu.style.left=`${Math.max(edge,Math.min(anchor.right-box.width,innerWidth-box.width-edge))}px`;
  const below=anchor.bottom+gap;
  menu.style.top=`${Math.max(edge,Math.min(below+box.height<=innerHeight-edge?below:anchor.top-box.height-gap,innerHeight-box.height-edge))}px`;
},true);
window.addEventListener('resize',()=>document.querySelectorAll('.dashboard-quick-menu:popover-open').forEach(menu=>menu.hidePopover()));
document.addEventListener('click',event=>{
  if(event.target.closest('[data-action="ticket-preview"]'))event.target.closest('.dashboard-quick-menu:popover-open')?.hidePopover();
},true);

async function quickUpdateTicket(id,changes,message){
  const number=state.tickets.find(t=>t.id===id)?.number,focused=document.activeElement?.closest('.row-actions')?document.activeElement.dataset.quick||'claim':null;
  document.querySelectorAll(`.row-actions [data-id="${id}"]`).forEach(n=>n.disabled=true);
  try{await api(`/api/tickets/${id}`,changes,'PATCH');toast(`${message} · BD-${number}`);}
  finally{
    state.tickets=(await api('/api/tickets')).tickets;
    if(state.route==='tickets'&&!state.detail)refreshTicketFilter();
    else if(state.route==='dashboard'){const tab=document.querySelector('[data-action="dashboard-tab"].active')?.dataset.filter;document.querySelector('#page').innerHTML=dashboard();if(tab&&tab!=='all')document.querySelector(`[data-action="dashboard-tab"][data-filter="${tab}"]`)?.click();}
    if(focused)(document.querySelector(`[popovertarget="dashboard-actions-${id}"]`)||document.querySelector(`.row-actions [data-id="${id}"][data-quick="${focused}"]`)||document.querySelector(`.row-actions [data-id="${id}"]`))?.focus();
  }
}

function downloadTicketsCSV(tickets,filename){
  const rows=[['Case','Subject','Customer','Status','Priority','Assignee','Created at'],...tickets.map(t=>['BD-'+t.number,t.subject,t.contact_name,statusLabels[t.status],priorityLabels[t.priority],memberName(t.assignee_id),t.created_at])];
  const content='\ufeff'+rows.map(row=>row.map(value=>{let s=String(value??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function ticketDetail(data){
  const t=data.ticket,c=data.contact,extra=data.automation||{followups:[],escalation:null,survey:null},e=extra.escalation;
  return render('pages/tickets/ticket-detail',{canDelete:state.work.role==='admin',id:t.id,subject:t.subject,number:t.number,created:date(t.created_at,true),category:t.category,status:badge(t.status),priorityTag:priority(t.priority),
    conversations:data.conversations.map(conv=>render('pages/tickets/ticket-conversation',{id:conv.id,channelBadge:channelBadge(conv.channel),
      contactName:c.name,messages:messagesHTML(conv.messages),threadFilter:threadFilterHTML(conv.messages),composer:composer(conv.id,{manual:conv.channel==='manual',channel:conv.channel})})).join(''),
    macroButtons:macroButtons({kind:'ticket',id:t.id}),canManage:state.work.role!=='agent',
    followups:followupsHTML(extra.followups),followupOptions:options(followupChoices,'24'),survey:surveyHTML(extra.survey),
    escalation:e?`${escalationReasons[e.reason]||'ยกระดับแล้ว'}${e.to_user_id?` · ${e.reason==='unclaimed'?'ย้ายให้':'แจ้ง'} ${memberName(e.to_user_id)}`:''}`:'',
    history:auditHTML(data.events),
    statusOptions:options(statusLabels,t.status),priorityOptions:options(priorityLabels,t.priority),teamOptions:teamOptions(t.team_id),assigneePicker:memberPicker('case-assignee',t.team_id,t.assignee_id||''),
    contactAvatar:avatar(c.name,2),contactName:c.name,contactId:c.id,contactEmail:c.email,contactPhone:c.phone,contactPhoneHref:String(c.phone||'').replace(/[^\d+]/g,''),contactCompany:c.company,
    firstResponse:t.first_response_at?`ตอบแล้ว ${date(t.first_response_at,true)}`:`ภายใน ${date(t.first_response_due_at,true)}`,
    resolutionDue:date(t.resolution_due_at,true),overdue:overdue(t),privacyTag:privacyTag()});
}

async function openNewTicket(contactId=''){
  state.contacts=(await api('/api/contacts')).contacts;
  if(!state.contacts.length)return contactModal(null,true);
  modal('เปิดเคสบริการใหม่',render('pages/tickets/new-ticket',{
    contactPicker:comboboxField({id:'new-contact',name:'contact_id',value:contactId,placeholder:'พิมพ์ชื่อ อีเมล หรือองค์กรเพื่อค้นหา',items:state.contacts.map(c=>({value:c.id,label:c.name,detail:[c.company,c.email].filter(Boolean).join(' · ')}))}),
    priorityOptions:options(priorityLabels,'normal'),categoryField:inputField('หมวดหมู่','category',{value:'ทั่วไป',max:80}),
    teamOptions:teamOptions(state.work.team_id),assigneePicker:memberPicker('new-assignee',state.work.team_id),formActions:formActions('เปิดเคส')}));
}

Object.assign(actions,{
  'new-ticket':async(button,id)=>{return openNewTicket();},
  'delete-ticket':async(button,id)=>{
    const t=state.detail.ticket,number=`BD-${t.number}`,conversations=state.detail.conversations.length;
    confirmDelete({title:`ลบเคส ${number}`,warning:`${number} “${t.subject}” จะถูกย้ายไปถังขยะ`,
      effects:['เคสนี้จะหายไปจากรายการเคส รายงาน และการนับ SLA ทันที',
        conversations?`บทสนทนา ${conversations} รายการจะยังอยู่ในกล่องข้อความ แต่จะไม่ผูกกับเคสนี้อีก`:'เคสนี้ยังไม่มีบทสนทนาที่ผูกอยู่',
        'กู้คืนได้จากเมนูถังขยะภายใน 30 วัน หลังจากนั้นระบบจะลบถาวร',
        'การลบจะถูกบันทึกในประวัติการทำงานพร้อมหมายเลขเคส'],
      word:number,confirmLabel:'ย้ายเคสไปถังขยะ',
      run:async()=>{await api('/api/tickets/'+id,undefined,'DELETE');toast(`ย้าย ${number} ไปถังขยะแล้ว · กู้คืนได้ที่เมนูถังขยะ`);location.hash='#tickets';}});
    return;},
  'quick-claim':async(button,id)=>{await quickUpdateTicket(id,{assignee_id:state.boot.user.id},'รับเคสแล้ว');return;},
  'ticket-preview':async(button,id)=>{const data=await api(`/api/tickets/${id}`);modal(`BD-${data.ticket.number}`,ticketPreview(data),{drawer:true});return;},
  'bulk-close':async(button,id)=>{return bulkUpdateTickets({status:'closed'},'ปิดเคสแล้ว');},
  'clear-selection':async(button,id)=>{uiState.selected.clear();refreshTicketFilter();$('[data-select-all]')?.focus();return;},
  'export-selected':async(button,id)=>{const records=filteredTickets().filter(t=>uiState.selected.has(t.id));if(!records.length)throw new Error('กรุณาเลือกเคสที่ต้องการส่งออก');downloadTicketsCSV(records,'selected-tickets.csv');return;},
  'export':async(button,id)=>{await download('/api/export/tickets.csv',`bookdose-tickets-${new Date().toISOString().slice(0,10)}.csv`);toast('ดาวน์โหลดรายงานเคสทั้งหมดตามสิทธิ์แล้ว');return;},
});

Object.assign(forms,{
  'ticket':async(form,data)=>{if(!data.contact_id)throw new Error('กรุณาเลือกลูกค้าจากรายการ');const result=await api('/api/tickets',data);closeModal();location.hash=`tickets/${result.id}`;toast('เปิดเคสเรียบร้อยแล้ว');return;},
  'ticket-update':async(form,data)=>{await api(`/api/tickets/${form.dataset.id}`,data,'PATCH');toast('บันทึกเคสเรียบร้อยแล้ว');await route();return;},
});

document.addEventListener('input',event=>{const n=event.target;if(n.id==='ticket-search'){state.filter.q=n.value;goToPage('tickets',1);refreshTicketFilter();}});
document.addEventListener('change',event=>{const n=event.target;
  try{
    if(n.id==='ticket-status'){state.filter.status=n.value;goToPage('tickets',1);refreshTicketFilter();}
    if(n.id==='ticket-priority'){state.filter.priority=n.value;goToPage('tickets',1);refreshTicketFilter();}
    if(n.name==='team_id')refreshMemberPicker(n.closest('form'),n.value);
  }catch(error){toast(error.message,true);}
  if(n.matches('[data-density]')){uiState.density=n.value;refreshTicketFilter();}
  if(n.matches('[data-quick]'))quickUpdateTicket(n.dataset.id,{[n.dataset.quick]:n.value},n.dataset.quick==='status'?`เปลี่ยนสถานะเป็น “${statusLabels[n.value]}” แล้ว`:n.value?`มอบหมายให้ ${memberName(n.value)} แล้ว`:'ยกเลิกการมอบหมายแล้ว').catch(error=>toast(error.message,true));
  if(n.matches('[data-bulk-assign]')&&n.value){const value=n.value==='none'?'':n.value;bulkUpdateTickets({assignee_id:value},value?`มอบหมายให้ ${memberName(value)} แล้ว`:'ยกเลิกการมอบหมายแล้ว').catch(error=>toast(error.message,true));}
  if(n.matches('[data-ticket-select]')){n.checked?uiState.selected.add(n.dataset.ticketSelect):uiState.selected.delete(n.dataset.ticketSelect);updateTicketToolbar();}
  if(n.matches('[data-select-all]')){filteredTickets().forEach(t=>n.checked?uiState.selected.add(t.id):uiState.selected.delete(t.id));document.querySelectorAll('[data-ticket-select]').forEach(c=>c.checked=n.checked);updateTicketToolbar();}
});
