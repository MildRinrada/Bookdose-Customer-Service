/* The customer's side of the service: find an answer, ask for help, and follow the answer afterwards.
   Written for someone who arrived with a problem and has never seen this page before - so it says in their own
   words where their question stands, how long an answer takes, and what happens next.
   Markup: pages/portal/, ui/search-input.html, ui/filter-pill.html. */

'use strict';

function portalShell(content){$('#app').innerHTML=render('pages/portal/portal-frame',{brand:brand(),organization:state.portal.info.organization.name,content});}

/* Staff words are not customer words. Each state says what it means for the person waiting, and where their
   question sits on the way to being answered. */
const portalStates={
  received:{label:'ทีมงานได้รับเรื่องแล้ว',hint:'เรื่องของคุณเข้าคิวรอเจ้าหน้าที่รับดูแล',step:1,tone:'received'},
  working:{label:'กำลังดำเนินการ',hint:'เจ้าหน้าที่กำลังดูแลเรื่องของคุณอยู่',step:2,tone:'working'},
  waiting:{label:'รอข้อมูลจากคุณ',hint:'ทีมงานขอข้อมูลเพิ่มเติม ตอบกลับด้านล่างได้เลย',step:2,tone:'waiting'},
  done:{label:'ดำเนินการเรียบร้อยแล้ว',hint:'ถ้ายังไม่เรียบร้อย ตอบกลับในหน้านี้เพื่อให้ทีมดูแลต่อได้',step:3,tone:'done'},
};

const ticketStateKeys={new:'received',open:'working',pending_internal:'working',pending_customer:'waiting',resolved:'done',closed:'done'};

function portalState(data){
  if(data.ticket)return portalStates[ticketStateKeys[data.ticket.status]||'working'];
  return data.conversation.status==='closed'?portalStates.done:portalStates.received;
}

function portalStepsHTML(step){
  return render('pages/portal/portal-steps',{steps:[[1,'ส่งเรื่องแล้ว'],[2,'ทีมงานดูแล'],[3,'เรียบร้อย']]
    .map(([n,label])=>render('pages/portal/portal-step',{label,done:n<step,current:n===step,number:n})).join('')});
}

// "ภายใน 4 ชั่วโมง" reads as a promise; a half-hour setting still has to read properly.
function replyPromise(){
  const hours=Number(state.portal.info.response_hours);
  if(!Number.isFinite(hours)||hours<=0)return '';
  return hours<1?`${Math.round(hours*60)} นาที`:hours>=24&&hours%24===0?`${hours/24} วัน`:`${Number.isInteger(hours)?hours:hours.toFixed(1)} ชั่วโมง`;
}

/* Home: the answers first (most questions are already written down), then the form. */
function portalArticles(){
  const info=state.portal.info,term=(state.portal.query||'').toLowerCase(),category=state.portal.category||'';
  return info.articles.filter(a=>(!category||a.category===category)
    &&(!term||[a.title,a.body,a.category].some(v=>String(v||'').toLowerCase().includes(term))));
}

function portalArticleList(){
  const found=portalArticles();
  if(!found.length)return render('pages/portal/portal-no-article',{searching:Boolean(state.portal.query||state.portal.category)});
  return found.map(a=>render('pages/portal/portal-article',{id:a.id,title:a.title,category:a.category,
    excerpt:plainText(a.body).slice(0,120)})).join('');
}

function refreshPortalArticles(){
  const host=$('#portal-articles');
  if(host)host.innerHTML=portalArticleList();
  const count=$('#portal-article-count');
  if(count)count.textContent=`${portalArticles().length} บทความ`;
}

