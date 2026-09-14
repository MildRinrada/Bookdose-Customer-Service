/* Formatted writing for the reply composer and the article editor: what the writer sees is the result,
   not the marks. The visible box is an editable area; the form still carries plain text (Markdown) in a
   hidden field, so drafts, sending, storage, search and every channel keep working exactly as before. */

'use strict';

const richInline={B:'**',STRONG:'**',I:'*',EM:'*',U:'__',CODE:'`'};

/* Editable HTML -> the plain text that is stored and sent. Only the tags the toolbar can make are
   translated; anything else contributes its text, so nothing unexpected can be smuggled in. */
function richToText(node){
  if(node.nodeType===Node.TEXT_NODE)return node.nodeValue.replace(/ /g,' ');
  if(node.nodeType!==Node.ELEMENT_NODE)return '';
  const inner=()=>[...node.childNodes].map(richToText).join('');
  const mark=richInline[node.tagName];
  if(mark){const text=inner();return text.trim()?mark+text+mark:text;}
  switch(node.tagName){
    case 'BR':return '\n';
    case 'A':{const url=safeURL(node.getAttribute('href')||'');const text=inner();return url?`[${text}](${url})`:text;}
    case 'IMG':{const url=safeURL(node.getAttribute('src')||'',true);return url?`![${node.getAttribute('alt')||''}](${url})`:'';}
    case 'UL':case 'OL':{
      const items=[...node.children].filter(li=>li.tagName==='LI');
      return items.map((li,i)=>`${node.tagName==='UL'?'-':i+1+'.'} ${richToText(li).trim()}`).join('\n')+'\n';
    }
    case 'H1':case 'H3':return `# ${inner().trim()}\n`;
    case 'H2':case 'H4':return `## ${inner().trim()}\n`;
    case 'PRE':return '```\n'+node.textContent+'\n```\n';
    case 'P':case 'DIV':case 'LI':{const text=inner();return text.endsWith('\n')?text:text+'\n';}
    default:return inner();
  }
}

function richValue(editor){return [...editor.childNodes].map(richToText).join('').replace(/\n{3,}/g,'\n\n').replace(/[ \t]+\n/g,'\n').trim();}

// Keeps the two in step without either one echoing the other back.
function richWrite(field,value){field.dataset.richBusy='1';field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));delete field.dataset.richBusy;}

function richSource(editor){return $('#'+CSS.escape(editor.dataset.richFor));}

function richFill(editor,text){editor.innerHTML=String(text||'').trim()?markdownToHTML(text):'';}

/* Every editable area on the screen is prepared once and filled from its hidden field. */
function initRichFields(root=document){
  $$('.richtext:not([data-rich-ready])',root).forEach(editor=>{
    editor.dataset.richReady='1';
    richFill(editor,richSource(editor)?.value||'');
  });
}

/* Where the writer last had the cursor, so pressing a toolbar button formats the words that were selected. */
let richRange=null;
document.addEventListener('selectionchange',()=>{
  const selection=getSelection();
  if(!selection.rangeCount)return;
  const node=selection.getRangeAt(0).commonAncestorContainer;
  const editor=(node.nodeType===Node.ELEMENT_NODE?node:node.parentElement)?.closest?.('.richtext');
  if(editor)richRange={editor,range:selection.getRangeAt(0).cloneRange()};
});

// Pressing a tool must not move the cursor out of the text.
document.addEventListener('mousedown',event=>{if(event.target.closest?.('.tool'))event.preventDefault();});

function richRestore(editor){
  if(richRange?.editor!==editor)return;
  const selection=getSelection();
  selection.removeAllRanges();
  selection.addRange(richRange.range);
}

function richCommand(editor,kind){
  editor.focus();
  richRestore(editor);
  const simple={bold:'bold',italic:'italic',underline:'underline',bullet:'insertUnorderedList',number:'insertOrderedList'}[kind];
  if(simple)document.execCommand(simple);
  else if(['h1','h2','normal'].includes(kind))document.execCommand('formatBlock',false,{h1:'h3',h2:'h4',normal:'p'}[kind]);
  else if(kind==='code'){const text=String(getSelection()).trim();document.execCommand('insertHTML',false,`<code>${esc(text||'โค้ด')}</code>&nbsp;`);}
  else if(['link','image'].includes(kind))return askForURL(editor,kind);
  editor.dispatchEvent(new Event('input',{bubbles:true}));
}

