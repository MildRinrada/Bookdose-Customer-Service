/* Platform admin: every organization on this installation - who is running, who is suspended, how many people
   are inside, and the way to their support page. One list with the search, pills and pager every other screen
   uses, plus the platform's own activity underneath.
   Markup: pages/platform/, ui/search-input.html, ui/filter-pill.html, ui/pager.html. */

'use strict';

// The same words as the badge in the row, so a filter and a row never describe the same state differently.
const tenantStatusLabels={active:'เปิดใช้งาน',suspended:'ระงับใช้งาน'};

function platformTenants(){
  const f=uiState.platform,term=(f.q||'').toLowerCase();
  return (state.platformData?.tenants||[])
    .filter(t=>(!f.status||t.status===f.status)&&(!term||[t.name,t.slug].some(v=>String(v||'').toLowerCase().includes(term))))
    .sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
}

function platformPage(data){
  if(data)state.platformData=data;
  const f=uiState.platform,all=state.platformData.tenants||[];
  const counts=status=>all.filter(t=>!status||t.status===status).length;
  const members=all.reduce((total,t)=>total+t.member_count,0);
  return render('pages/platform/platform',{organizations:platformRows(),history:auditHTML((state.platformData.audit||[]).slice(0,30)),
    total:all.length,members,
    search:searchInput('platform-search','ค้นหาองค์กร','ค้นหาชื่อหรือรหัสองค์กร',f.q||''),
    statusPills:[['','ทั้งหมด'],...Object.entries(tenantStatusLabels)]
      .map(([status,label])=>filterPill('platform-filter',status,label,{pressed:(f.status||'')===status,count:counts(status),warning:status==='suspended'})).join('')});
}

/* The rows and the pager are redrawn together, so the count under the table always matches what is above it. */
function platformRows(){
  const visible=platformTenants();
  const slice=paginate('platform',visible,{size:25,refresh:refreshPlatform});
  return render('pages/platform/platform-table',{count:visible.length,
    rows:slice.shown.map((t,i)=>render('pages/platform/platform-row',{id:t.id,name:t.name,slug:t.slug,avatar:avatar(t.name,slice.start+i),
      created:date(t.created_at),members:t.member_count,status:badge(t.status),active:t.status==='active',
      nextStatus:t.status==='active'?'suspended':'active',...tenantAccess(t)})).join(''),
    pager:visible.length?pagerHTML(slice,'องค์กร',[25,50,100]):'',
    empty:visible.length?'':empty('ไม่พบองค์กรตามตัวกรอง','ลองเปลี่ยนคำค้น หรือเลือกสถานะ “ทั้งหมด”','globe')});
}

/* Platform rights manage organizations; reading their cases needs a membership. Each row says which applies to you. */
function tenantAccess(t){
  const membership=state.boot.memberships.find(m=>m.id===t.id);
  if(membership?.status==='active'&&t.status==='active')return t.id===state.boot.tenant_id&&state.work?{current:true}:{canOpen:true};
  if(!membership)return {noAccess:'ไม่ได้เป็นสมาชิก',canRequest:t.status==='active'};
  return {noAccess:t.status==='active'?'ผู้ดูแลองค์กรปิดสิทธิ์ของคุณไว้':'เปิดไม่ได้ขณะองค์กรถูกระงับ'};
}

function refreshPlatform(){const host=$('#platform-organizations');if(host)host.innerHTML=platformRows();}

Object.assign(actions,{
  'platform-filter':async(button,id)=>{uiState.platform={...uiState.platform,status:button.dataset.value};goToPage('platform',1);
    $$('[data-action="platform-filter"]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));refreshPlatform();return;},
  'tenant-status':async(button,id)=>{
    const suspending=button.dataset.status==='suspended';
    modal(suspending?'ยืนยันการระงับองค์กร':'เปิดใช้งานองค์กร',render('pages/platform/tenant-status',{id,status:button.dataset.status,suspending,name:button.dataset.name,
      confirmField:suspending?inputField('พิมพ์ CONFIRM หรือชื่อองค์กรเพื่อยืนยัน','confirmation',{placeholder:'CONFIRM',max:100}):'',formActions:formActions(suspending?'ยืนยันระงับองค์กร':'เปิดใช้งาน')}));
  },
  'new-tenant':async(button,id)=>{return modal('สร้างองค์กรใหม่',render('pages/platform/new-tenant',{
    nameField:inputField('ชื่อองค์กร','name',{max:100}),slugField:inputField('รหัสองค์กร (a-z, 0-9, -)','slug',{max:60}),adminNameField:inputField('ชื่อผู้ดูแลองค์กร','admin_name',{max:100}),
    emailField:inputField('อีเมลผู้ดูแล','email',{type:'email',max:254}),passwordField:inputField('รหัสผ่านเริ่มต้น (กรอกสำหรับบัญชีใหม่)','password',{type:'password',required:false,max:200}),formActions:formActions('สร้างองค์กร')}));},
  'open-tenant':async(button,id)=>{return switchTenant(id);},
  'support-access':async(button,id)=>{return modal('ขอสิทธิ์ Support Access',render('pages/platform/support-access',{id,name:button.dataset.name,
    reasonField:inputField('เหตุผลที่ต้องเข้าดูข้อมูล (เช่น เลขคำร้อง หรือปัญหาที่ต้องตรวจสอบ)','reason',{max:300}),formActions:formActions('ยืนยันและเข้าองค์กร')}));},
  'copy-portal-link':async(button,id)=>{await copyText(`${location.origin}/support/${button.dataset.slug}`);return;},
});

Object.assign(forms,{
  'tenant':async(form,data)=>{await api('/api/platform/tenants',data);closeModal();toast('สร้างองค์กรเรียบร้อยแล้ว');await route();return;},
  'support-access':async(form,data)=>{
    await api(`/api/platform/tenants/${form.dataset.id}/support-access`,{reason:data.reason});
    closeModal();toast('เพิ่มสิทธิ์ Support Access และบันทึกใน audit log แล้ว');await switchTenant(form.dataset.id);return;},
  'tenant-status':async(form,data)=>{await api(`/api/platform/tenants/${form.dataset.id}`,{status:form.dataset.status,confirmation:data.confirmation},'PATCH');closeModal();toast('เปลี่ยนสถานะองค์กรแล้ว');await route();return;},
});

document.addEventListener('input',event=>{
  if(event.target.id!=='platform-search')return;
  uiState.platform={...uiState.platform,q:event.target.value};goToPage('platform',1);refreshPlatform();
  $('#platform-search')?.focus();
});
