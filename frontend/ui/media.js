/* Private attachments are fetched through the same authenticated API as downloads.
   Object URLs stay local to the page; no tenant or visitor credentials go into media URLs. */
'use strict';

const mediaResources=new Map(),messageMarkup=new WeakMap();
const inlineImageTypes=new Set(['image/png','image/jpeg','image/gif','image/webp']);
const inlineVideoTypes=new Set(['video/mp4','video/webm']);

function messageAttachment(file,publicView=false){
  const image=inlineImageTypes.has(file.mime),video=inlineVideoTypes.has(file.mime);
  return render(image||video?'pages/inbox/message-media':'pages/inbox/message-file',{
    id:file.id,name:file.name,mime:file.mime,size:Math.ceil(file.size/1024),public:publicView?'yes':'no',image,video});
}

function mediaScope(){return JSON.stringify([state.boot?.user?.id,state.boot?.tenant_id,state.portal?.slug,state.portal?.token]);}

function releaseMedia(node){
  const resource=mediaResources.get(node);
  if(resource?.url)URL.revokeObjectURL(resource.url);
  mediaResources.delete(node);
}

function pinAfterMedia(node){
  const thread=node.closest('[data-thread]');
  if(thread&&thread.dataset.pinned!=='no')thread.scrollTop=thread.scrollHeight;
}

function mediaFailed(figure){
  if(!figure.isConnected)return;
  figure.dataset.mediaState='error';
  pinAfterMedia(figure);
}

async function loadMessageMedia(figure){
  if(!figure.isConnected||mediaResources.has(figure))return;
  const scope=mediaScope(),resource={scope};
  mediaResources.set(figure,resource);
  figure.dataset.mediaState='loading';
  const path=figure.dataset.public==='yes'
    ?`/api/public/${state.portal.slug}/attachments/${figure.dataset.mediaId}`
    :`/api/attachments/${figure.dataset.mediaId}`;
  try{
    const blob=await api(path);
    if(mediaResources.get(figure)!==resource)return;
    if(!figure.isConnected||scope!==mediaScope()){releaseMedia(figure);return;}
    if(!(blob instanceof Blob)||blob.type.split(';')[0]!==figure.dataset.mime)throw new Error('Unexpected media type');
    resource.blob=blob;resource.url=URL.createObjectURL(blob);
    const media=figure.querySelector('img,video');
    media.addEventListener('error',()=>mediaFailed(figure),{once:true});
    media.addEventListener(media.tagName==='IMG'?'load':'loadeddata',()=>{
      if(!figure.isConnected)return;
      figure.dataset.mediaState='ready';pinAfterMedia(figure);
    },{once:true});
    media.src=resource.url;
    // Expose video controls as soon as metadata is available, without starting playback.
    if(media.tagName==='VIDEO')media.addEventListener('loadedmetadata',()=>{
      figure.dataset.mediaState='ready';pinAfterMedia(figure);
    },{once:true});
  }catch{if(mediaResources.get(figure)===resource)mediaFailed(figure);}
}

const mediaVisibility=new IntersectionObserver(entries=>{
  for(const entry of entries)if(entry.isIntersecting){mediaVisibility.unobserve(entry.target);pendingMedia.delete(entry.target);loadMessageMedia(entry.target);}
},{rootMargin:'240px'});
const observedMedia=new WeakSet(),pendingMedia=new Set();

function rememberMessages(root){
  root.querySelectorAll('[data-message-id]').forEach(node=>{
    if(!messageMarkup.has(node))messageMarkup.set(node,node.outerHTML);
  });
}

function scanMessageMedia(){
  rememberMessages(document);
  for(const node of pendingMedia)if(!node.isConnected){mediaVisibility.unobserve(node);pendingMedia.delete(node);}
  for(const [node,resource] of mediaResources){
    if(!node.isConnected||resource.scope!==mediaScope()){
      node.querySelector?.('video')?.pause();
      node.querySelectorAll?.('img,video').forEach(media=>media.removeAttribute('src'));
      if(node.matches?.('img'))node.removeAttribute('src');
      releaseMedia(node);
    }
  }
  document.querySelectorAll('.message-media').forEach(figure=>{
    if(!observedMedia.has(figure)){observedMedia.add(figure);pendingMedia.add(figure);mediaVisibility.observe(figure);}
  });
}
new MutationObserver(scanMessageMedia).observe(document.body,{childList:true,subtree:true});

// Keep live media elements when polling updates a delivery label or appends a message.
function patchMessageNode(current,fresh){
  if(current.nodeType!==fresh.nodeType||current.nodeName!==fresh.nodeName){current.replaceWith(fresh);return fresh;}
  if(current.nodeType===Node.TEXT_NODE){if(current.textContent!==fresh.textContent)current.textContent=fresh.textContent;return current;}
  if(current.nodeType!==Node.ELEMENT_NODE)return current;
  if(current.matches('.message-media')&&fresh.matches('.message-media')&&
    ['mediaId','mime','name','public'].every(key=>current.dataset[key]===fresh.dataset[key]))return current;
  if(current.isEqualNode(fresh))return current;
  for(const attr of [...current.attributes])if(!fresh.hasAttribute(attr.name))current.removeAttribute(attr.name);
  for(const attr of fresh.attributes)if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
  const children=[...fresh.childNodes];
  children.forEach((child,index)=>{
    if(current.childNodes[index])patchMessageNode(current.childNodes[index],child);
    else current.append(child);
  });
  while(current.childNodes.length>children.length)current.lastChild.remove();
  return current;
}

function syncMessageThread(thread,html){
  rememberMessages(thread);
  const template=document.createElement('template');template.innerHTML=html;
  const children=[...template.content.children],existing=new Map([...thread.querySelectorAll('[data-message-id]')].map(node=>[node.dataset.messageId,node]));
  const pinned=thread.scrollHeight-thread.scrollTop-thread.clientHeight<100;
  children.forEach((fresh,index)=>{
    const markup=fresh.outerHTML,id=fresh.dataset.messageId;
    let current=id?existing.get(id):thread.children[index];
    if(current&&(id||current.isEqualNode(fresh))){
      if(id&&messageMarkup.get(current)!==markup)current=patchMessageNode(current,fresh);
    }else current=fresh;
    if(thread.children[index]!==current)thread.insertBefore(current,thread.children[index]||null);
    if(id)messageMarkup.set(current,markup);
  });
  while(thread.children.length>children.length)thread.lastElementChild.remove();
  if(pinned)thread.scrollTop=thread.scrollHeight;
}

Object.assign(actions,{
  'retry-media':async(button)=>{
    const figure=button.closest('.message-media');releaseMedia(figure);await loadMessageMedia(figure);
  },
  'view-image':async(button)=>{
    const figure=button.closest('.message-media'),resource=mediaResources.get(figure);
    if(!resource?.blob||resource.scope!==mediaScope())return;
    modal(figure.dataset.name,render('ui/media-viewer',{
      name:figure.dataset.name,id:figure.dataset.mediaId,public:figure.dataset.public}),{wide:true});
    const image=document.querySelector('.media-viewer img'),url=URL.createObjectURL(resource.blob);
    mediaResources.set(image,{url,scope:resource.scope});image.src=url;
  },
});
document.querySelector('#modal').addEventListener('close',()=>{
  document.querySelectorAll('.media-viewer img').forEach(image=>{image.removeAttribute('src');releaseMedia(image);});
});