function renderPortalHome(){
  const info=state.portal.info,categories=[...new Set(info.articles.map(a=>a.category))].sort((a,b)=>a.localeCompare(b,'th'));
  const promise=replyPromise();
  portalShell(render('pages/portal/portal-home',{welcome:info.welcome,aiEnabled:info.ai_enabled,
    organization:info.organization.name,hasArticles:info.articles.length>0,articleCount:info.articles.length,
    promise,
    search:searchInput('portal-search','ค้นหาคำตอบ','ค้นหาคำตอบ เช่น ลืมรหัสผ่าน การคืนหนังสือ',state.portal.query||''),
    categoryPills:categories.length>1?[['','ทั้งหมด'],...categories.map(c=>[c,c])]
      .map(([value,label])=>filterPill('portal-category',value,label,{pressed:(state.portal.category||'')===value,
        count:value?info.articles.filter(a=>a.category===value).length:info.articles.length})).join(''):'',
    articles:portalArticleList(),
    nameField:inputField('ชื่อของคุณ','name',{max:100,placeholder:'เช่น สมชาย ใจดี'}),
    emailField:inputField('อีเมลสำหรับติดต่อ','email',{type:'email',max:254,placeholder:'name@example.com'}),
    subjectField:inputField('เรื่องที่ต้องการความช่วยเหลือ','subject',{max:300,placeholder:'สรุปสั้น ๆ ว่าเรื่องอะไร'})}));
}

/* After a case is closed the customer is asked how it went: five stars, one tap. Once answered, a thank-you. */
const ratingLabels={1:'ไม่พอใจ',2:'ไม่ค่อยพอใจ',3:'เฉย ๆ',4:'พอใจ',5:'พอใจมาก'};

function portalSurveyHTML(survey){
  if(!survey||(!survey.pending&&!survey.rating))return '';
  return render('pages/portal/portal-survey',{pending:survey.pending,rating:survey.rating,starText:survey.rating?starsText(survey.rating):'',
    stars:[1,2,3,4,5].map(value=>render('pages/portal/star-button',{value,label:ratingLabels[value]})).join('')});
}

async function loadPortalSession(){
  clearInterval(pollTimer);
  const data=await api(`/api/public/${state.portal.slug}/session`);state.portal.session=data;
  const view=portalState(data);
  portalShell(render('pages/portal/portal-session',{subject:data.conversation.subject,
    stateLabel:view.label,stateHint:view.hint,tone:view.tone,steps:portalStepsHTML(view.step),
    reference:data.ticket?`BD-${data.ticket.number}`:'',promise:replyPromise(),
    survey:portalSurveyHTML(data.survey),surveyKey:JSON.stringify(data.survey),
    aiStatus:aiPortalStatus(data),messages:messagesHTML(data.messages,true),
    composer:composer(data.conversation.id,{publicView:true})}));
  $('#portal-thread').scrollTop=$('#portal-thread').scrollHeight;
  pollTimer=setInterval(()=>pollPortal().catch(()=>{}),10000);
}

// The page keeps itself up to date while it is open, without taking the reader away from what they are reading.
async function pollPortal(){
  if(document.hidden)return;
  const token=state.portal.token;if(!token)return;
  try{
    const data=await api(`/api/public/${state.portal.slug}/session`);
    if(state.portal.token!==token)return;
    const node=$('#portal-thread');if(!node)return;
    $('#portal-ai-status').innerHTML=aiPortalStatus(data);
    syncMessageThread(node,messagesHTML(data.messages,true));
    const survey=$('#portal-survey'),key=JSON.stringify(data.survey);
    if(survey&&survey.dataset.key!==key){survey.dataset.key=key;survey.innerHTML=portalSurveyHTML(data.survey);}
    const view=portalState(data),head=$('#portal-state');
    if(head&&head.dataset.tone!==view.tone){
      head.dataset.tone=view.tone;head.className='portal-state tone-'+view.tone;
      $('#portal-state-label').textContent=view.label;
      $('#portal-state-hint').textContent=view.hint;
      $('#portal-steps').innerHTML=portalStepsHTML(view.step);
    }
  }catch(error){clearInterval(pollTimer);toast(error.message,true);throw error;}
}

