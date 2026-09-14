/* Reusable UI pieces: page heading, modal, empty state, the three filter-bar controls every screen shares
   (search box, filter pill, filter dropdown), form fields, field validation, the searchable combobox
   and the password eye toggle. */

'use strict';

/* One search box, one pill and one dropdown for every screen, so a filter bar looks and behaves the same
   everywhere. A pill reports its choice as data-value; the action name says which screen it belongs to. */
function searchInput(id,label,placeholder,value=''){return render('ui/search-input',{id,label,placeholder,value});}

function filterPill(action,value,label,{pressed=false,count=0,warning=false}={}){return render('ui/filter-pill',{action,value,label,pressed,count,warning});}

// The same pill as a link, for filters that live in the address (so they can be shared and bookmarked).
function filterLink(href,value,label,{active=false,count=0}={}){return render('ui/filter-link',{href,value,label,active,count});}

function filterSelect(id,label,options,any=''){return render('ui/filter-select',{id,label,options,any});}

/* One pager for every long list: what is shown, how many per page, ‹ ›, numbered pages and a box to jump to
   a page. A screen calls paginate() for the slice it should draw and pagerHTML() for the controls, and says
   how to redraw itself once. */
const pagerRefresh={};

function pagerState(name,size){return uiState.pager[name]??={page:1,size};}

function paginate(name,items,{size=25,refresh}={}){
  const state=pagerState(name,size);
  if(refresh)pagerRefresh[name]=refresh;
  const pages=Math.max(1,Math.ceil(items.length/state.size));
  state.page=Math.min(Math.max(1,state.page),pages);
  const start=(state.page-1)*state.size;
  return {name,page:state.page,size:state.size,pages,total:items.length,start,shown:items.slice(start,start+state.size)};
}

// First page, last page and the pages around the current one; the rest is a gap.
function pagerNumbers(name,page,pages){
  const wanted=new Set([1,pages,page,page-1,page+1]);
  if(page<=3)[2,3,4].forEach(n=>wanted.add(n));
  if(page>=pages-2)[pages-1,pages-2,pages-3].forEach(n=>wanted.add(n));
  const list=[...wanted].filter(n=>n>=1&&n<=pages).sort((a,b)=>a-b);
  return list.map((n,i)=>(i&&n-list[i-1]>1?render('ui/pager-gap'):'')+render('ui/pager-number',{name,page:n,current:n===page})).join('');
}

function pagerHTML(slice,unit='รายการ',sizes=[10,25,50]){
  const {name,page,pages,total,size,start,shown}=slice;
  return render('ui/pager',{name,unit,total,page,pages,from:total?start+1:0,to:start+shown.length,
    sizeOptions:options(Object.fromEntries(sizes.map(n=>[n,String(n)])),String(size)),
    manyPages:pages>1,prev:page-1,next:page+1,hasPrev:page>1,hasNext:page<pages,numbers:pagerNumbers(name,page,pages)});
}

function goToPage(name,page){
  const state=uiState.pager[name];if(!state)return;
  state.page=Math.max(1,Number(page)||1);
  pagerRefresh[name]?.();
}

Object.assign(actions,{
  'go-page':async(button,id)=>{goToPage(button.dataset.name,button.dataset.page);
    ($(`[data-action="go-page"][data-name="${button.dataset.name}"][data-page="${button.dataset.page}"]`)||$(`[data-page-jump="${button.dataset.name}"]`))?.focus();return;},
});

document.addEventListener('change',event=>{
  const node=event.target;
  if(node.matches('[data-page-size]')){const name=node.dataset.pageSize;uiState.pager[name]={page:1,size:Number(node.value)};pagerRefresh[name]?.();$(`[data-page-size="${name}"]`)?.focus();}
  if(node.matches('[data-page-jump]')){goToPage(node.dataset.pageJump,node.value);$(`[data-page-jump="${node.dataset.pageJump}"]`)?.focus();}
});

// One number with its label and trend, shared by the overview and the reports.
function statCard(label,value,symbol,color,foot,href,urgent=false){return render('ui/stat-card',{label,value,icon:icon(symbol),color,foot,href,urgent,good:color==='green'});}

