/* Uses a fake provider in an isolated process; no live model calls or real keys. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/homebrew/lib/node_modules/n8n/node_modules/playwright');

(async()=>{
  const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'bookdose-browser-ai-'));
  const base='http://127.0.0.1:18790';
  const server=spawn('python3',['tests/ai_fixture_server.py','--port','18790'],{cwd:root,env:{...process.env,BOOKDOSE_DATA:path.join(temp,'data')},stdio:['ignore','pipe','pipe']});
  const errors=[];server.stderr.on('data',data=>errors.push('server: '+data));server.stdout.resume();
  let browser;
  try{
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Server startup timeout')),10000);server.stdout.on('data',data=>{if(String(data).includes('Open http')){clearTimeout(timeout);resolve();}});server.once('exit',code=>{clearTimeout(timeout);reject(Error('Server exit '+code));});});
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const staffContext=await browser.newContext({viewport:{width:1440,height:1000}}),publicContext=await browser.newContext({viewport:{width:390,height:844}});
    const staff=await staffContext.newPage(),customer=await publicContext.newPage();
    for(const page of [staff,customer]){page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});}
    await staff.goto(base);
    await staff.locator('[name="name"]').fill('ผู้ดูแล AI');await staff.locator('[name="email"]').fill('ai-test@example.com');
    await staff.locator('[name="password"]').fill('Browser-ai-test-123!');
    await staff.getByRole('button',{name:'สร้างพื้นที่ทำงาน'}).click();await staff.locator('.stats-grid').waitFor();
    await staff.goto(base+'/#settings');
    await staff.locator('#ai-key').fill('sk-browser-test-not-real-0123456789');
    await staff.locator('[name="drafts_enabled"]').check();await staff.locator('#ai-settings [name="chatbot_enabled"]').check();
    await staff.getByRole('button',{name:'บันทึกการตั้งค่า AI'}).click();
    await staff.getByText('บันทึก API Key แล้ว',{exact:true}).waitFor();
    assert.equal(await staff.locator('#ai-key').inputValue(),'');
    await staff.getByRole('button',{name:'ทดสอบการเชื่อมต่อ',exact:true}).click();
    await staff.locator('#ai-test-result').filter({hasText:'เชื่อมต่อ AI สำเร็จ'}).waitFor();
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
    await staff.screenshot({path:path.join(root,'test-results','ai-settings.png'),fullPage:true});
    await staff.goto(base+'/#knowledge');await staff.getByRole('button',{name:'เขียนบทความ'}).click();
    await staff.locator('[name="title"]').fill('วิธีดาวน์โหลดรายงานการอ่าน');
    await staff.locator('#article-visibility').selectOption('public');
    await staff.locator('#article-body').fill('เปิดเมนูรายงาน แล้วเลือกดาวน์โหลดรายงานการอ่านประจำเดือน เลือกช่วงเวลาและกดส่งออก CSV');
    await staff.getByRole('button',{name:'บันทึกบทความ'}).click();await staff.getByRole('heading',{name:'วิธีดาวน์โหลดรายงานการอ่าน',exact:true}).waitFor();
    await customer.goto(base+'/support/bookdose');
    await customer.locator('[name="name"]').fill('ลูกค้าทดลอง AI');await customer.locator('[name="email"]').fill('visitor@example.com');
    await customer.locator('[name="subject"]').fill('ดาวน์โหลดรายงานการอ่าน');await customer.locator('[name="body"]').fill('ดาวน์โหลดรายงานการอ่านอย่างไร');
    await customer.getByRole('button',{name:'ส่งเรื่องถึงทีมงาน'}).click();
    await customer.getByText('เปิดเมนูรายงาน แล้วเลือกดาวน์โหลดรายงานการอ่านได้เลยค่ะ',{exact:true}).waitFor({timeout:30000});
    await customer.locator('.ai-citations summary').click();
    assert.equal(await customer.getByText('วิธีดาวน์โหลดรายงานการอ่าน',{exact:true}).count(),1);
    assert.equal(await customer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await customer.screenshot({path:path.join(root,'test-results','ai-chatbot-mobile.png'),fullPage:true});
    await customer.getByRole('button',{name:'คุยกับเจ้าหน้าที่',exact:true}).click();
    await customer.locator('#portal-ai-status').filter({hasText:'เจ้าหน้าที่ดูแลเรื่องนี้'}).waitFor();
    await staff.goto(base+'/#inbox');
    await staff.locator('.inbox-item').filter({hasText:'ดาวน์โหลดรายงานการอ่าน'}).click();
    await staff.getByRole('button',{name:'AI ช่วยร่างคำตอบ',exact:true}).click();
    await staff.locator('.ai-result').waitFor();
    assert.equal(await customer.locator('.message').count(),3); // Customer, bot, system handoff. No draft sent.
    await staff.screenshot({path:path.join(root,'test-results','ai-draft-desktop.png'),fullPage:true});
    await staff.getByRole('button',{name:'นำร่างใส่ช่องข้อความ'}).click();
    await staff.waitForFunction(()=>document.querySelector('.composer textarea')?.value.length>0);
    assert.equal(await staff.locator('.composer textarea').inputValue(),'เปิดเมนูรายงาน แล้วเลือกดาวน์โหลดรายงานการอ่านได้เลยค่ะ');
    await staff.locator('.composer textarea').fill('เจ้าหน้าที่ตรวจสอบแล้ว ดาวน์โหลดตามขั้นตอนในคู่มือได้เลยค่ะ');
    await staff.locator('.composer button[type="submit"]').click();
    await customer.getByText('เจ้าหน้าที่ตรวจสอบแล้ว ดาวน์โหลดตามขั้นตอนในคู่มือได้เลยค่ะ',{exact:true}).waitFor({timeout:30000});
    await staff.getByRole('button',{name:'ให้ AI ดูแลข้อความถัดไป'}).click();
    await staff.locator('[data-ai-controls]').filter({hasText:'AI ดูแลบทสนทนา'}).waitFor();
    assert.deepEqual(errors,[]);
    console.log('AI browser checks passed: settings, private key handling, connection test, public chatbot/citations, mobile layout, human handoff, staff draft review and manual send, resume bot. Provider mocked.');
  }finally{
    if(browser)await browser.close();server.kill('SIGTERM');
    await new Promise(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',resolve);});
    fs.rmSync(temp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
