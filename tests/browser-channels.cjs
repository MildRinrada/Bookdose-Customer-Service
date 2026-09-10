const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/homebrew/lib/node_modules/n8n/node_modules/playwright');
(async()=>{
  const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'bookdose-browser-channels-'));
  const base='http://127.0.0.1:18791',errors=[];
  const server=spawn('python3',['tests/channel_fixture_server.py','--port','18791'],{cwd:root,env:{...process.env,BOOKDOSE_DATA:path.join(temp,'data')},stdio:['ignore','pipe','pipe']});
  server.stderr.on('data',d=>errors.push(String(d)));server.stdout.on('data',d=>{if(String(d).includes('worker:'))errors.push(String(d));});let browser;
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timed out')),10000);server.stdout.on('data',d=>{if(String(d).includes('Open http')){clearTimeout(timer);resolve();}});server.once('exit',code=>{clearTimeout(timer);reject(Error('Server exit '+code));});});
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(base);await page.locator('[name="name"]').fill('ผู้ดูแลช่องทาง');
    await page.locator('[name="email"]').fill('channels@example.com');await page.locator('[name="password"]').fill('Browser-channel-test-123!');
    await page.getByRole('button',{name:'สร้างพื้นที่ทำงาน'}).click();await page.locator('.stats-grid').waitFor();
    await page.goto(base+'/#settings?tab=connections');await page.locator('#line-channel_secret').fill('browser-secret');
    await page.locator('#line-access_token').fill('browser-token');await page.locator('#channel-line [name="enabled"]').check();
    const saveLine=page.waitForResponse(r=>r.url().endsWith('/api/channels/line')&&r.request().method()==='PATCH');
    await page.getByRole('button',{name:'บันทึก LINE',exact:true}).click();assert.equal((await saveLine).status(),200);
    await page.locator('.channel-url').waitFor();assert.equal(await page.locator('#line-channel_secret').inputValue(),'');
    await page.locator('#email-address').fill('support@example.com');await page.locator('#email-username').fill('support@example.com');
    await page.locator('#email-password').fill('browser-password');await page.locator('#email-imap_host').fill('imap.example.com');
    await page.locator('#email-smtp_host').fill('smtp.example.com');await page.locator('#channel-email [name="enabled"]').check();
    const saveMail=page.waitForResponse(r=>r.url().endsWith('/api/channels/email')&&r.request().method()==='PATCH');
    await page.getByRole('button',{name:'บันทึก Email',exact:true}).click();assert.equal((await saveMail).status(),200);
    await page.waitForFunction(()=>document.querySelector('#email-password')?.value==='');
    const webhook=(await page.locator('.channel-url').textContent()).trim();
    const data=JSON.stringify({destination:'U'+'a'.repeat(32),events:[{webhookEventId:'browser-line-1',type:'message',timestamp:Date.now(),source:{type:'user',userId:'U'+'b'.repeat(32)},message:{id:'123',type:'text',text:'LINE browser test'}}]});
    const res=await page.request.post(webhook,{data,headers:{'Content-Type':'application/json','X-Line-Signature':crypto.createHmac('sha256','browser-secret').update(data).digest('base64')}});
    assert.equal(res.status(),200);
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
    await page.screenshot({path:path.join(root,'test-results','channel-settings-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(root,'test-results','channel-settings-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    for(const kind of ['LINE','Email']){
      await page.goto(base+'/#inbox');
      for(let attempt=0;attempt<10&&await page.locator('.inbox-item').filter({hasText:kind+' browser test'}).count()===0;attempt++){await page.waitForTimeout(600);await page.reload();}
      await page.locator('.inbox-item').filter({hasText:kind+' browser test'}).click();await page.locator('.composer[data-channel="'+kind.toLowerCase()+'"]').waitFor();
      assert.equal(await page.locator('.composer [name="files"]').isDisabled(),false);
      await page.locator('.composer textarea').fill('ตอบกลับ '+kind+' ที่ตรวจแล้ว');
      if(kind==='Email')await page.locator('.composer [name="files"]').setInputFiles({name:'reply.txt',mimeType:'text/plain',buffer:Buffer.from('attachment')});
      await page.locator('.composer button[type="submit"]').click();
      try{await page.locator('.message-footer').filter({hasText:'บริการปลายทางรับข้อความแล้ว'}).waitFor({timeout:25000});}catch(error){console.error({kind,errors,footers:await page.locator('.message-footer').allTextContents(),toast:await page.locator('#toast').textContent(),composer:await page.locator('.composer').innerHTML()});throw error;}
      await page.locator('.composer [value="note"]').check();
      assert.equal(await page.locator('.composer [name="files"]').isDisabled(),false);
      await page.locator('.composer textarea').fill('PRIVATE internal note '+kind);
      await page.locator('.composer button[type="submit"]').click();
      await page.locator('.message.note').filter({hasText:'PRIVATE internal note '+kind}).waitFor();
      await page.screenshot({path:path.join(root,'test-results','channel-'+kind.toLowerCase()+'-inbox.png'),fullPage:true});
    }
    assert.deepEqual(errors,[]);console.log('Channel browser passed: settings, secret redaction, mobile, LINE webhook, Email ingestion, replies, attachments, internal notes.');
  }finally{if(browser)await browser.close();server.kill('SIGINT');await new Promise(resolve=>{server.once('exit',resolve);setTimeout(resolve,3000);});fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
