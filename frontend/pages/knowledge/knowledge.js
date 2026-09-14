/* Knowledge base: article list, filters, reading view, editor and the small safe Markdown renderer.
   Markup: pages/knowledge/, ui/filter-pill.html. */

'use strict';

const visibilityLabels={public:'เผยแพร่ให้ลูกค้า',internal:'ภายในองค์กร'};

const articleSorts={updated:'อัปเดตล่าสุด',title:'ชื่อ ก-ฮ',category:'ตามหมวดหมู่'};

function filteredArticles(){
  const q=uiState.articleQuery.toLowerCase();
  const list=state.articles.filter(a=>(!uiState.category||a.category===uiState.category)&&(!uiState.visibility||a.visibility===uiState.visibility)&&(!q||[a.title,a.body,a.category].some(s=>s.toLowerCase().includes(q))));
  const sort=uiState.articleSort||'updated';
  return list.sort((a,b)=>sort==='updated'?String(b.updated_at).localeCompare(String(a.updated_at))
    :sort==='title'?a.title.localeCompare(b.title,'th')
    :(a.category.localeCompare(b.category,'th')||a.title.localeCompare(b.title,'th')));
}

function knowledgePage(){
  const visible=filteredArticles(),counts=new Map();
  state.articles.forEach(a=>counts.set(a.category,(counts.get(a.category)||0)+1));
  return render('pages/knowledge/knowledge',{canWrite:state.work.role!=='agent',count:visible.length,
    search:searchInput('article-search','ค้นหาบทความ','ค้นหาชื่อบทความ เนื้อหา หรือหมวดหมู่',uiState.articleQuery),
    visibilityFilter:filterSelect('article-filter-visibility','สิทธิ์การอ่านบทความ',options({'':'ทุกสิทธิ์',...visibilityLabels},uiState.visibility)),
    sortFilter:filterSelect('article-sort','เรียงลำดับบทความ',options(articleSorts,uiState.articleSort||'updated')),
    categoryPills:['',...new Set(state.articles.map(a=>a.category))].sort((a,b)=>a?(b?a.localeCompare(b,'th'):1):-1)
      .map(c=>filterPill('article-category',c,c||'ทั้งหมด',{pressed:uiState.category===c,count:c?counts.get(c):state.articles.length})).join(''),
    cards:articleCards(visible),pager:pagerHTML(paginate('knowledge',visible,{size:12,refresh:refreshArticles}),'บทความ',[12,24,48])});
}

/* The first part of the article, still formatted. Cut at a line or a word so a list is not chopped mid-item;
   an unfinished code fence is closed by the renderer itself. */
function articlePreview(body,limit=240){
  const text=String(body||'').trim();
  if(text.length<=limit)return markdownToHTML(text);
  const cut=text.slice(0,limit),stop=Math.max(cut.lastIndexOf('\n'),cut.lastIndexOf(' '));
  return markdownToHTML((stop>80?cut.slice(0,stop):cut).trim()+' …');
}

function articleCards(articles){
  return paginate('knowledge',articles,{size:12,refresh:refreshArticles}).shown.map(a=>render('pages/knowledge/article-card',{id:a.id,title:a.title,excerpt:articlePreview(a.body),category:a.category,
    updated:relative(a.updated_at),isPublic:a.visibility==='public',visibilityLabel:visibilityLabels.public})).join('')
    ||empty('ไม่พบบทความ','ลองเปลี่ยนคำค้นหรือเลือกหมวด “ทั้งหมด”','book');
}

function refreshArticles(){
  const grid=$('#articles-grid');if(!grid)return;
  const visible=filteredArticles();
  grid.innerHTML=articleCards(visible);
  $('#articles-pager').innerHTML=pagerHTML(paginate('knowledge',visible,{size:12,refresh:refreshArticles}),'บทความ',[12,24,48]);
  const count=$('.article-count');if(count)count.textContent=`${visible.length} บทความ`;
}

function openArticle(id){
  const article=state.articles.find(a=>a.id===id);if(!article)return;state.readArticle=article;
  modal(article.title,render('pages/knowledge/article-read',{id:article.id,category:article.category,visibilityLabel:visibilityLabels[article.visibility]||visibilityLabels.internal,
    updated:date(article.updated_at,true),content:markdownToHTML(article.body),canInsert:!!document.querySelector('.composer'),canEdit:state.work.role!=='agent'}));
}

