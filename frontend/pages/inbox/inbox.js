/* Inbox: filterable conversation list, conversation header, message thread (with day dividers) and the reply composer.
   Markup: pages/inbox/ (composer, message and thread-day are also used by the case screen), ui/filter-pill.html. */

'use strict';

const inboxFilters={waiting:'รอตอบ',open:'เปิดอยู่',all:'ทั้งหมด'};

const sendShortcut=/Mac|iPhone|iPad/.test(navigator.platform)?'⌘+Enter':'Ctrl+Enter';

const clockTime=new Intl.DateTimeFormat('th-TH',{hour:'2-digit',minute:'2-digit'});

// The customer spoke last and the conversation is still open.
const needsReply=c=>c.last_public_kind==='customer'&&c.status==='open';

let inboxListHTML='';

function inboxMatches(c,filter=uiState.inboxFilter,query=uiState.inboxQuery){
  const q=query.trim().toLowerCase();
  return (filter==='all'||(filter==='open'&&c.status==='open')||(filter==='waiting'&&needsReply(c)))
    &&(!q||[c.contact_name,c.company,c.subject,c.preview,c.ticket_number?`BD-${c.ticket_number}`:''].some(v=>String(v||'').toLowerCase().includes(q)));
}

function inboxPage(selected){
  inboxListHTML=inboxItems();
  return render('pages/inbox/inbox',{hasDetail:!!selected,items:inboxListHTML,
    search:searchInput('inbox-search','ค้นหาบทสนทนา','ค้นหาชื่อ เรื่อง หรือเลขเคส',uiState.inboxQuery),
    tabs:Object.entries(inboxFilters).map(([key,label])=>filterPill('inbox-filter',key,label,{pressed:uiState.inboxFilter===key,count:state.conversations.filter(c=>inboxMatches(c,key,'')).length})).join(''),
    detail:selected?inboxDetail(selected):empty('เลือกบทสนทนาเพื่อเริ่มดูแล','เมื่อมีลูกค้าส่งเรื่อง ข้อความจะแสดงทางด้านซ้าย','chat')});
}

function inboxItems(){
  const selectedId=state.detail?.conversation?.id,list=state.conversations.filter(c=>inboxMatches(c));
  if(list.length)return list.map(c=>inboxItem(c,c.id===selectedId)).join('');
  if(!state.conversations.length)return empty('ยังไม่มีข้อความ','แชร์หน้าช่วยเหลือเพื่อเริ่มรับเรื่องจากลูกค้า','chat');
  if(uiState.inboxQuery.trim())return empty('ไม่พบบทสนทนาที่ค้นหา','ลองใช้ชื่อลูกค้า เรื่อง หรือหมายเลขเคส','search');
  return empty(uiState.inboxFilter==='waiting'?'ตอบครบทุกบทสนทนาแล้ว':'ไม่มีบทสนทนาที่เปิดอยู่','เลือก “ทั้งหมด” เพื่อดูบทสนทนาที่ปิดแล้ว','checkCircle');
}

// Re-render only the list (search, tabs, polling) so the open conversation and its draft stay put.
function refreshInboxList(){
  const items=$('#inbox-items');if(!items)return;
  const html=inboxItems();if(html!==inboxListHTML){inboxListHTML=html;items.innerHTML=html;}
  $$('.inbox-tabs .filter-pill').forEach(tab=>{tab.setAttribute('aria-pressed',String(tab.dataset.value===uiState.inboxFilter));tab.querySelector('.tag-count').textContent=state.conversations.filter(c=>inboxMatches(c,tab.dataset.value,'')).length;});
}

function inboxDetail(data){
  const c=data.conversation,t=data.ticket,open=c.status==='open';
  return render('pages/inbox/conversation-view',{id:c.id,subject:c.subject,avatar:avatar(data.contact.name,2),contactName:data.contact.name,contactEmail:data.contact.email,
    channelBadge:channelBadge(c.channel),aiControls:aiControls(c.id),ticket:t,ticketBadge:t?badge(t.status):'',ticketPriority:t&&['high','urgent'].includes(t.priority)?priority(t.priority):'',closed:!open,
    nextStatus:open?'closed':'open',statusAction:open?'ปิดบทสนทนา':'เปิดบทสนทนาอีกครั้ง',statusIcon:icon(open?'checkCircle':'chat'),
    lineGroup:c.line&&c.line.source_type!=='user',privacyTag:privacyTag(),messages:messagesHTML(data.messages),composer:composer(c.id,{manual:c.channel==='manual',channel:c.channel,compact:true})});
}

/* Inbox card: channel + customer + reply dot + time, subject, then the last message with the case number. */
function inboxItem(c,selected){
  const urgent=['high','urgent'].includes(c.ticket_priority);
  return render('pages/inbox/inbox-item',{id:c.id,selected,needsReply:needsReply(c),
    channel:c.channel,channelName:channelNames[c.channel]||c.channel,channelIcon:icon(channelIcons[c.channel]||'chat'),contactName:c.contact_name,
    urgency:urgent?c.ticket_priority:'',urgencyLabel:urgent?priorityLabels[c.ticket_priority]:'',closed:c.status==='closed',
    subject:c.subject,isNote:c.last_kind==='note',fromStaff:c.last_kind==='reply',preview:plainText(c.preview)||'ยังไม่มีข้อความ',ticketNumber:c.ticket_number,updated:shortAgo(c.updated_at)});
}