function empty(title,description='',symbol='inbox',action=''){return render('ui/empty-state',{title,description,icon:icon(symbol),action});}

// drawer: slide-in panel on the right instead of a centered dialog (quick views).
// wide: a roomier dialog for screens that work side by side, such as the article editor and its preview.
function modal(title,content,{drawer=false,wide=false}={}){$('#modal-content').innerHTML=render('ui/modal',{title,content});$('#modal').classList.toggle('drawer',drawer);$('#modal').classList.toggle('wide',wide);$('#modal').showModal();initRichFields($('#modal'));}

function closeModal(force=false){if(!force&&!confirmModalClose())return false;$('#modal').close();return true;}

/* The small dialog. It may open on top of the big one, so a question ("throw the draft away?"), a URL to type
   or the photo cropper never replaces the form underneath - and the app never needs the browser's grey
   alert / confirm / prompt boxes, which cannot be styled, translated or made accessible. */
function sheet(title,content){$('#sheet-content').innerHTML=render('ui/sheet',{title,content});$('#sheet').showModal();enhanceForms($('#sheet'));}

function closeSheet(){$('#sheet').close();}

let pendingConfirm=null;

// One question, one answer: used wherever code used to call window.confirm().
function confirmSheet({title,message,confirmLabel='ยืนยัน',cancelLabel='ยกเลิก',tone='primary',run}){
  pendingConfirm=run;
  sheet(title,render('ui/confirm-sheet',{message,confirmLabel,cancelLabel,tone}));
}

Object.assign(actions,{'close-sheet':async(button,id)=>{closeSheet();return;}});

Object.assign(forms,{
  'confirm-sheet':async(form,data)=>{const run=pendingConfirm;pendingConfirm=null;closeSheet();await run?.();},
});

function formActions(label='บันทึก'){return render('ui/form-actions',{label});}

function inputField(label,name,{value='',type='text',placeholder='',required=true,max=300}={}){return render('ui/input-field',{label,name,type,value,placeholder,required,max,password:type==='password'});}

/* Deleting is deliberate: the dialog says what will disappear, the confirm button is the dangerous-looking one,
   and anything that carries history also has to be typed out before it can be removed. */
let pendingDelete=null;

function confirmDelete({title,warning,effects=[],word='',confirmLabel='ลบถาวร',run}){
  pendingDelete={word,run};
  modal(title,render('ui/confirm-delete',{warning,word,confirmLabel,
    effects:effects.map(text=>render('ui/delete-effect',{text})).join('')}));
}

Object.assign(forms,{
  'confirm-delete':async(form,data)=>{
    const job=pendingDelete;
    if(!job)return;
    if(job.word&&String(data.confirmation||'').trim()!==job.word)throw new Error(`กรุณาพิมพ์ ${job.word} ให้ตรงเพื่อยืนยัน`);
    await job.run();
    pendingDelete=null;
    closeModal(true);
  },
});

async function copyText(value){try{await navigator.clipboard.writeText(value);toast('คัดลอกลิงก์แล้ว');}catch{modal('คัดลอกลิงก์',render('ui/copy-link',{url:value}));$('#copy-url').select();}}

/* What may be attached, in one place. The server checks the same list plus the file's real first bytes, so a
   renamed program cannot get through; this side says no immediately, by name, instead of after sending. */
const ALLOWED_FILE_TYPES={png:1,jpg:1,jpeg:1,gif:1,webp:1,mp4:1,webm:1,pdf:1,txt:1};
const FILE_LIMITS={count:3,bytes:5*1024*1024};
const ALLOWED_FILE_TEXT='แนบได้สูงสุด 3 ไฟล์ รวมไม่เกิน 5 MB · PNG, JPG, GIF, WebP, MP4, WebM, PDF และ TXT';

