const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/homebrew/lib/node_modules/n8n/node_modules/playwright');
(async()=>{
  const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'bookdose-browser-channels-'));
  const base='http://127.0.0.1:18792',errors=[];
  const server=spawn('python3',['tests/channel_fixture_server.py','--port','18792'],{cwd:root,env:{...process.env,BOOKDOSE_DATA:path.join(temp,'data')},stdio:['ignore','pipe','pipe']});
  server.stderr.on('data',d=>errors.push(String(d)));let browser;
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timed out')),10000);server.stdout.on('data',d=>{if(String(d).includes('Open http')){clearTimeout(timer);resolve();}if(String(d).includes('worker:'))errors.push(String(d));});server.once('exit',code=>{clearTimeout(timer);reject(Error('Server exit '+code));});});
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(base);await page.locator('[name="name"]').fill('ผู้ดูแลทดสอบ');await page.locator('[name="email"]').fill('extensions@example.com');await page.locator('[name="password"]').fill('Browser-extension-123!');
    await page.getByRole('button',{name:'สร้างพื้นที่ทำงาน'}).click();await page.locator('.stats-grid').waitFor();
    await page.goto(base+'/#settings?tab=ai');await page.locator('#ai-key').fill('sk-browser-extensions-0123456789');await page.locator('[name="drafts_enabled"]').check();
    await page.getByRole('button',{name:'บันทึกการตั้งค่า AI'}).click();await page.getByText('บันทึก API Key แล้ว',{exact:true}).waitFor();
    await page.goto(base+'/#knowledge');await page.getByRole('button',{name:'เขียนบทความ'}).click();
    await page.locator('[name="title"]').fill('ดาวน์โหลดรายงาน');await page.locator('#article-visibility').selectOption('public');
    await page.locator('#article-body').fill('เปิดเมนูรายงาน แล้วเลือกดาวน์โหลดรายงานการอ่านประจำเดือน เลือกช่วงเวลาและกดส่งออก CSV');
    await page.getByRole('button',{name:'บันทึกบทความ'}).click();await page.getByRole('heading',{name:'ดาวน์โหลดรายงาน',exact:true}).waitFor();
    const save=async kind=>{
      const response=page.waitForResponse(r=>r.url().endsWith('/api/channels/'+kind)&&r.request().method()==='PATCH');
      await page.getByRole('button',{name:'บันทึก '+(kind==='line'?'LINE':'Email'),exact:true}).click();
      assert.equal((await response).status(),200);await page.waitForFunction(()=>!document.querySelector('button[type="submit"]:disabled'));
      await page.waitForTimeout(200);
    };
    await page.goto(base+'/#settings?tab=connections');
    for(const provider of ['google','microsoft']){
      await page.locator('#email-auth_mode').selectOption(provider);await page.locator('#email-address').fill('support@example.com');await page.locator('#email-username').fill('support@example.com');
      await page.locator('#email-oauth_client_id').fill(provider+'-browser-client');await page.locator('#email-oauth_client_secret').fill('browser-client-secret');
      await page.locator('#email-oauth_redirect_uri').fill(base+'/oauth/email/callback');await save('email');
      await page.locator('[data-action="channel-oauth"]').click();
      await page.locator('#oauth-result').filter({hasText:'เชื่อมบัญชีสำเร็จ'}).waitFor();
      assert.equal(new URL(page.url()).search,'');await page.getByRole('link',{name:'กลับไปตั้งค่าองค์กร'}).click();
      await page.locator('#email-auth_mode').waitFor();assert.equal(await page.locator('#email-oauth_client_secret').inputValue(),'');
    }
    await page.locator('#channel-email [name="chatbot_enabled"]').check();await page.locator('#channel-email [name="enabled"]').check();await save('email');
    await page.locator('#line-channel_secret').fill('browser-secret');await page.locator('#line-access_token').fill('browser-token');await page.locator('#line-public_base_url').fill('https://support.example.com');
    for(const name of ['enabled','groups_enabled','group_chatbot_enabled','chatbot_enabled'])await page.locator('#channel-line [name="'+name+'"]').check();await save('line');
    const webhook=(await page.locator('.channel-url').textContent()).trim();
    const data=JSON.stringify({destination:'U'+'a'.repeat(32),events:[{webhookEventId:'extended-group-1',type:'message',timestamp:Date.now(),source:{type:'group',groupId:'C'+'c'.repeat(32),userId:'U'+'b'.repeat(32)},message:{id:'123',type:'text',text:'/bookdose ดาวน์โหลดรายงานการอ่านอย่างไร'}}]});
    assert.equal((await page.request.post(webhook,{data,headers:{'Content-Type':'application/json','X-Line-Signature':crypto.createHmac('sha256','browser-secret').update(data).digest('base64')}})).status(),200);
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results','extended-channel-settings.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(root,'test-results','extended-channel-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1000});
    await page.goto(base+'/#inbox');
    for(let i=0;i<10&&await page.locator('.inbox-item').filter({hasText:'กลุ่ม LINE'}).count()===0;i++){await page.waitForTimeout(600);await page.reload();}
    await page.locator('.inbox-item').filter({hasText:'กลุ่ม LINE'}).click();await page.locator('.notice').filter({hasText:'สมาชิกทุกคนในกลุ่ม'}).waitFor();
    await page.locator('.message.reply').filter({hasText:'[Bookdose AI]'}).locator('.message-footer').filter({hasText:'บริการปลายทางรับข้อความแล้ว'}).waitFor({timeout:30000});
    await page.locator('.composer textarea').fill('ไฟล์สำหรับสมาชิกกลุ่ม');await page.locator('.composer [name="files"]').setInputFiles({name:'guide.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 browser-file')});
    await page.locator('.composer button[type="submit"]').click();
    const reply=page.locator('.message.reply').filter({hasText:'ไฟล์สำหรับสมาชิกกลุ่ม'});await reply.locator('.message-footer').filter({hasText:'บริการปลายทางรับข้อความแล้ว'}).waitFor({timeout:25000});
    await reply.getByRole('button',{name:'ถอนลิงก์ไฟล์'}).click();await page.waitForFunction(()=>!document.querySelector('[data-action="channel-revoke-files"]'));
    await page.screenshot({path:path.join(root,'test-results','group-bot-and-file.png'),fullPage:true});
    await page.goto(base+'/#inbox');await page.locator('.inbox-item').filter({hasText:'Email browser test'}).click();await page.locator('.composer[data-channel="email"]').waitFor();
    await page.locator('.message.reply').filter({hasText:'[Bookdose AI]'}).locator('.message-footer').filter({hasText:'บริการปลายทางรับข้อความแล้ว'}).waitFor({timeout:30000});
    await page.screenshot({path:path.join(root,'test-results','email-bot.png'),fullPage:true});
    assert.deepEqual(errors,[]);console.log('Extended browser passed: Google/Microsoft OAuth callback, mobile, group bot, LINE files and revocation, Email bot. All providers mocked.');
  }finally{if(browser)await browser.close();server.kill('SIGINT');await new Promise(resolve=>{server.once('exit',resolve);setTimeout(resolve,3000);});fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
