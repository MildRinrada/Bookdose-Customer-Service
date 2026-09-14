/* Recycle bin: everything a delete removed, still whole. Each row says what it was, who removed it, how long it
   will be kept, and offers the one thing that matters - putting it back. Clearing it for good is the deliberate
   action here, with the same typed confirmation the delete itself had.
   Markup: pages/trash/, ui/search-input.html, ui/filter-pill.html, ui/pager.html, ui/confirm-delete.html. */

'use strict';

const trashKinds={ticket:{label:'เคสบริการ',icon:'ticket'},contact:{label:'ข้อมูลลูกค้า',icon:'users'},article:{label:'บทความ',icon:'book'}};

function trashItems(){
  const f=uiState.trash,term=(f.q||'').toLowerCase();
  return (state.trash?.items||[]).filter(item=>(!f.kind||item.kind===f.kind)
    &&(!term||[item.title,item.detail,item.actor].some(v=>String(v||'').toLowerCase().includes(term))));
}

function trashRow(item){
  const kind=trashKinds[item.kind]||{label:item.kind,icon:'file'};
  return render('pages/trash/trash-item',{id:item.id,kind:item.kind,icon:icon(kind.icon),label:kind.label,
    title:item.title||'(ไม่มีชื่อ)',detail:item.detail,actor:item.actor,ago:relative(item.deleted_at),
    iso:item.deleted_at,full:date(item.deleted_at,true),days:item.days_left,soon:item.days_left<=7,
    canRestore:item.can_restore});
}

function trashPage(data){
  if(data)state.trash=data;
  const f=uiState.trash,all=state.trash?.items||[],visible=trashItems();
  const counts=kind=>all.filter(item=>!kind||item.kind===kind).length;
  const slice=paginate('trash',visible,{size:25,refresh:refreshTrash});
  return render('pages/trash/trash',{keepDays:state.trash?.keep_days||30,total:all.length,count:visible.length,
    search:searchInput('trash-search','ค้นหาในถังขยะ','ค้นหาชื่อรายการ หรือชื่อผู้ที่ลบ',f.q||''),
    pills:[['','ทั้งหมด'],...Object.entries(trashKinds).map(([key,meta])=>[key,meta.label])]
      .filter(([key])=>!key||counts(key)||f.kind===key)
      .map(([key,label])=>filterPill('trash-kind',key,label,{pressed:(f.kind||'')===key,count:counts(key)})).join(''),
    items:slice.shown.map(trashRow).join(''),
    pager:visible.length?pagerHTML(slice,'รายการ',[25,50,100]):'',
    empty:all.length?empty('ไม่พบรายการที่ค้นหา','ลองเปลี่ยนคำค้น หรือเลือกประเภทอื่น','search')
      :empty('ถังขยะว่าง','เมื่อมีการลบเคส ข้อมูลลูกค้า หรือบทความ รายการจะมารออยู่ที่นี่ก่อน','trash')});
}

function refreshTrash(){const host=$('#page');if(host&&state.route==='trash')host.innerHTML=trashPage();}

Object.assign(actions,{
  'trash-kind':async(button,id)=>{uiState.trash={...uiState.trash,kind:button.dataset.value};goToPage('trash',1);refreshTrash();return;},
  // Putting something back is the safe direction, so it happens at once and says what came back.
  'restore-item':async(button,id)=>{
    button.disabled=true;
    try{await api(`/api/trash/${id}/restore`,{});}finally{button.disabled=false;}
    state.trash=await api('/api/trash');
    toast('กู้คืนรายการแล้ว');
    await route();return;},
  'purge-item':async(button,id)=>{
    const item=(state.trash?.items||[]).find(i=>i.id===id);
    const kind=trashKinds[item.kind]||{label:item.kind};
    confirmDelete({title:`ลบ${kind.label}ถาวร`,warning:`“${item.title}” จะถูกลบออกจากระบบอย่างถาวร และกู้คืนไม่ได้อีก`,
      effects:[`${kind.label}นี้จะหายไปจากถังขยะทันที`,'ไม่มีสำเนาอื่นในระบบให้กู้คืน','การลบถาวรจะถูกบันทึกในประวัติการทำงาน'],
      word:'ลบถาวร',confirmLabel:'ลบถาวรทันที',
      run:async()=>{await api('/api/trash/'+id,undefined,'DELETE');state.trash=await api('/api/trash');toast('ลบถาวรแล้ว');refreshTrash();}});
    return;},
});

document.addEventListener('input',event=>{
  if(event.target.id!=='trash-search')return;
  uiState.trash={...uiState.trash,q:event.target.value};goToPage('trash',1);refreshTrash();
  $('#trash-search')?.focus();
});
