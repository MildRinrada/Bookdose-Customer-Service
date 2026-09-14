/* Customers: table with search, quick filters, organization filter, sorting (name, contact, cases, last contact) and pages; row quick actions;
   add/edit form with a duplicate-email warning; per-customer case history; merging duplicates.
   Markup: pages/contacts/, ui/filter-pill.html, ui/search-input.html, ui/filter-select.html. */

'use strict';

const contactTagLabels={all:'ทั้งหมด',open:'มีเคสค้าง',late:'เกิน SLA',duplicate:'อีเมลซ้ำ'};

const emailKey=c=>(c.email||'').trim().toLowerCase();

// Emails used by more than one contact. Visitor emails aren't verified, so staff merge duplicates themselves; nothing merges automatically.
function duplicateEmails(){
  const seen=new Map();
  state.contacts.forEach(c=>{const key=emailKey(c);if(key)seen.set(key,(seen.get(key)||0)+1);});
  return new Set([...seen].filter(([,count])=>count>1).map(([key])=>key));
}

function contactTicketStats(){
  const stats=new Map(state.contacts.map(c=>[c.id,{total:0,open:0,late:0,last:''}]));
  state.tickets.forEach(t=>{const s=stats.get(t.contact_id);if(!s)return;s.total++;if(!isDone(t))s.open++;if(overdue(t))s.late++;if(t.updated_at>s.last)s.last=t.updated_at;});
  return stats;
}

// Name, email and organization sort alphabetically; cases and the last contact put the rows that need attention first.
function compareContacts(a,b,stats){
  const key=uiState.contactSort;
  if(key==='cases'){const x=stats.get(a.id),y=stats.get(b.id);return (y.open-x.open)||(y.total-x.total);}
  if(key==='last')return String(stats.get(b.id).last).localeCompare(String(stats.get(a.id).last));
  return String(a[key]||'').localeCompare(String(b[key]||''),'th');
}

function matchesContactFilters(c,stats,duplicates){
  const q=uiState.contactQuery.toLowerCase(),s=stats.get(c.id),tag=uiState.contactFilter;
  return (!q||[c.name,c.email,c.company,c.phone].some(v=>String(v||'').toLowerCase().includes(q)))
    &&(!uiState.contactCompany||c.company===uiState.contactCompany)
    &&(tag==='all'||(tag==='open'&&s.open>0)||(tag==='late'&&s.late>0)||(tag==='duplicate'&&duplicates.has(emailKey(c))));
}