function articleForm(article){
  const a=article||{};
  modal(article?'แก้ไขบทความ':'เขียนบทความใหม่',render('pages/knowledge/article-form',{id:a.id||'',category:a.category||'ทั่วไป',body:a.body||'',
    titleField:inputField('ชื่อบทความ','title',{value:a.title||'',placeholder:'เช่น วิธีตั้งค่า Bookdose e-Library สำหรับผู้ดูแล',max:200}),
    categoryOptions:[...new Set(state.articles.map(a=>a.category))].map(value=>render('pages/knowledge/datalist-option',{value})).join(''),
    visibilityOptions:options({internal:visibilityLabels.internal,public:visibilityLabels.public},a.visibility||'internal'),formActions:formActions('บันทึกบทความ')}),{wide:true});
  enhanceForms(document.querySelector('#modal'));
  updateArticleCount();
}

function updateArticleSubmit(form){const button=form.querySelector('button[type="submit"]');if(button)button.disabled=!form.elements.title.value.trim()||!form.elements.body.value.trim();}

function updateArticleCount(){
  const input=$('#article-body'),count=$('[data-word-count]');
  if(!input||!count)return;
  const words=input.value.trim()?input.value.trim().split(/\s+/).length:0;
  count.textContent=`${words} คำ · ${input.value.length.toLocaleString('th-TH')}/50,000 ตัวอักษร`;
}

function hasUnsavedArticle(){if(!document.querySelector('#modal')?.open)return false;const f=document.querySelector('[data-form="article"]');return f&&!f.dataset.saved&&f.dataset.initial!==JSON.stringify(Object.fromEntries(new FormData(f)));}

/* Closing an editor with unsaved words asks first - in the app's own dialog, on top of the editor, so the
   answer "keep writing" really does leave the text exactly where it was. */
function confirmModalClose(){
  if(!hasUnsavedArticle())return true;
  confirmSheet({title:'ยังไม่ได้บันทึกบทความ',message:'เนื้อหาที่พิมพ์ไว้จะหายไปทั้งหมดหากปิดตอนนี้ ต้องการทิ้งการแก้ไขหรือไม่?',
    cancelLabel:'กลับไปเขียนต่อ',confirmLabel:'ทิ้งการแก้ไข',tone:'danger',run:()=>{$('#modal').close();}});
  return false;
}

function safeURL(value,image=false){try{const url=new URL(value,location.origin);return ((url.protocol==='https:'||(!image&&url.protocol==='http:'))&&!url.username&&!url.password)?url.href:null;}catch{return null;}}

function markdownInline(text){
  // Escape all source HTML. Only this small allowlist creates markup.
  const tokens=/(!?\[[^\]\n]*\]\([^\s)]+\)|`[^`\n]+`|\*\*\*[^*\n]+\*\*\*|\*\*(?:(?!\*\*)[^\n])+\*\*|__(?:(?!__)[^\n])+__|\*[^*\n]+\*)/g;
  return text.split(tokens).map(part=>{
    const link=part.match(/^(!?)\[([^\]]*)\]\(([^)]+)\)$/);
    if(link){const url=safeURL(link[3],!!link[1]);return url?(link[1]?`<img class="article-image" src="${esc(url)}" alt="${esc(link[2])}" loading="lazy" referrerpolicy="no-referrer">`:`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(link[2])}</a>`):esc(part);}
    // Marks may be combined (bold + italic, bold + underline), so the text inside a mark is read the same way.
    if(part.startsWith('***')&&part.endsWith('***'))return `<strong><em>${markdownInline(part.slice(3,-3))}</em></strong>`;
    if(part.startsWith('**')&&part.endsWith('**'))return `<strong>${markdownInline(part.slice(2,-2))}</strong>`;
    if(part.startsWith('__')&&part.endsWith('__'))return `<u>${markdownInline(part.slice(2,-2))}</u>`;
    if(part.startsWith('*')&&part.endsWith('*'))return `<em>${markdownInline(part.slice(1,-1))}</em>`;
    if(part.startsWith('`')&&part.endsWith('`'))return `<code>${esc(part.slice(1,-1))}</code>`;
    return esc(part);
  }).join('');
}

function markdownToHTML(text){let out='',list='',code=null;const close=()=>{if(list){out+=`</${list}>`;list='';}};for(const line of String(text).split('\n')){
  if(line.startsWith('```')){close();if(code===null)code=[];else{out+=`<pre><code>${esc(code.join('\n'))}</code></pre>`;code=null;}continue;}
  if(code!==null){code.push(line);continue;}
  // People type "•" as often as "-" for a bullet; both make the same list.
  const item=line.match(/^\s*(?:([-*•])|\d+\.)\s+(.*)$/),head=line.match(/^(#{1,2})\s+(.*)$/);
  if(item){const type=item[1]?'ul':'ol';if(list!==type){close();list=type;out+=`<${type}>`;}out+=`<li>${markdownInline(item[2])}</li>`;}
  else{close();out+=head?`<h${head[1].length+2}>${markdownInline(head[2])}</h${head[1].length+2}>`:line.trim()?`<p>${markdownInline(line)}</p>`:'';}
}close();if(code!==null)out+=`<pre><code>${esc(code.join('\n'))}</code></pre>`;return out;}

