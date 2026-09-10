/* Acceptance checks for the Customer Service.xlsx review. All data stays in a temporary server. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/homebrew/lib/node_modules/n8n/node_modules/playwright');
(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bookdose-browser-review-')),root=path.resolve(__dirname,'..'),port=18796,base=`http://127.0.0.1:${port}`;
  const setupToken='browser-test-setup-token-at-least-32-characters';
  const server=spawn('python3',['tests/registration_fixture_server.py','--port',String(port)],{cwd:root,env:{...process.env,BOOKDOSE_DATA:path.join(temp,'data'),RENDER:'true',BOOKDOSE_SETUP_TOKEN:setupToken},stdio:['ignore','pipe','pipe']});
  let browser;const errors=[];server.stderr.on('data',d=>errors.push(String(d)));
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),10000);server.stdout.on('data',d=>{if(String(d).includes('Open http')){clearTimeout(timer);resolve();}});server.once('exit',c=>reject(Error('server exited '+c)));});
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-networking']});
    const context=await browser.newContext({viewport:{width:1440,height:1050},permissions:['clipboard-read','clipboard-write']});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=500)errors.push(r.status()+' '+r.url());});
    const shot=async name=>{fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results','review-'+name+'.png'),fullPage:true});};
    const goto=async(route,title)=>{await page.goto(base+'/#'+route);await page.getByRole('heading',{name:title,exact:true}).waitFor();};
    const call=async(url,data)=>page.evaluate(async({url,data})=>{const b=await fetch('/api/bootstrap').then(r=>r.json());const r=await fetch(url,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-CSRF-Token':b.csrf,'X-Tenant-ID':b.tenant_id},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json()};},{url,data});
    await page.goto(base);await page.locator('[data-form="setup"]').waitFor();
    await page.locator('.field').filter({has:page.locator('#auth-password')}).getByRole('button',{name:'แสดงรหัสผ่าน',exact:true}).click();assert.equal(await page.locator('[name="password"]').getAttribute('type'),'text');
    await page.getByRole('button',{name:'ซ่อนรหัสผ่าน',exact:true}).click();
    await page.locator('[name="name"]').fill('ผู้ดูแลทดสอบ');await page.locator('[name="email"]').fill('review@example.com');await page.locator('[name="password"]').fill('Review-password-123!');
    await page.locator('[name="setup_token"]').fill(setupToken);
    await page.getByRole('button',{name:'สร้างพื้นที่ทำงาน',exact:true}).click();await page.locator('.sidebar').waitFor();
    const visitorContext=await browser.newContext(),visitor=await visitorContext.newPage();visitor.on('pageerror',e=>errors.push(e.message));
    await visitor.goto(base);await visitor.getByRole('button',{name:'ลืมรหัสผ่าน?',exact:true}).click();await visitor.getByText('กรุณาติดต่อผู้ดูแลองค์กร',{exact:false}).waitFor();
    await visitor.goto(base+'/support/bookdose');await visitor.getByRole('heading',{name:'ศูนย์ช่วยเหลือ',exact:true}).waitFor();
    await visitor.locator('[name="name"]').fill('<script>alert(1)</script>');await visitor.locator('[name="email"]').click();await visitor.locator('.field-error').filter({hasText:'ใช้ตัวอักษร'}).waitFor();
    await visitor.locator('[name="name"]').fill('ลูกค้าทดสอบ');await visitor.locator('[name="email"]').fill('customer@example.com');await visitor.locator('[name="subject"]').fill('ทดสอบรายการรอตอบ');await visitor.locator('[name="body"]').fill('<script>window.reviewInjected=true</script>');
    await visitor.getByRole('button',{name:'ส่งเรื่องถึงทีมงาน'}).click();await visitor.locator('.thread').waitFor();assert.equal(await visitor.evaluate(()=>window.reviewInjected),undefined);

    await page.getByRole('button',{name:'จัดการบัญชี',exact:true}).click();const profile=page.locator('[data-form="profile"]');await profile.waitFor();
    const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=16;const x=c.getContext('2d');x.fillStyle='#663399';x.fillRect(0,0,16,16);return c.toDataURL('image/png').split(',')[1];});
    await profile.locator('[name="avatar_file"]').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await profile.getByRole('button',{name:'บันทึกโปรไฟล์'}).click();await page.locator('.sidebar img.profile-avatar').waitFor();await page.reload();await page.locator('.sidebar img.profile-avatar').waitFor();
    const avatarBox=await page.locator('.sidebar .profile').boundingBox();assert(avatarBox.y+avatarBox.height<=1050);
    await shot('dashboard');

    await goto('contacts','ข้อมูลลูกค้า');await page.getByRole('button',{name:'เพิ่มลูกค้า',exact:false}).first().click();
    const contact=page.locator('[data-form="contact"]');await contact.locator('[name="first_name"]').fill('สมชาย');await contact.locator('[name="last_name"]').fill('ใจดี');await contact.locator('[name="email"]').fill('somchai@example.com');await contact.locator('[name="phone"]').fill('081-234-5678');
    await contact.locator('[name="first_name"]').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.name),'last_name');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.name),'email');
    await contact.getByRole('button',{name:'บันทึก',exact:true}).click();await page.getByText('สมชาย ใจดี',{exact:true}).waitFor();await page.getByRole('button',{name:'ลูกค้า ↑',exact:true}).click();await shot('contacts');

    await goto('knowledge','คลังความรู้');await page.getByRole('button',{name:'เขียนบทความใหม่'}).click();const article=page.locator('[data-form="article"]');
    assert.equal(await article.getByRole('button',{name:'บันทึกบทความ'}).isDisabled(),true);
    await article.locator('[name="title"]').fill('คู่มือการทดสอบ');await article.locator('[name="category"]').fill('ทดสอบระบบ');await article.locator('[name="body"]').fill('1. ขั้นตอนแรก\n2. ขั้นตอนที่สอง\n\n**คำสำคัญ**\n<script>window.reviewInjected=true</script>\n[ไม่ปลอดภัย](javascript:alert(1))');
    await article.getByRole('button',{name:'แสดงตัวอย่าง'}).click();assert.equal(await article.locator('[data-article-preview] strong').textContent(),'คำสำคัญ');assert.equal(await article.locator('[data-article-preview] script').count(),0);assert.equal(await article.locator('[data-article-preview] a').count(),0);
    page.once('dialog',d=>d.dismiss());await article.getByRole('button',{name:'ยกเลิก',exact:true}).click();assert.equal(await article.isVisible(),true);
    await article.getByRole('button',{name:'บันทึกบทความ'}).click();await page.locator('.article-card').filter({hasText:'คู่มือการทดสอบ'}).waitFor();
    await page.getByRole('button',{name:'ทดสอบระบบ',exact:true}).click();assert.equal(await page.locator('.article-card').count(),1);await page.locator('.article-card').click();
    await page.getByRole('button',{name:'คัดลอกเนื้อหา',exact:true}).click();assert((await page.evaluate(()=>navigator.clipboard.readText())).includes('ขั้นตอนแรก'));
    await page.getByRole('button',{name:'คัดลอกลิงก์',exact:true}).click();const articleURL=await page.evaluate(()=>navigator.clipboard.readText());assert(articleURL.includes('/#knowledge/'));await page.getByRole('button',{name:'ปิด',exact:true}).click();await page.goto(articleURL);await page.getByRole('heading',{name:'คู่มือการทดสอบ',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.reviewInjected),undefined);await shot('article');await page.getByRole('button',{name:'ปิด',exact:true}).click();

    await goto('inbox','กล่องข้อความ');await page.locator('.inbox-item').filter({hasText:'ทดสอบรายการรอตอบ'}).click();await page.locator('.inbox-detail h2').filter({hasText:'ทดสอบรายการรอตอบ'}).waitFor();assert.equal(await page.locator('.inbox-item.selected').getAttribute('class').then(s=>s.includes('needs-reply')),true);
    await page.getByRole('button',{name:'ค้นคู่มือเพื่อร่างคำตอบ'}).click();await page.locator('#modal .article-card').filter({hasText:'คู่มือการทดสอบ'}).click();await page.getByRole('button',{name:'แทรกในช่องร่างข้อความ'}).click();assert((await page.locator('.composer [name="body"]').inputValue()).includes('ขั้นตอนแรก'));assert.equal(await page.locator('.thread script').count(),0);await shot('inbox');
    const submitBox=await page.locator('.composer button[type="submit"]').boundingBox();assert(submitBox.y+submitBox.height<=1050,'Composer must remain visible in desktop inbox');

    await goto('tickets','เคสบริการ');await page.locator('[data-select-all]').check();await page.locator('[data-density]').selectOption('compact');assert.equal(await page.locator('.density-compact').count(),1);
    const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'ส่งออกเคสที่เลือก'}).click();const download=await downloadEvent;assert(fs.readFileSync(await download.path(),'utf8').includes('BD-1001'));await shot('tickets');
    await goto('reports','รายงานการบริการ');await page.locator('[data-form="report-filter"] [name="from"]').fill('2000-01-01');await page.locator('[data-form="report-filter"] [name="to"]').fill('2100-01-01');await page.getByRole('button',{name:'แสดงรายงาน',exact:true}).click();
    assert.equal(await page.evaluate(()=>uxDuration(200)),'3 ชม. 20 นาที');const count=(await call('/api/tickets')).data.tickets.length;assert.equal(await page.locator('.stat-value').first().textContent(),String(count));assert.equal(await page.locator('.bar-row progress').first().getAttribute('max'),String(count));assert((await page.locator('.bar-row').first().getAttribute('title')).includes('%'));await shot('reports');

    await goto('settings','ตั้งค่าองค์กร');await page.getByRole('tab',{name:'ทีมและสมาชิก',exact:true}).click();await page.getByRole('button',{name:'เพิ่มสมาชิก',exact:true}).waitFor();assert.equal(await page.locator('#ai-key').isVisible(),false);await page.getByRole('tab',{name:'AI Assistant',exact:true}).click();assert.equal(await page.locator('#ai-key').isVisible(),true);await shot('settings');
    await goto('audit','ประวัติการทำงาน');await page.locator('[data-form="audit-filter"] [name="group"]').selectOption('settings');await page.getByRole('button',{name:'กรองประวัติ',exact:true}).click();await shot('audit');
    await goto('platform','จัดการแพลตฟอร์ม');const created=await call('/api/platform/tenants',{name:'องค์กรทดสอบระงับ',slug:'review-org',admin_name:'ผู้ดูแลองค์กรใหม่',email:'org@example.com',password:'Review-password-123!'});assert.equal(created.status,201);await page.reload();await page.locator('[data-platform-search]').fill('องค์กรทดสอบระงับ');await page.getByLabel('จัดการองค์กร องค์กรทดสอบระงับ').click();await page.getByRole('button',{name:'ระงับองค์กร',exact:true}).click();await page.locator('[name="confirmation"]').fill('CONFIRM');await page.getByRole('button',{name:'ยืนยันระงับองค์กร',exact:true}).click();await page.locator('#platform-organizations .badge.suspended').waitFor();await shot('platform');

    await page.setViewportSize({width:390,height:844});
    for(const [route,title] of [['dashboard','สวัสดี, ผู้ดูแลทดสอบ 👋'],['contacts','ข้อมูลลูกค้า'],['knowledge','คลังความรู้'],['reports','รายงานการบริการ'],['settings','ตั้งค่าองค์กร'],['platform','จัดการแพลตฟอร์ม']]){
      await goto(route,title);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile overflow on '+route);
      const smallText=await page.evaluate(()=>[...document.querySelectorAll('#app *')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<16).map(e=>e.className||e.tagName));assert.deepEqual(smallText,[],'Text below 16px on '+route);
      await shot(route+'-mobile');
    }
    assert.deepEqual(errors,[]);console.log('Excel review browser passed: validation, password visibility, profile, contacts, knowledge formatting/copy/drafts, reports, selection/export, settings tabs, audit, typed suspension, desktop and mobile.');
  }finally{if(browser)await browser.close();server.kill('SIGTERM');await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