function contactsPage(){
  uiState.contactQuery='';
  const stats=contactTicketStats(),duplicates=duplicateEmails();
  const counts={all:state.contacts.length,open:state.contacts.filter(c=>stats.get(c.id).open).length,late:state.contacts.filter(c=>stats.get(c.id).late).length,duplicate:state.contacts.filter(c=>duplicates.has(emailKey(c))).length};
  if(!counts.duplicate&&uiState.contactFilter==='duplicate')uiState.contactFilter='all';
  const tags=Object.entries(contactTagLabels).filter(([key])=>key!=='duplicate'||counts.duplicate)
    .map(([key,label])=>filterPill('contact-filter',key,label,{count:counts[key],pressed:uiState.contactFilter===key,warning:key==='duplicate'})).join('');
  const companies=[...new Set(state.contacts.map(c=>c.company).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th'));
  if(!companies.includes(uiState.contactCompany))uiState.contactCompany='';
  return render('pages/contacts/contacts',{tags,table:contactsTable(),
    search:searchInput('contact-search','ค้นหาลูกค้า','ค้นหาชื่อ อีเมล เบอร์โทร หรือองค์กร',uiState.contactQuery),
    companyFilter:filterSelect('contact-company','กรองตามองค์กร',companies.map(name=>option(name,name,name===uiState.contactCompany)).join(''),'ทุกองค์กร')});
}

function contactsTable(){
  const stats=contactTicketStats(),duplicates=duplicateEmails();
  const records=state.contacts.filter(c=>matchesContactFilters(c,stats,duplicates))
    .sort((a,b)=>compareContacts(a,b,stats)*uiState.contactDirection);
  if(!records.length)return state.contacts.length?empty('ไม่พบลูกค้าที่ตรงกับตัวกรอง','ลองเปลี่ยนคำค้นหา หรือเลือก “ทั้งหมด”','users'):empty('ยังไม่มีข้อมูลลูกค้า','เพิ่มลูกค้าหรือรับเรื่องผ่านหน้าช่วยเหลือ','users');
  const slice=paginate('contacts',records,{size:25,refresh:refreshContacts}),start=slice.start;
  const sortHeaders=[['name','ลูกค้า'],['email','ช่องทางติดต่อ'],['cases','เคสบริการ'],['last','ติดต่อล่าสุด']].map(([key,label])=>{
    const current=uiState.contactSort===key,ascending=uiState.contactDirection===1;
    return render('pages/contacts/sort-header',{key,label,sort:current?(ascending?'ascending':'descending'):'none',arrow:current?(ascending?'↑':'↓'):'↕'});
  }).join('');
  const rows=slice.shown.map((c,i)=>{
    const s=stats.get(c.id);
    return render('pages/contacts/contact-row',{id:c.id,avatar:avatar(c.name,start+i),name:c.name,email:c.email,phone:c.phone,phoneHref:String(c.phone||'').replace(/[^\d+]/g,''),company:c.company,
      ticketCount:s.total,late:s.late,open:s.open,last:s.last?relative(s.last):'',lastFull:s.last?date(s.last,true):'',created:date(c.created_at),
      duplicate:duplicates.has(emailKey(c)),canEdit:state.work.role!=='agent'});
  }).join('');
  return render('pages/contacts/contacts-table',{sortHeaders,rows,pager:pagerHTML(slice,'รายชื่อ')});
}

function refreshContacts(){$('#contacts-table').innerHTML=contactsTable();}

function contactForm(contact){
  const c=contact||{};
  modal(contact?'แก้ไขข้อมูลลูกค้า':'เพิ่มลูกค้าใหม่',render('pages/contacts/contact-form',{id:c.id||'',notes:c.notes||'',formActions:formActions(),
    firstNameField:inputField('ชื่อ','first_name',{value:c.first_name??c.name??'',placeholder:'เช่น สมชาย',max:100}),
    lastNameField:inputField('นามสกุล','last_name',{value:c.last_name||'',placeholder:'เช่น ใจดี',required:false,max:100}),
    emailField:inputField('อีเมล','email',{value:c.email||'',type:'email',placeholder:'name@example.com',required:false,max:254}),
    phoneField:inputField('โทรศัพท์','phone',{value:c.phone||'',type:'tel',placeholder:'081-234-5678',required:false,max:40}),
    companyField:inputField('องค์กร / บริษัท','company',{value:c.company||'',placeholder:'เช่น บริษัท บุ๊คโดส จำกัด',required:false,max:150})}));
  const form=document.querySelector('[data-form="contact"]');form.elements.first_name.dataset.personName='1';form.elements.last_name.dataset.personName='1';
  duplicateWarning(form);
}

// Warn (without blocking) when the email already belongs to another customer.
function duplicateWarning(form){
  const box=$('[data-duplicate-warning]',form),key=form.elements.email.value.trim().toLowerCase();
  const match=key&&state.contacts.find(c=>c.id!==form.dataset.id&&emailKey(c)===key);
  box.hidden=!match;box.textContent=match?`มีลูกค้า “${match.name}” ใช้อีเมลนี้อยู่แล้ว ตรวจสอบก่อนบันทึกเพื่อไม่ให้ข้อมูลซ้ำ`:'';
}

function contactModal(contact,thenTicket=false){contactForm(contact);document.querySelector('[data-form="contact"]').dataset.next=thenTicket?'ticket':'';}

function contactHistory(id){
  const c=state.contacts.find(c=>c.id===id),tickets=state.tickets.filter(t=>t.contact_id===id);
  modal('เคสของ '+c.name,tickets.length?render('pages/contacts/contact-history',{rows:tickets.map(t=>render('pages/contacts/contact-history-row',{id:t.id,subject:t.subject,number:t.number,
    status:badge(t.status),overdue:overdue(t),assignee:memberName(t.assignee_id),created:date(t.created_at),updated:date(t.updated_at)})).join('')}):empty('ยังไม่มีเคส','ลูกค้ารายนี้ยังไม่มีเคสบริการ','ticket'));
}

function mergeContacts(id){
  const key=emailKey(state.contacts.find(c=>c.id===id)),stats=contactTicketStats();
  const group=state.contacts.filter(c=>emailKey(c)===key).sort((a,b)=>a.created_at.localeCompare(b.created_at));
  modal('รวมข้อมูลลูกค้าที่ซ้ำกัน',render('pages/contacts/contact-merge',{email:group[0].email,ids:group.map(c=>c.id).join(','),formActions:formActions('รวมเป็นรายชื่อเดียว'),
    options:group.map((c,i)=>render('pages/contacts/contact-merge-option',{id:c.id,name:c.name,created:date(c.created_at),ticketCount:stats.get(c.id).total,
      details:[c.phone,c.company].filter(Boolean).join(' · '),checked:i===0})).join('')}));
}

Object.assign(actions,{
  'new-contact':async(button,id)=>{return contactModal();},
  'contact-for-ticket':async(button,id)=>{return contactModal(null,true);},
  'edit-contact':async(button,id)=>{return contactModal(state.contacts.find(c=>c.id===id));},
  'contact-history':async(button,id)=>{contactHistory(id);return;},
  'new-ticket-for':async(button,id)=>{return openNewTicket(id);},
  'merge-contact':async(button,id)=>{mergeContacts(id);return;},
  'delete-contact':async(button,id)=>{
    const contact=state.contacts.find(c=>c.id===id),cases=state.tickets.filter(t=>t.contact_id===id).length;
    confirmDelete({title:'ลบข้อมูลลูกค้า',warning:`“${contact.name}” จะถูกย้ายไปถังขยะ`,
      effects:cases?[`ลูกค้ารายนี้ยังมีเคสบริการ ${cases} รายการ จึงลบไม่ได้`,'ให้รวมรายชื่อซ้ำ หรือลบเคสของลูกค้ารายนี้ก่อน']
        :['ข้อมูลติดต่อและหมายเหตุจะหายไปจากรายชื่อลูกค้า','กู้คืนได้จากเมนูถังขยะภายใน 30 วัน หลังจากนั้นระบบจะลบถาวร','การลบจะถูกบันทึกในประวัติการทำงาน'],
      confirmLabel:'ย้ายไปถังขยะ',
      run:async()=>{await api('/api/contacts/'+id,undefined,'DELETE');toast('ย้ายข้อมูลลูกค้าไปถังขยะแล้ว · กู้คืนได้ที่เมนูถังขยะ');await route();}});
    return;},
  'contact-filter':async(button,id)=>{uiState.contactFilter=button.dataset.value;uiState.pager.contacts={page:1,size:uiState.pager.contacts?.size||25};$$('[data-action="contact-filter"]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));refreshContacts();return;},
  'sort-contact':async(button,id)=>{uiState.contactDirection=uiState.contactSort===button.dataset.sort?-uiState.contactDirection:1;uiState.contactSort=button.dataset.sort;refreshContacts();return;},
});

Object.assign(forms,{
  'contact':async(form,data)=>{const id=form.dataset.id;await api(`/api/contacts${id?'/'+id:''}`,data,id?'PATCH':'POST');closeModal();toast('บันทึกข้อมูลลูกค้าแล้ว');if(form.dataset.next==='ticket')await openNewTicket();else await route();return;},
  'contact-merge':async(form,data)=>{const ids=form.dataset.ids.split(',').filter(id=>id!==data.target_id);await api(`/api/contacts/${data.target_id}/merge`,{contact_ids:ids});closeModal();toast('รวมข้อมูลลูกค้าเป็นรายชื่อเดียวแล้ว');await route();return;},
});

document.addEventListener('input',event=>{const n=event.target;
  if(n.id==='contact-search'){uiState.contactQuery=n.value;goToPage('contacts',1);refreshContacts();}
  if(n.name==='email'&&n.form?.dataset.form==='contact')duplicateWarning(n.form);
});
document.addEventListener('change',event=>{const n=event.target;
  if(n.id==='contact-company'){uiState.contactCompany=n.value;goToPage('contacts',1);refreshContacts();}
});
// Rows in the customer's case-history modal open the case.
document.addEventListener('click',e=>{const row=e.target.closest('.linked-row');if(row&&!e.target.closest('a,button')){closeModal();location.hash=row.dataset.href;}});