function dayLabel(when){
  const day=when.toDateString();
  if(day===new Date().toDateString())return 'วันนี้';
  if(day===new Date(Date.now()-864e5).toDateString())return 'เมื่อวาน';
  return new Intl.DateTimeFormat('th-TH',{weekday:'short',day:'numeric',month:'short',year:'numeric'}).format(when);
}

// Messages show only the time; a divider marks each new day.
function messagesHTML(messages,publicView=false){
  if(!messages.length)return empty('ยังไม่มีข้อความ','เริ่มบันทึกรายละเอียดการดูแลในเคสนี้','chat');
  let day='';
  return messages.map(m=>{
    const when=new Date(m.created_at),divider=when.toDateString()!==day?render('pages/inbox/thread-day',{label:dayLabel(when)}):'';day=when.toDateString();
    return divider+render('pages/inbox/message',{id:m.id,kind:m.kind,avatar:avatar(m.author_name,m.kind==='customer'?2:0),author:m.author_name,
      isNote:m.kind==='note',isAI:m.kind!=='note'&&m.source==='ai',time:clockTime.format(when),fullTime:date(m.created_at,true),iso:m.created_at,
      // What the team writes may carry formatting from the composer tools; what a customer types is shown as typed.
      body:m.body,rich:m.kind!=='customer'&&/(\*\*|__|^[-*] |^\d+\. |^#{1,2} |`|\[.+\]\(.+\))/m.test(m.body),bodyHTML:markdownToHTML(m.body),
      files:m.attachments.map(a=>messageAttachment(a,publicView)).join(''),
      citations:aiCitationsHTML(m.citations),delivery:m.kind==='reply'?channelDeliveryHTML(m):''});
  }).join('');
}

/* Reply composer: mode switch on top, reply tools and the paperclip in one row next to Send. Files can also be dropped on the form.
   Unsent staff text is kept per conversation while moving around the app. */
function composer(conversationId,{publicView=false,manual=false,channel='web',compact=false}={}){
  return render('pages/inbox/composer',{id:conversationId,formName:publicView?'portal-message':'message',channel,publicView,manual,compact,sendShortcut,
    line:channel==='line',maxLength:channel==='line'?5000:20000,draft:publicView?'':uiState.drafts[conversationId]||'',
    aiControls:publicView||compact?'':aiControls(conversationId),aiDraftButton:publicView?'':aiDraftButton(conversationId)});
}

function renderFilePills(input,list){list.innerHTML=[...input.files].map((f,i)=>render('pages/inbox/file-pill',{name:f.name,size:Math.ceil(f.size/1024),index:i})).join('');}

// The text box grows with what is typed (up to the CSS max-height).
function autoGrow(area){area.style.height='auto';area.style.height=`${area.scrollHeight+2}px`;}

// Below this width the inbox shows one pane at a time (list, or conversation with a back button).
const inboxSinglePane=()=>matchMedia('(max-width:1000px)').matches;

// Newest messages are at the bottom. A thread stays pinned there when it changes size (window resize, header
// wrapping once fonts load) unless the person has scrolled up to read older messages.
const pinThreads=new ResizeObserver(entries=>entries.forEach(({target})=>{if(target.dataset.pinned!=='no')target.scrollTop=target.scrollHeight;}));

function scrollThreadsToEnd(){
  const go=()=>{
    $$('[data-thread]').forEach(n=>{n.scrollTop=n.scrollHeight;n.dataset.pinned='yes';pinThreads.observe(n);});
    if(inboxSinglePane()&&$('.inbox-layout.show-detail'))window.scrollTo(0,document.documentElement.scrollHeight);
  };
  go();requestAnimationFrame(go);
}

async function pollStaffMessages(){
  if(document.hidden||$('#modal').open)return;
  const epoch=state.epoch;
  try{
    if(state.route==='inbox'){const fresh=(await api('/api/conversations')).conversations;if(epoch!==state.epoch)return;state.conversations=fresh;refreshInboxList();}
    const detail=state.detail;if(!detail)return;
    const path=detail.ticket&&detail.conversations?`/api/tickets/${detail.ticket.id}`:`/api/conversations/${detail.conversation.id}`;
    const fresh=await api(path);if(epoch!==state.epoch)return;
    state.detail=fresh;$$('[data-ai-controls]').forEach(n=>n.innerHTML=aiControls(n.dataset.aiControls));
    const list=fresh.conversations||[{id:fresh.conversation.id,messages:fresh.messages}];
    list.forEach(c=>{const node=$(`[data-thread="${c.id}"]`);if(node)syncMessageThread(node,messagesHTML(c.messages));});
  }catch(error){clearInterval(pollTimer);toast(error.message,true);}
}

Object.assign(actions,{
  'inbox-filter':async(button,id)=>{uiState.inboxFilter=button.dataset.value;refreshInboxList();return;},
  'file-remove':async(button,id)=>{const form=button.closest('form'),input=form.querySelector('input[type="file"]'),keep=new DataTransfer();[...input.files].forEach((f,i)=>{if(i!==Number(button.dataset.index))keep.items.add(f);});input.files=keep.files;renderFilePills(input,form.querySelector('[data-file-list]'));form.elements.body?.focus();return;},
  'canned':async(button,id)=>{const form=button.closest('form'),area=$('textarea',form);area.value=state.work.settings.canned_reply;area.dispatchEvent(new Event('input',{bubbles:true}));($('.richtext',form)||area).focus();},
  'chat-knowledge':async(button,id)=>{state.articles=(await api('/api/articles')).articles;modal('เลือกบทความสำหรับร่างคำตอบ',render('pages/inbox/choose-article',{cards:articleCards(state.articles)}));return;},
  'conversation-ticket':async(button,id)=>{const result=await api(`/api/conversations/${id}/ticket`,{});toast('เปิดเคสจากบทสนทนาแล้ว');location.hash=`tickets/${result.id}`;},
  'conversation-status':async(button,id)=>{await api(`/api/conversations/${id}`,{status:button.dataset.status},'PATCH');toast(button.dataset.status==='closed'?'ปิดบทสนทนาแล้ว':'เปิดบทสนทนาแล้ว');return route();},
  'download-file':async(button,id)=>{return download(button.dataset.public==='yes'?`/api/public/${state.portal.slug}/attachments/${id}`:`/api/attachments/${id}`,button.dataset.name);},
});

Object.assign(forms,{
  'message':async(form,data)=>{
    delete data.files;data.attachments=await getFiles(form);
    await api(`/api/conversations/${form.dataset.conversation}/messages`,data);
    const area=$('[name="body"]',form);area.value='';area.style.height='';
    const editor=$('.richtext',form);if(editor)editor.innerHTML='';
    delete uiState.drafts[form.dataset.conversation];
    $('input[type="file"]',form).value='';$('[data-file-list]',form)?.replaceChildren();
    await pollStaffMessages();toast(data.kind==='note'?'บันทึกภายในแล้ว':['line','email'].includes(form.dataset.channel)?'ข้อความเข้าคิวส่งแล้ว ตรวจผลใต้ข้อความได้':'ข้อความพร้อมอ่านในหน้าติดตามของลูกค้า');
  },
});

document.addEventListener('change',e=>{const n=e.target;if(n.name==='kind'&&n.form?.classList.contains('composer')){const area=n.form.elements.body;if(!n.form.dataset.replyPlaceholder)n.form.dataset.replyPlaceholder=area.placeholder;area.placeholder=n.value==='note'?'บันทึกภายใน… ลูกค้าจะไม่เห็นข้อความนี้':n.form.dataset.replyPlaceholder;}});
document.addEventListener('input',e=>{const n=e.target;
  if(n.id==='inbox-search'){uiState.inboxQuery=n.value;refreshInboxList();}
  if(n.matches?.('.composer textarea')){
    if(!n.classList.contains('rich-source'))autoGrow(n);
    if(n.form?.dataset.form==='message')uiState.drafts[n.form.dataset.conversation]=n.value;
  }
});
// Ctrl/⌘+Enter sends; Alt+↑/↓ moves to the previous/next conversation in the list.
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&e.target.matches?.('.composer textarea')){e.preventDefault();e.target.form.requestSubmit();return;}
  if(e.altKey&&['ArrowDown','ArrowUp'].includes(e.key)&&state.route==='inbox'&&!$('#modal').open){
    const items=$$('#inbox-items .inbox-item'),current=items.findIndex(a=>a.classList.contains('selected')),next=items[e.key==='ArrowDown'?current+1:Math.max(0,current-1)];
    if(next&&!next.classList.contains('selected')){e.preventDefault();location.hash=next.getAttribute('href');}
  }
});
document.addEventListener('scroll',e=>{const n=e.target;if(n.matches?.('[data-thread]'))n.dataset.pinned=n.scrollHeight-n.scrollTop-n.clientHeight<60?'yes':'no';},true);
// Drop files anywhere on a composer to attach them.
const dropTarget=e=>[...(e.dataTransfer?.types||[])].includes('Files')?e.target.closest?.('.composer'):null;
document.addEventListener('dragover',e=>{const c=dropTarget(e);if(c){e.preventDefault();c.classList.add('drag-over');}});
document.addEventListener('dragleave',e=>{const c=e.target.closest?.('.composer');if(c&&!c.contains(e.relatedTarget))c.classList.remove('drag-over');});
document.addEventListener('drop',e=>{const c=dropTarget(e);if(!c)return;e.preventDefault();c.classList.remove('drag-over');const input=c.querySelector('input[type="file"]');if(!input||!e.dataTransfer.files.length)return;const all=new DataTransfer();[...input.files,...e.dataTransfer.files].forEach(f=>all.items.add(f));input.files=all.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