/* A link is typed into a small dialog with a real field: the address is checked while it is typed, a bad one is
   answered in red under the field, and the article or reply being written stays untouched behind it. */
let pendingLink=null;

function askForURL(editor,kind){
  const image=kind==='image',text=String(getSelection()).trim();
  pendingLink={editor,kind};
  sheet(image?'แทรกรูปภาพ':'แทรกลิงก์',render('ui/link-form',{image,
    urlField:inputField(image?'ที่อยู่รูปภาพ (https://)':'ที่อยู่ลิงก์ (https://)','url',{type:'url',placeholder:'https://example.com/…',max:2000}),
    textField:image?inputField('คำอธิบายรูป (ไม่บังคับ)','text',{required:false,value:text,max:200,placeholder:'เช่น หน้าจอการตั้งค่า'})
      :inputField('ข้อความที่แสดง','text',{required:false,value:text,max:200,placeholder:'เว้นว่างเพื่อใช้ที่อยู่ลิงก์'}),
    label:image?'แทรกรูปภาพ':'แทรกลิงก์'}));
  $('#f-url')?.focus();
}

Object.assign(forms,{
  'rich-link':async(form,data)=>{
    const {editor,kind}=pendingLink||{};
    if(!editor)return closeSheet();
    const url=safeURL(String(data.url||'').trim(),kind==='image');
    if(!url)throw new Error(kind==='image'?'ที่อยู่รูปภาพต้องขึ้นต้นด้วย https:// และเปิดดูได้จริง':'ที่อยู่ลิงก์ต้องขึ้นต้นด้วย https:// หรือ http:// และถูกต้องตามรูปแบบ');
    const text=String(data.text||'').trim();
    closeSheet();pendingLink=null;
    editor.focus();richRestore(editor);
    if(kind==='image')document.execCommand('insertHTML',false,`<img src="${esc(url)}" alt="${esc(text)}">`);
    else if(String(getSelection())&&(!text||text===String(getSelection())))document.execCommand('createLink',false,url);
    else document.execCommand('insertHTML',false,`<a href="${esc(url)}">${esc(text||url)}</a>&nbsp;`);
    editor.dispatchEvent(new Event('input',{bubbles:true}));
  },
});

document.addEventListener('input',event=>{
  const node=event.target;
  if(node.classList?.contains('richtext')){const field=richSource(node);if(field)richWrite(field,richValue(node));return;}
  // Text put in by something else (a canned reply, an AI draft, an inserted article) shows up in the editor too.
  if(node.matches?.('.rich-source')&&!node.dataset.richBusy){const editor=$(`.richtext[data-rich-for="${node.id}"]`);if(editor&&richValue(editor)!==node.value)richFill(editor,node.value);}
});

// Pasted text arrives as text: formatting comes from the toolbar, never from whatever was copied.
document.addEventListener('paste',event=>{
  const editor=event.target.closest?.('.richtext');
  if(!editor)return;
  event.preventDefault();
  document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));
});

// The editable area keeps the text box shortcuts: Ctrl+Enter sends, Ctrl+B/I/U/K format.
document.addEventListener('keydown',event=>{
  const editor=event.target.closest?.('.richtext');
  if(!editor)return;
  if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();editor.closest('form')?.requestSubmit();return;}
  if(!(event.ctrlKey||event.metaKey)||event.altKey)return;
  const format={KeyB:'bold',KeyI:'italic',KeyU:'underline',KeyK:'link'}[event.code];
  const button=format&&$(`[data-action="editor-format"][data-format="${format}"]`,editor.closest('form'));
  if(button){event.preventDefault();button.click();}
});

try{document.execCommand('styleWithCSS',false,false);}catch{/* Older browsers keep their own default. */}