function fileProblem(files){
  if(files.length>FILE_LIMITS.count)return `แนบได้สูงสุด ${FILE_LIMITS.count} ไฟล์ · ${ALLOWED_FILE_TEXT}`;
  for(const file of files){
    const parts=file.name.split('.');
    if(parts.length<2||!ALLOWED_FILE_TYPES[parts.pop().toLowerCase()])return `“${file.name}” เป็นชนิดไฟล์ที่ระบบไม่รองรับ · ${ALLOWED_FILE_TEXT}`;
    if(!file.size)return `“${file.name}” เป็นไฟล์ว่าง กรุณาเลือกไฟล์อื่น`;
  }
  if(files.reduce((total,file)=>total+file.size,0)>FILE_LIMITS.bytes)return 'ขนาดไฟล์รวมต้องไม่เกิน 5 MB กรุณาเอาบางไฟล์ออก';
  return '';
}

/* Checked the moment a file is chosen or dropped: what cannot be sent is taken out of the selection again and
   the reason is written in red under the field. */
function checkFileInput(input){
  const problem=fileProblem([...input.files]);
  const host=input.closest('.field')||input.parentElement;
  let note=host.querySelector('.file-error');
  if(!note){note=document.createElement('p');note.className='file-error';note.setAttribute('role','alert');host.append(note);}
  note.textContent=problem;
  input.setAttribute('aria-invalid',String(Boolean(problem)));
  if(problem){
    const keep=new DataTransfer();
    [...input.files].filter(file=>!fileProblem([file])).slice(0,FILE_LIMITS.count).forEach(file=>keep.items.add(file));
    if(keep.files.length!==input.files.length)input.files=keep.files;
  }
  return !problem;
}

async function getFiles(form){
  const input=$('input[type="file"]',form),files=[...(input?.files||[])];
  const problem=fileProblem(files);
  if(problem){if(input)checkFileInput(input);throw new Error(problem);}
  return Promise.all(files.map(file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,data:reader.result.split(',')[1]});reader.onerror=()=>reject(new Error('อ่านไฟล์ไม่สำเร็จ'));reader.readAsDataURL(file);})));
}

function showFieldError(input){
  input.setCustomValidity('');
  if(input.dataset.personName&&input.value.trim()&&!/^[\p{L}\p{M} .’'·-]+$/u.test(input.value.trim()))input.setCustomValidity('ใช้ตัวอักษร เว้นวรรค จุด ขีด หรืออัญประกาศสำหรับชื่อ');
  if(input.name==='password_confirm'&&input.value&&input.value!==input.form?.elements.password?.value)input.setCustomValidity('รหัสผ่านยืนยันไม่ตรงกัน');
  if(input.dataset.comboInput&&input.value.trim()&&!input.closest('[data-combobox]')?.querySelector('[data-combo-value]')?.value)input.setCustomValidity('กรุณาเลือกจากรายการ');
  const host=input.closest('.combo')||input.parentElement;
  let error=host.querySelector('.field-error');
  if(!error){error=document.createElement('span');error.className='field-error';error.id='field-error-'+crypto.randomUUID();error.setAttribute('role','alert');host.append(error);input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),error.id].filter(Boolean).join(' '));}
  const invalid=!input.validity.valid;
  error.textContent=invalid?(input.validity.valueMissing?'กรุณากรอกข้อมูลช่องนี้':input.validity.typeMismatch?'กรุณาระบุรูปแบบให้ถูกต้อง เช่น name@example.com':input.validationMessage):'';
  input.setAttribute('aria-invalid',String(invalid));
  return !invalid;
}

function enhanceForms(root=document){
  root.querySelectorAll('[data-form="portal-request"] [name="name"]').forEach(n=>n.dataset.personName='1');
  root.querySelectorAll('input[type="password"]:not([data-eye-ready])').forEach(input=>{
    input.dataset.eyeReady='1';const wrap=document.createElement('div');wrap.className='password-control';input.before(wrap);wrap.append(input);
    const button=document.createElement('button');button.type='button';button.className='password-eye';button.dataset.action='toggle-password';button.setAttribute('aria-label','แสดงรหัสผ่าน');button.setAttribute('aria-pressed','false');button.innerHTML=icon('eye');wrap.append(button);
  });
  root.querySelectorAll('input[required],textarea[required],select[required]').forEach(input=>{
    const label=input.id?root.querySelector(`label[for="${CSS.escape(input.id)}"]`):null;
    if(label&&!label.querySelector('.required-star')){const star=document.createElement('span');star.className='required-star';star.textContent=' *';star.title='จำเป็นต้องกรอก';label.append(star);}
  });
  root.querySelectorAll('[data-form="article"]:not([data-initial])').forEach(form=>{form.dataset.initial=JSON.stringify(Object.fromEntries(new FormData(form)));updateArticleSubmit(form);});
  root.querySelectorAll('input[type="file"]:not([data-file-ready])').forEach(input=>{
    input.dataset.fileReady='1';const hint=document.createElement('span');hint.className='file-selection';hint.setAttribute('aria-live','polite');input.after(hint);
  });
}

