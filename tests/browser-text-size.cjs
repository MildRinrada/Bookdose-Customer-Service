/* Text-size preference and responsive layout on a disposable local server. */
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/homebrew/lib/node_modules/n8n/node_modules/playwright');
(async()=>{
  const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'bookdose-browser-text-'));
  const base='http://127.0.0.1:18797',errors=[];
  const server=spawn('python3',['tests/registration_fixture_server.py','--port','18797'],{cwd:root,env:{...process.env,BOOKDOSE_DATA:path.join(temp,'data')},stdio:['ignore','pipe','pipe']});
  server.stderr.on('data',d=>errors.push(String(d)));let browser;
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),10000);server.stdout.on('data',d=>{if(String(d).includes('Open http')){clearTimeout(timer);resolve();}});server.once('exit',c=>{clearTimeout(timer);reject(Error('server exited '+c));});});
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--disable-background-networking']});
    const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    const control=page.getByLabel('ขนาดตัวอักษร',{exact:true});
    const font=()=>page.evaluate(()=>getComputedStyle(document.body).fontSize);
    const fits=async(label)=>{
      const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.left>=0&&r.right>innerWidth+1&&!e.closest('.table-wrap');}).slice(0,12).map(e=>({tag:e.tagName,id:e.id,name:e.name,class:e.className,parent:e.parentElement.className,width:e.getBoundingClientRect().width}))}));
      assert(overflow.scroll<=overflow.width,`${label}: ${JSON.stringify(overflow)}`);
    };
    await page.goto(base);await page.locator('[data-form="setup"]').waitFor();assert.equal(await font(),'16px');
    await page.locator('[name="name"]').fill('ผู้ดูแลทดสอบ');
    await page.getByRole('button',{name:'ลดขนาดตัวอักษร',exact:true}).click();assert.equal(await control.inputValue(),'90');assert.equal(await font(),'14.4px');
    await page.getByRole('button',{name:'ลดขนาดตัวอักษร',exact:true}).click();assert.equal(await control.inputValue(),'80');assert(await page.getByRole('button',{name:'ลดขนาดตัวอักษร',exact:true}).isDisabled());
    await page.getByRole('button',{name:'เพิ่มขนาดตัวอักษร',exact:true}).click();assert.equal(await control.inputValue(),'90');
    for(const [value,size] of [['80','12.8px'],['90','14.4px'],['100','16px'],['110','17.6px'],['120','19.2px'],['130','20.8px'],['140','22.4px'],['150','24px']]){await control.selectOption(value);assert.equal(await font(),size);}
    assert(await page.getByRole('button',{name:'เพิ่มขนาดตัวอักษร',exact:true}).isDisabled());
    assert.equal(await page.locator('[name="name"]').inputValue(),'ผู้ดูแลทดสอบ');
    await fits('desktop setup');await page.reload();await control.waitFor();assert.equal(await font(),'24px');
    await page.locator('[name="name"]').fill('ผู้ดูแลทดสอบ');await page.locator('[name="email"]').fill('text@example.com');await page.locator('[name="password"]').fill('Text-size-password-123!');
    await page.getByRole('button',{name:'สร้างพื้นที่ทำงาน',exact:true}).click();await page.locator('.sidebar').waitFor();
    assert.equal(await control.count(),1);assert.equal(await font(),'24px');
    const tab=await context.newPage();await tab.goto(base+'/support/bookdose');await tab.getByLabel('ขนาดตัวอักษร',{exact:true}).waitFor();
    assert.equal(await tab.evaluate(()=>getComputedStyle(document.body).fontSize),'24px');
    await control.selectOption('110');await tab.waitForFunction(()=>document.querySelector('#text-size-select').value==='110');
    await tab.evaluate(()=>localStorage.clear());await page.waitForFunction(()=>document.querySelector('#text-size-select').value==='100');
    for(const percentage of ['90','150']){
    await control.selectOption(percentage);
    for(const width of [1440,1024,390]){
      await page.setViewportSize({width,height:width===390?844:1050});
      for(const route of ['dashboard','inbox','tickets','contacts','knowledge','reports','settings','audit','platform']){
        await page.goto(base+'/#'+route);await page.locator('.content h1').waitFor();await control.waitFor();assert.equal(await font(),percentage==='90'?'14.4px':'24px');await fits(percentage+'% '+width+' '+route);
      }
      await page.goto(base+'/support/bookdose');await page.getByRole('heading',{name:'ศูนย์ช่วยเหลือ',exact:true}).waitFor();await fits(width+' support');
    }
    }
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results','text-size-support-mobile.png'),fullPage:true});
    await page.goto(base+'/#dashboard');await page.locator('.sidebar').waitFor();await page.screenshot({path:path.join(root,'test-results','text-size-dashboard-mobile.png'),fullPage:true});
    await control.selectOption('100');assert.equal(await font(),'16px');
    await page.evaluate(()=>localStorage.setItem('bookdose.text-size','bad-value'));await page.reload();await control.waitFor();assert.equal(await control.inputValue(),'100');assert.equal(await font(),'16px');
    await control.selectOption('90');await page.reload();await control.waitFor();assert.equal(await font(),'14.4px');
    await page.evaluate(()=>localStorage.setItem('bookdose.text-size','larger'));await page.reload();await control.waitFor();assert.equal(await control.inputValue(),'130');assert.equal(await font(),'20.8px');
    const blocked=await browser.newContext({viewport:{width:390,height:844}});
    await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage disabled','SecurityError');}}));
    const login=await blocked.newPage();login.on('pageerror',e=>errors.push(e.message));await login.goto(base);await login.locator('[data-form="login"]').waitFor();
    await login.getByLabel('ขนาดตัวอักษร',{exact:true}).selectOption('150');assert.equal(await login.evaluate(()=>getComputedStyle(document.body).fontSize),'24px');
    assert(await login.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'login mobile overflow');
    await login.goto(base+'/register');await login.getByLabel('ขนาดตัวอักษร',{exact:true}).waitFor();await login.getByLabel('ขนาดตัวอักษร',{exact:true}).selectOption('150');assert(await login.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'register mobile overflow');
    assert.deepEqual(errors,[]);console.log('Text size browser passed: eight percentages with A−/A+, draft preserved, reload/navigation persistence, tab synchronization, reset, invalid/blocked storage, desktop/tablet/mobile staff and support pages.');
  } finally {if(browser)await browser.close();server.kill('SIGTERM');await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