async function initPortal(){
  clearInterval(pollTimer);
  const slug=location.pathname.split('/')[2];
  state.portal={slug,token:new URLSearchParams(location.hash.slice(1)).get('case'),query:'',category:''};
  try{
    state.portal.info=await api(`/api/public/${slug}`);
    document.title=`ศูนย์ช่วยเหลือ ${state.portal.info.organization.name} · Bookdose`;
    if(state.portal.token)await loadPortalSession();
    else{
      renderPortalHome();
      // A link the team sent from the knowledge base opens that article straight away.
      const article=new URLSearchParams(location.hash.slice(1)).get('article');
      if(article&&state.portal.info.articles.some(a=>a.id===article))actions['read-article'](null,article);
    }
  }catch(error){$('#app').innerHTML=render('pages/portal/portal-unavailable',{brand:brand(),message:empty('เปิดหน้าช่วยเหลือไม่สำเร็จ',error.message,'lock',render('pages/portal/retry-button'))});}
}

Object.assign(actions,{
  'portal-new':async(button,id)=>{location.hash='';state.portal.token=null;state.portal.query='';state.portal.category='';clearInterval(pollTimer);renderPortalHome();return;},
  'copy-tracking':async(button,id)=>{await copyText(location.href);return;},
  'portal-rate':async(button,id)=>{
    $$('[data-action="portal-rate"]').forEach(b=>b.disabled=true);
    try{await api(`/api/public/${state.portal.slug}/csat`,{rating:Number(button.dataset.value)});toast('ขอบคุณสำหรับคะแนนค่ะ');}
    finally{await pollPortal();}
    return;},
  'portal-category':async(button,id)=>{state.portal.category=button.dataset.value;
    $$('[data-action="portal-category"]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));refreshPortalArticles();return;},
  // The form is further down on a phone; this puts the reader in it with the cursor ready.
  'portal-ask':async(button,id)=>{const form=$('[data-form="portal-request"]');form?.scrollIntoView({block:'start',behavior:'smooth'});setTimeout(()=>$('[name="name"]',form)?.focus(),300);return;},
});

Object.assign(forms,{
  'portal-request':async(form,data)=>{
    delete data.files;data.attachments=await getFiles(form);
    const result=await api(`/api/public/${state.portal.slug}/conversations`,data);
    state.portal.token=result.token;location.hash=`case=${result.token}`;
    toast('ส่งเรื่องถึงทีมงานแล้ว เก็บลิงก์หน้านี้ไว้ติดตามคำตอบ');await loadPortalSession();return;
  },
  'portal-message':async(form,data)=>{
    delete data.files;data.attachments=await getFiles(form);await api(`/api/public/${state.portal.slug}/messages`,data);
    $('[name="body"]',form).value='';$('input[type="file"]',form).value='';$('[data-file-list]',form)?.replaceChildren();
    await pollPortal();toast('ส่งข้อความแล้ว');return;
  },
  // Someone who still has the tracking link but landed on the home page gets back to their conversation.
  'portal-track':async(form,data)=>{
    const link=String(data.link||'').trim();
    const token=(link.match(/case=([A-Za-z0-9_-]{20,100})/)||[])[1]||(/^[A-Za-z0-9_-]{20,100}$/.test(link)?link:'');
    if(!token)throw new Error('ลิงก์ติดตามไม่ถูกต้อง กรุณาวางลิงก์ทั้งบรรทัดที่ได้รับหลังส่งเรื่อง');
    const previous=state.portal.token;
    state.portal.token=token;
    // The address changes only once the conversation really opened, so a wrong link leaves the page as it was.
    try{await loadPortalSession();}
    catch(error){state.portal.token=previous;throw new Error('ไม่พบเรื่องจากลิงก์นี้ ลิงก์อาจหมดอายุ หรือคัดลอกมาไม่ครบ');}
    location.hash=`case=${token}`;
  },
});

document.addEventListener('input',event=>{
  if(event.target.id!=='portal-search')return;
  state.portal.query=event.target.value;refreshPortalArticles();
});