function blinkEyeIcon(button,symbol){
  clearTimeout(button.blinkTimer);button.classList.remove('blink-close','blink-open');
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){button.innerHTML=icon(symbol);return;}
  void button.offsetWidth;button.classList.add('blink-close');
  button.blinkTimer=setTimeout(()=>{button.innerHTML=icon(symbol);button.classList.replace('blink-close','blink-open');button.blinkTimer=setTimeout(()=>button.classList.remove('blink-open'),200);},140);
}

/* Searchable single-select: visible combobox input + hidden form value. Items: [{value,label,detail}].
   Any list that can grow long (customers, team members) uses this instead of a plain dropdown. */
function comboboxField({id,name,items,placeholder='',value='',required=true}){
  uiState.combos[id]=items;const selected=items.find(i=>i.value===value);
  return render('ui/combobox',{id,name,placeholder,required,label:selected?.label||'',value:selected?.value||''});
}

// The people of one team, searchable by name, with "not assigned yet" as the empty choice.
function memberPicker(id,teamId,value=''){
  const members=(state.work?.members||[]).filter(m=>m.active&&m.team_id===teamId);
  return comboboxField({id,name:'assignee_id',required:false,placeholder:'ยังไม่มอบหมาย · พิมพ์เพื่อค้นหาชื่อ',value,
    items:[{value:'',label:'ยังไม่มอบหมาย'},...members.map(m=>({value:m.id,label:m.name,detail:roleLabels[m.role]||''}))]});
}

// A team's members changed: the picker offers the new team's people and starts unassigned.
function refreshMemberPicker(form,teamId){
  const combo=$('[data-combobox]:has([name="assignee_id"])',form);
  if(!combo)return;
  const input=$('[data-combo-input]',combo);
  combo.outerHTML=memberPicker(input.id,teamId,'');
}

function openCombobox(combo,q=''){
  const input=combo.querySelector('[data-combo-input]'),list=combo.querySelector('.combo-list'),current=combo.querySelector('[data-combo-value]').value,term=q.trim().toLowerCase();
  const matches=(uiState.combos[input.id]||[]).filter(i=>!term||[i.label,i.detail].some(v=>String(v||'').toLowerCase().includes(term)));
  list.innerHTML=matches.map((i,n)=>render('ui/combobox-option',{id:`${input.id}-opt-${n}`,value:i.value,selected:i.value===current,label:i.label,detail:i.detail})).join('')||render('ui/combobox-no-match');
  list.hidden=false;input.setAttribute('aria-expanded','true');highlightComboOption(combo,matches.findIndex(i=>i.value===current));
}

function closeCombobox(combo){const input=combo.querySelector('[data-combo-input]');combo.querySelector('.combo-list').hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}

