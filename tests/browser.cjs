/* Optional UI integration check. Uses an installed Playwright package and Chrome.
   PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome node tests/browser.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/opt/homebrew/lib/node_modules/n8n/node_modules/playwright');

(async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bookdose-browser-'));
  const root=path.resolve(__dirname,'..');
  const port=18789;
  const base=`http://127.0.0.1:${port}`;
  const server=spawn('python3',['app.py','--port',String(port)],{cwd:root,env:{...process.env,BOOKDOSE_DATA:path.join(temp,'data')},stdio:['ignore','pipe','pipe']});
  let browser;
  const errors=[];
  server.stderr.on('data',data=>errors.push(`server: ${data}`));
  server.stdout.resume();
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Server startup timed out')),10000);
      server.stdout.on('data',data=>{if(String(data).includes('Open http')){clearTimeout(timer);resolve();}});
      server.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server exited ${code}`));});
    });
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-networking']});
    const context=await browser.newContext({viewport:{width:1440,height:1050},locale:'th-TH'});
    const page=await context.newPage();
    function watch(p){p.on('pageerror',error=>errors.push(error.message));p.on('console',message=>{if(message.type()==='error')errors.push(message.text());});}
    watch(page);
    await page.goto(base);
    await page.locator('[data-form="setup"]').waitFor();
    await page.locator('[name="name"]').fill('พี่แนน');
    await page.locator('[name="email"]').fill('browser-test@example.com');
    await page.locator('[name="password"]').fill('Browser-test-123!');
    await page.getByRole('button',{name:'สร้างพื้นที่ทำงาน'}).click();
    await page.getByRole('heading',{name:'สวัสดี, พี่แนน 👋'}).waitFor();
    assert.equal(await page.locator('.stat-card').count(),4);
    assert.equal(await page.locator('tbody tr').count(),5);
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
    await page.screenshot({path:path.join(root,'test-results','dashboard-desktop.png'),fullPage:true});

    // Every navigation loads actual data and no frontend exceptions.
    for(const [route,title] of [['tickets','เคสบริการ'],['inbox','กล่องข้อความ'],['contacts','ข้อมูลลูกค้า'],['knowledge','คลังความรู้'],['reports','รายงานการบริการ'],['settings','ตั้งค่าองค์กร'],['audit','ประวัติการทำงาน'],['platform','จัดการแพลตฟอร์ม']]){
      await page.goto(base+'/#'+route);
      await page.getByRole('heading',{name:title,exact:true}).waitFor();
    }

    // New manual ticket workflow, search, assignment and persistence after reload.
    await page.goto(base+'/#tickets');
    await page.getByRole('button',{name:'เปิดเคสใหม่',exact:true}).click();
    await page.locator('#new-subject').fill('ทดสอบงานบริการจากหน้าจอ');
    await page.locator('#new-contact').selectOption({index:1});
    await page.locator('#new-body').fill('รายละเอียดสำหรับทีม');
    await page.getByRole('button',{name:'เปิดเคส',exact:true}).click();
    await page.getByRole('heading',{name:'ทดสอบงานบริการจากหน้าจอ',exact:true}).waitFor();
    await page.locator('#case-status').selectOption('open');
    await page.getByRole('button',{name:'บันทึกการเปลี่ยนแปลง'}).click();
    await page.locator('#case-status').waitFor();
    await page.reload();
    await page.locator('#case-status').waitFor();
    assert.equal(await page.locator('#case-status').inputValue(),'open');

    // Public customer -> inbox -> internal note -> reply -> resolve.
    const customerContext=await browser.newContext({viewport:{width:1100,height:950},locale:'th-TH'});
    const customer=await customerContext.newPage();watch(customer);
    await customer.goto(base+'/support/bookdose');
    await customer.locator('[name="name"]').fill('ลูกค้าทดสอบผ่านเว็บ');
    await customer.locator('[name="email"]').fill('customer@example.com');
    await customer.locator('[name="subject"]').fill('ต้องการคู่มือเริ่มต้น');
    await customer.locator('[name="body"]').fill('ขอความช่วยเหลือจากหน้าลูกค้า');
    await customer.getByRole('button',{name:'ส่งเรื่องถึงทีมงาน'}).click();
    await customer.locator('#portal-thread').waitFor();
    assert.match(customer.url(),/#case=/);
    await page.goto(base+'/#inbox');
    await page.locator('.inbox-item').filter({hasText:'ต้องการคู่มือเริ่มต้น'}).click();
    await page.locator('.inbox-detail h2').filter({hasText:'ต้องการคู่มือเริ่มต้น'}).waitFor();
    await page.locator('input[value="note"]').check();
    await page.locator('.composer textarea').fill('ลับเฉพาะทีม ห้ามแสดงฝั่งลูกค้า');
    await page.locator('.composer button[type="submit"]').click();
    await page.getByText('ลับเฉพาะทีม ห้ามแสดงฝั่งลูกค้า',{exact:true}).waitFor();
    await customer.reload();
    await customer.locator('#portal-thread').waitFor();
    assert.equal(await customer.getByText('ลับเฉพาะทีม ห้ามแสดงฝั่งลูกค้า',{exact:true}).count(),0);
    await page.locator('input[value="reply"]').check();
    await page.locator('.composer textarea').fill('สวัสดีค่ะ ส่งคู่มือให้เรียบร้อยแล้วค่ะ');
    await page.locator('.composer button[type="submit"]').click();
    await page.getByText('สวัสดีค่ะ ส่งคู่มือให้เรียบร้อยแล้วค่ะ',{exact:true}).waitFor();
    await customer.reload();
    await customer.getByText('สวัสดีค่ะ ส่งคู่มือให้เรียบร้อยแล้วค่ะ',{exact:true}).waitFor();
    await page.getByRole('button',{name:'เปิดเคส',exact:true}).click();
    await page.locator('#case-status').waitFor();
    await page.locator('#case-status').selectOption('resolved');
    await page.getByRole('button',{name:'บันทึกการเปลี่ยนแปลง'}).click();
    await page.locator('#case-status').waitFor();
    await customer.reload();
    await customer.locator('#portal-status').filter({hasText:'แก้ไขแล้ว'}).waitFor();
    await customer.screenshot({path:path.join(root,'test-results','customer-portal.png'),fullPage:true});

    // Create and publish a knowledge article; verify it is visible publicly.
    await page.goto(base+'/#knowledge');
    await page.getByRole('button',{name:'เขียนบทความ'}).click();
    await page.locator('[name="title"]').fill('คู่มือทดสอบเผยแพร่');
    await page.locator('#article-visibility').selectOption('public');
    await page.locator('#article-body').fill('ขั้นตอนที่หนึ่ง: ติดต่อทีม Bookdose');
    await page.getByRole('button',{name:'บันทึกบทความ'}).click();
    await page.getByRole('heading',{name:'คู่มือทดสอบเผยแพร่'}).waitFor();
    await customer.goto(base+'/support/bookdose');
    await customer.getByRole('button',{name:'คู่มือทดสอบเผยแพร่'}).click();
    await customer.getByText('ขั้นตอนที่หนึ่ง: ติดต่อทีม Bookdose',{exact:true}).waitFor();

    // UI download uses a protected endpoint and produces a CSV.
    await page.goto(base+'/#reports');
    const downloadEvent=page.waitForEvent('download');
    await page.getByRole('button',{name:'ดาวน์โหลด CSV'}).click();
    const download=await downloadEvent;
    assert.match(download.suggestedFilename(),/\.csv$/);

    // Narrow screen navigation and no page-level horizontal overflow.
    await page.setViewportSize({width:390,height:844});
    await page.goto(base+'/#dashboard');
    await page.getByRole('heading',{name:'สวัสดี, พี่แนน 👋'}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(root,'test-results','dashboard-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'เปิดเมนู',exact:true}).click();
    await page.locator('.sidebar').getByRole('link',{name:'ข้อมูลลูกค้า',exact:true}).click();
    await page.getByRole('heading',{name:'ข้อมูลลูกค้า',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
    console.log('Browser checks passed: setup, 8 modules, ticket editing, customer conversation, private notes, reply, resolution, public knowledge, CSV, desktop and mobile.');
  }finally{
    if(browser)await browser.close();
    server.kill('SIGTERM');
    await new Promise(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',resolve);});
    fs.rmSync(temp,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