Object.assign(actions,{
  'new-article':async(button,id)=>{return articleForm();},
  'edit-article':async(button,id)=>{return articleForm(state.articles.find(a=>a.id===id));},
  'delete-article':async(button,id)=>{
    const article=state.articles.find(a=>a.id===id);
    confirmDelete({title:'ลบบทความ',warning:`“${article.title}” จะถูกย้ายไปถังขยะ`,
      effects:['บทความจะหายจากคลังความรู้ของทีมทันที',...(article.visibility==='public'?['ลูกค้าจะไม่เห็นบทความนี้ในหน้าช่วยเหลืออีกต่อไป']:[]),'กู้คืนได้จากเมนูถังขยะภายใน 30 วัน หลังจากนั้นระบบจะลบถาวร','การลบจะถูกบันทึกในประวัติการทำงาน'],
      confirmLabel:'ย้ายบทความไปถังขยะ',
      run:async()=>{await api('/api/articles/'+id,undefined,'DELETE');toast('ย้ายบทความไปถังขยะแล้ว · กู้คืนได้ที่เมนูถังขยะ');await route();}});
    return;},
  'article-category':async(button,id)=>{uiState.category=button.dataset.value;goToPage('knowledge',1);$$('[data-action="article-category"]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));refreshArticles();return;},
  'read-article':async(button,id)=>{if(state.portal){const a=state.portal.info.articles.find(a=>a.id===id);if(a)modal(a.title,render('pages/knowledge/portal-article',{category:a.category,updated:date(a.updated_at),content:markdownToHTML(a.body)}));}else openArticle(id);return;},
  'article-copy':async(button,id)=>{await navigator.clipboard.writeText(state.readArticle.body);toast('คัดลอกเนื้อหาแล้ว');return;},
  'article-link':async(button,id)=>{await navigator.clipboard.writeText(location.origin+'/#knowledge/'+state.readArticle.id+'?tenant='+state.boot.tenant_id);toast('คัดลอกลิงก์สำหรับผู้มีสิทธิ์เข้าองค์กรแล้ว');return;},
  'article-insert':async(button,id)=>{const composer=document.querySelector('.composer');if(!composer)throw new Error('กรุณาเปิดบทสนทนาก่อน');const input=composer.elements.body;input.value+=(input.value?'\n\n':'')+state.readArticle.body;input.dispatchEvent(new Event('input',{bubbles:true}));closeModal();($('.richtext',composer)||input).focus();toast('แทรกในช่องร่างแล้ว กรุณาตรวจสอบก่อนส่ง');return;},
  // Used by the article editor and by the reply composer: formatting is applied where the writer sees it.
  'editor-format':async(button,id)=>{const editor=$('.richtext',button.closest('form'));if(editor)richCommand(editor,button.dataset.format);return;},
});

Object.assign(forms,{
  'article':async(form,data)=>{const id=form.dataset.id;await api(`/api/articles${id?'/'+id:''}`,data,id?'PATCH':'POST');form.dataset.saved='1';closeModal();toast('บันทึกบทความเรียบร้อยแล้ว');await route();return;},
});

document.addEventListener('input',e=>{const n=e.target;
  const articleForm=n.closest?.('[data-form="article"]');
  if(articleForm)updateArticleSubmit(articleForm);
  if(n.id==='article-body')updateArticleCount();
  if(n.id==='article-search'){uiState.articleQuery=n.value;goToPage('knowledge',1);refreshArticles();}});
document.addEventListener('change',e=>{const n=e.target;
  if(n.id==='article-filter-visibility'){uiState.visibility=n.value;refreshArticles();}
  if(n.id==='article-sort'){uiState.articleSort=n.value;refreshArticles();}});

document.addEventListener('keydown',e=>{const card=e.target.closest('.article-card[role="button"]');if(card&&['Enter',' '].includes(e.key)){e.preventDefault();card.click();}});
window.addEventListener('beforeunload',e=>{if(hasUnsavedArticle()){e.preventDefault();e.returnValue='';}});
