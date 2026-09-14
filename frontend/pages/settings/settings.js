/* Organization settings, in four sections a person can point at: the organization and how it promises to serve,
   the people who do the work, the channels customers write from, and the AI assistant. Each section is one panel;
   only the panel being read is in the page.
   Markup: pages/settings/, ui/search-input.html, ui/filter-pill.html, ui/pager.html. */

'use strict';

const settingsTabs={
  overview:{label:'ภาพรวมและบริการ',hint:'ข้อมูลองค์กร มาตรฐาน SLA และข้อความอัตโนมัติ',icon:'settings'},
  teams:{label:'ทีมและสมาชิก',hint:'ใครอยู่ทีมไหน และมีสิทธิ์แค่ไหน',icon:'users'},
  connections:{label:'LINE / Email / Facebook',hint:'ช่องทางที่ลูกค้าติดต่อเข้ามา',icon:'inbox'},
  ai:{label:'AI Assistant',hint:'ผู้ช่วยร่างคำตอบและแชทบอทหน้าช่วยเหลือ',icon:'sparkle'},
};

function settingsPage(){
  const w=state.work,s=w.settings,requested=new URLSearchParams(location.hash.split('?')[1]||'').get('tab');
  if(requested in settingsTabs)uiState.settingsTab=requested;
  const current=uiState.settingsTab;
  return render('pages/settings/settings',{
    tabs:Object.entries(settingsTabs).map(([key,meta])=>render('pages/settings/settings-tab',
      {key,label:meta.label,hint:meta.hint,icon:icon(meta.icon),active:key===current})).join(''),
    tab:{[current]:true},
    tenantName:w.tenant.name,tenantSlug:w.tenant.slug,origin:location.origin,roleLabel:roleLabels[w.role],
    orgAvatar:avatar(w.tenant.name,1),memberCount:w.members.filter(m=>m.active).length,teamCount:w.teams.length,
    responseHours:s.response_hours,channelSummary:channelSummaryHTML(),welcome:s.welcome,cannedReply:s.canned_reply,
    responseHoursField:inputField('ตอบกลับครั้งแรกภายใน (ชม.)','response_hours',{type:'number',value:s.response_hours}),
    resolutionHoursField:inputField('แก้ไขเคสภายใน (ชม.)','resolution_hours',{type:'number',value:s.resolution_hours}),
    membersPanel:membersPanel(),
    teamCards:w.teams.map(t=>render('pages/settings/team-row',{name:t.name,members:w.members.filter(m=>m.active&&m.team_id===t.id).length})).join(''),
    channelPanels:channelSettingsPanel()+facebookSettingsPanel(),aiPanel:aiSettingsPanel()});
}

/* The member list is a list like any other in the app: the same search box, the same filter pills and the same
   pager, so an organization with two hundred people reads as easily as one with five. */
function settingsMembers(){
  const f=uiState.members,term=(f.q||'').toLowerCase();
  return state.work.members.filter(m=>(!f.role||m.role===f.role)
    &&(!term||[m.name,m.email].some(v=>String(v||'').toLowerCase().includes(term))));
}

function membersPanel(){
  const f=uiState.members,all=state.work.members,visible=settingsMembers();
  const counts=role=>all.filter(m=>!role||m.role===role).length;
  const slice=paginate('members',visible,{size:25,refresh:refreshMembers});
  return render('pages/settings/members-panel',{count:visible.length,total:all.length,
    search:searchInput('member-search','ค้นหาสมาชิก','ค้นหาชื่อหรืออีเมล',f.q||''),
    pills:[['','ทั้งหมด'],...Object.entries(roleLabels)].filter(([key])=>!key||counts(key)||f.role===key)
      .map(([key,label])=>filterPill('member-role',key,label,{pressed:(f.role||'')===key,count:counts(key)})).join(''),
    rows:slice.shown.map((m,i)=>render('pages/settings/member-row',{id:m.id,avatar:avatar(m.name,slice.start+i),name:m.name,email:m.email,
      role:roleLabels[m.role],team:state.work.teams.find(t=>t.id===m.team_id)?.name||'-',
      status:badge(m.active?'active':'suspended'),suspended:!m.active})).join(''),
    pager:visible.length?pagerHTML(slice,'สมาชิก',[25,50,100]):'',
    empty:visible.length?'':empty('ไม่พบสมาชิกที่ค้นหา','ลองเปลี่ยนคำค้น หรือเลือกบทบาท “ทั้งหมด”','users')});
}

function refreshMembers(){const host=$('#members-panel');if(host)host.innerHTML=membersPanel();}

function memberModal(member){
  const m=member||{};
  modal(member?'จัดการสมาชิก':'เพิ่มสมาชิกใหม่',render('pages/settings/member',{id:m.id||'',existing:!!member,name:m.name,email:m.email,active:m.active,
    nameField:member?'':inputField('ชื่อสมาชิก','name',{max:100}),emailField:member?'':inputField('อีเมล','email',{type:'email',max:254}),
    passwordField:member?'':inputField('รหัสผ่านเริ่มต้น','password',{type:'password',max:200}),
    roleOptions:options(roleLabels,m.role||'agent'),teamOptions:teamOptions(m.team_id||state.work.team_id),formActions:formActions()}));
}

Object.assign(actions,{
  'settings-tab':async(button,id)=>{uiState.settingsTab=button.dataset.tab;document.querySelectorAll('[role="tabpanel"]').forEach(p=>p.hidden=p.id!=='settings-'+uiState.settingsTab);document.querySelectorAll('.settings-nav [role="tab"]').forEach(b=>{const selected=b.dataset.tab===uiState.settingsTab;b.classList.toggle('active',selected);b.setAttribute('aria-selected',String(selected));});history.replaceState(null,'','#settings?tab='+uiState.settingsTab);return;},
  'new-team':async(button,id)=>{return modal('เพิ่มทีมใหม่',render('pages/settings/new-team',{nameField:inputField('ชื่อทีม','name',{max:100}),formActions:formActions('เพิ่มทีม')}));},
  'new-member':async(button,id)=>{return memberModal();},
  'edit-member':async(button,id)=>{return memberModal(state.work.members.find(m=>m.id===id));},
  'member-role':async(button,id)=>{uiState.members={...uiState.members,role:button.dataset.value};goToPage('members',1);refreshMembers();return;},
  'backup':async(button,id)=>{button.disabled=true;try{await download('/api/backup',`bookdose-${state.work.tenant.slug}-backup.zip`);toast('ดาวน์โหลดไฟล์สำรองแล้ว');}finally{button.disabled=false;}return;},
  'copy-portal':async(button,id)=>{await copyText(`${location.origin}/support/${state.work.tenant.slug}`);return;},
});

Object.assign(forms,{
  'settings':async(form,data)=>{await api('/api/settings',data,'PATCH');toast('บันทึกการตั้งค่าแล้ว');await route();return;},
  'team':async(form,data)=>{await api('/api/teams',data);closeModal();toast('เพิ่มทีมแล้ว');await route();return;},
  'member':async(form,data)=>{const id=form.dataset.id;if(id)data.active=$('[name="active"]',form).checked;await api(`/api/members${id?'/'+id:''}`,data,id?'PATCH':'POST');closeModal();toast('บันทึกสมาชิกแล้ว');await route();return;},
});

document.addEventListener('input',event=>{
  if(event.target.id!=='member-search')return;
  uiState.members={...uiState.members,q:event.target.value};goToPage('members',1);refreshMembers();
  $('#member-search')?.focus();
});
