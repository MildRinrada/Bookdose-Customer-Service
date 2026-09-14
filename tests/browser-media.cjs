/* Inline attachment regression checks with local fixtures; never accesses a real workspace or customer data.
   PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome node tests/browser-media.cjs */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),base='http://127.0.0.1:18889';
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const scripts=['frontend/core.js','frontend/template.js','frontend/services/api.js','frontend/ui/ui.js','frontend/ui/richtext.js','frontend/ui/media.js','frontend/pages/knowledge/knowledge.js','frontend/pages/inbox/inbox.js'];
const styles=['css/base.css','css/components.css','css/layout.css','css/pages/inbox.css','css/text-size.css','css/theme.css'];
const templates={};
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(file.endsWith('.html'))templates[path.relative(path.join(root,'frontend'),file).replaceAll('\\','/').slice(0,-5)]=fs.readFileSync(file,'utf8');}}
walk(path.join(root,'frontend'));

(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  try{
    const page=await browser.newPage({viewport:{width:1100,height:900}}),errors=[],requests=[];
    page.on('pageerror',error=>errors.push(error.message));
    let video,failImage=false;
    let png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64');
    const csp=read('backend/middleware/security.py').match(/CONTENT_SECURITY_POLICY = "([^"]+)"/)[1];
    await page.route(base+'/**',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':csp},body:
        '<!doctype html><html lang="th"><head><meta charset="utf-8">'+styles.map(p=>`<link rel="stylesheet" href="/${p}">`).join('')+scripts.map(p=>`<script defer src="/${p}"></script>`).join('')+
        '</head><body><div id="app"><div class="thread" id="test-thread" data-thread="conversation"></div></div><dialog id="modal"><div id="modal-content"></div></dialog><dialog id="sheet"><div id="sheet-content"></div></dialog><div id="toast"></div></body></html>'});
      if(url.pathname==='/templates.json')return route.fulfill({json:templates});
      if(scripts.includes(url.pathname.slice(1))||styles.includes(url.pathname.slice(1)))return route.fulfill({contentType:url.pathname.endsWith('.js')?'text/javascript':'text/css',body:read(url.pathname.slice(1))});
      if(url.pathname.includes('/attachments/')){
        requests.push({path:url.pathname,headers:request.headers()});
        if(url.pathname.endsWith('/broken')&&failImage)return route.fulfill({status:403,json:{error:'No access'}});
        return route.fulfill({contentType:url.pathname.endsWith('/video')?'video/webm':'image/png',body:url.pathname.endsWith('/video')?video:png});
      }
      return route.fulfill({status:404,body:''});
    });
    await page.goto(base);
    await page.evaluate(async()=>{
      await loadTemplates();state.boot={user:{id:'agent'},tenant_id:'tenant-a',csrf:'test-csrf'};
      window.aiCitationsHTML=()=>'';window.channelDeliveryHTML=m=>'<p class="delivery-state">'+esc(m.delivery||'sent')+'</p>';
      document.addEventListener('click',async event=>{
        const button=event.target.closest('[data-action]');if(!button)return;
        if(button.dataset.action==='close-modal'){closeModal(true);return;}
        await actions[button.dataset.action]?.(button,button.dataset.id);
      });
      window.fixtures=[{id:'m-image',kind:'reply',body:'ภาพประกอบปัญหา',author_name:'เจ้าหน้าที่',created_at:new Date().toISOString(),attachments:[{id:'image',mime:'image/png',name:'ภาพหน้าจอ.png',size:100}]},
        {id:'m-video',kind:'customer',body:'วิดีโอปัญหา',author_name:'ลูกค้า',created_at:new Date().toISOString(),attachments:[{id:'video',mime:'video/webm',name:'บันทึกหน้าจอ.webm',size:1000}]}];
    });
    // A real, playable video fixture produced locally in Chrome.
    video=Buffer.from(await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
      const ctx=canvas.getContext('2d'),stream=canvas.captureStream(15),chunks=[];
      const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
      recorder.ondataavailable=event=>chunks.push(event.data);
      const finished=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
      let n=0;const timer=setInterval(()=>{ctx.fillStyle=n++%2?'#5835b3':'#8b6fd6';ctx.fillRect(0,0,320,180);},60);
      await new Promise(resolve=>setTimeout(resolve,800));clearInterval(timer);recorder.stop();await finished;stream.getTracks().forEach(track=>track.stop());
      return [...new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer())];
    }));
    png=Buffer.from(await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=720;canvas.height=420;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#f0edf8';ctx.fillRect(0,0,720,420);
      ctx.fillStyle='#5835b3';ctx.fillRect(0,0,720,68);ctx.fillStyle='#fff';ctx.font='24px sans-serif';ctx.fillText('Customer support - screenshot',24,44);
      ctx.fillStyle='#fff';ctx.fillRect(24,96,672,294);ctx.fillStyle='#26354a';ctx.font='28px sans-serif';ctx.fillText('Example attachment',48,152);
      ctx.fillStyle='#d8ccef';ctx.fillRect(48,180,624,24);ctx.fillRect(48,224,430,24);ctx.fillStyle='#5835b3';ctx.fillRect(48,296,180,52);
      ctx.fillStyle='#fff';ctx.font='20px sans-serif';ctx.fillText('View details',78,330);
      return canvas.toDataURL('image/png').split(',')[1];
    }),'base64');
    await page.evaluate(()=>{document.querySelector('#test-thread').innerHTML=messagesHTML(fixtures);scrollThreadsToEnd();});
    await page.waitForFunction(()=>[...document.querySelectorAll('.message-media')].every(n=>n.dataset.mediaState==='ready'));
    assert.equal(requests.length,2);
    assert(requests.every(r=>r.headers['x-tenant-id']==='tenant-a'&&r.headers['x-csrf-token']==='test-csrf'));
    const image=page.locator('.media-image-button img'),player=page.locator('video');
    if(process.env.MEDIA_SCREENSHOT){await page.locator('#test-thread').evaluate(node=>node.scrollTop=0);await page.screenshot({path:process.env.MEDIA_SCREENSHOT,fullPage:true});}
    assert(await image.evaluate(img=>img.naturalWidth>0));
    assert(await player.evaluate(video=>video.controls&&video.playsInline&&video.paused&&!video.autoplay));
    await image.click();await page.locator('#modal[open] .media-viewer img').waitFor();
    assert(await page.locator('.media-viewer img').evaluate(img=>img.complete&&img.naturalWidth>0));
    await page.keyboard.press('Escape');assert.equal(await page.locator('#modal').evaluate(n=>n.open),false);
    await player.evaluate(async video=>{window.originalVideo=video;video.loop=true;await video.play();});
    await page.evaluate(()=>{
      fixtures[1].delivery='updated';fixtures[0].delivery='delivered';
      fixtures.push({id:'new',kind:'reply',body:'ข้อความใหม่',author_name:'เจ้าหน้าที่',created_at:new Date().toISOString(),attachments:[]});
      syncMessageThread(document.querySelector('#test-thread'),messagesHTML(fixtures));
    });
    assert(await player.evaluate(video=>video===window.originalVideo&&!video.paused));
    assert.equal(requests.length,2,'polling must not fetch media again');
    assert.equal(await page.locator('.delivery-state').first().textContent(),'delivered');
    assert.equal(await page.locator('[data-message-id]').count(),3);
    await page.evaluate(()=>{syncMessageThread(document.querySelector('#test-thread'),messagesHTML(fixtures));});
    assert(await player.evaluate(video=>video===window.originalVideo&&!video.paused));
    await player.evaluate(video=>video.pause());
    for(const width of [1100,390]){
      await page.setViewportSize({width,height:900});
      await page.evaluate(()=>document.documentElement.setAttribute('data-text-size','150'));
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
      for(const figure of await page.locator('.message-media').all()){const box=await figure.boundingBox();assert(box.width<=width);}
    }
    failImage=true;
    await page.evaluate(()=>{
      fixtures.push({id:'failed',kind:'reply',body:'',author_name:'เจ้าหน้าที่',created_at:new Date().toISOString(),attachments:[{id:'broken',mime:'image/png',name:'try-again.png',size:100}]});
      syncMessageThread(document.querySelector('#test-thread'),messagesHTML(fixtures));scrollThreadsToEnd();
    });
    await page.locator('[data-media-id="broken"][data-media-state="error"]').waitFor();failImage=false;
    await page.locator('[data-media-id="broken"] [data-action="retry-media"]').click();
    await page.locator('[data-media-id="broken"][data-media-state="ready"]').waitFor();
    await page.evaluate(()=>{
      state.portal={slug:'alpha',token:'private-visitor-token'};
      document.querySelector('#test-thread').innerHTML=messagesHTML(fixtures.slice(0,1),true);scrollThreadsToEnd();
    });
    await page.locator('[data-media-state="ready"]').waitFor();
    assert.equal(requests.at(-1).headers['x-portal-token'],'private-visitor-token');
    assert(requests.at(-1).path.startsWith('/api/public/alpha/attachments/'));
    await page.evaluate(()=>{document.querySelector('#test-thread').replaceChildren();});
    await page.waitForFunction(()=>mediaResources.size===0&&pendingMedia.size===0);
    assert.deepEqual(errors,[]);
    console.log('PASS: inline images, playable video, authenticated fetch, image viewer, polling preserves playback, retry, mobile/150% text, portal token, object URL cleanup.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