function highlightComboOption(combo,index){const input=combo.querySelector('[data-combo-input]'),options=[...combo.querySelectorAll('[role="option"]')];options.forEach((o,i)=>o.classList.toggle('active',i===index));if(options[index]){input.setAttribute('aria-activedescendant',options[index].id);options[index].scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');}

function pickComboOption(combo,option){const input=combo.querySelector('[data-combo-input]');input.value=option.querySelector('span').textContent;combo.querySelector('[data-combo-value]').value=option.dataset.value;input.setCustomValidity('');closeCombobox(combo);if(input.getAttribute('aria-invalid')==='true')showFieldError(input);}

function leaveCombobox(input){
  const combo=input.closest('[data-combobox]'),hidden=combo.querySelector('[data-combo-value]'),term=input.value.trim().toLowerCase();
  if(!hidden.value&&term){const exact=(uiState.combos[input.id]||[]).filter(i=>i.label.toLowerCase()===term);if(exact.length===1){hidden.value=exact[0].value;input.value=exact[0].label;input.setCustomValidity('');}}
  closeCombobox(combo);
}

Object.assign(actions,{
  'close-modal':async(button,id)=>{return closeModal();},
  'toggle-password':async(button,id)=>{const input=button.parentElement.querySelector('input');input.type=input.type==='password'?'text':'password';const shown=input.type==='text';button.setAttribute('aria-label',shown?'ซ่อนรหัสผ่าน':'แสดงรหัสผ่าน');button.setAttribute('aria-pressed',String(shown));blinkEyeIcon(button,shown?'eyeOff':'eye');return;},
});

// Validation, the searchable combobox and file inputs work in every form (staff app and support page).
new MutationObserver(()=>enhanceForms()).observe(document.body,{childList:true,subtree:true});
document.addEventListener('focusout',e=>{if(e.target.matches('[data-combo-input]'))leaveCombobox(e.target);if(e.target.matches('input:not([type="file"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),textarea,select'))showFieldError(e.target);});
document.addEventListener('input',e=>{const n=e.target;if(n.matches('[data-combo-input]')){const combo=n.closest('[data-combobox]');combo.querySelector('[data-combo-value]').value='';n.setCustomValidity(n.value.trim()?'กรุณาเลือกจากรายการ':'');openCombobox(combo,n.value);}if(n.getAttribute('aria-invalid')==='true')showFieldError(n);});
document.addEventListener('invalid',e=>showFieldError(e.target),true);
document.addEventListener('change',e=>{const n=e.target;if(n.type==='file'&&!n.dataset.photoInput){checkFileInput(n);const list=n.form?.querySelector('[data-file-list]');if(list)renderFilePills(n,list);else{const target=n.parentElement.querySelector('.file-selection')||n.nextElementSibling;target.textContent=[...n.files].map(f=>`${f.name} (${Math.ceil(f.size/1024)} KB)`).join(', ')||'ยังไม่ได้เลือกไฟล์';}}});
document.addEventListener('click',e=>{const comboInput=e.target.closest('[data-combo-input]');if(comboInput){const combo=comboInput.closest('[data-combobox]');if(combo.querySelector('.combo-list').hidden)openCombobox(combo,combo.querySelector('[data-combo-value]').value?'':comboInput.value);}});
document.addEventListener('mousedown',e=>{const option=e.target.closest('.combo-list [role="option"]');if(option){e.preventDefault();pickComboOption(option.closest('[data-combobox]'),option);}});
document.addEventListener('keydown',e=>{
  if(!e.target.matches?.('[data-combo-input]'))return;
  const combo=e.target.closest('[data-combobox]'),list=combo.querySelector('.combo-list');
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(list.hidden)openCombobox(combo,combo.querySelector('[data-combo-value]').value?'':e.target.value);const options=[...list.querySelectorAll('[role="option"]')],index=options.findIndex(o=>o.classList.contains('active'));highlightComboOption(combo,e.key==='ArrowDown'?Math.min(options.length-1,index+1):Math.max(0,index-1));}
  else if(e.key==='Enter'&&!list.hidden){e.preventDefault();const options=[...list.querySelectorAll('[role="option"]')],active=options.find(o=>o.classList.contains('active'))||(options.length===1?options[0]:null);if(active)pickComboOption(combo,active);}
  else if(e.key==='Escape'&&!list.hidden){e.preventDefault();e.stopPropagation();closeCombobox(combo);}
});
document.querySelector('#modal').addEventListener('cancel',e=>{if(!confirmModalClose())e.preventDefault();});
// Clicking the dimmed area beside a dialog closes it, the way every other overlay in the app closes.
document.addEventListener('click',e=>{if(e.target===$('#sheet'))closeSheet();else if(e.target===$('#modal'))closeModal();});
