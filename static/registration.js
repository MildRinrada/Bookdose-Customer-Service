function registrationSettingsPanel(cfg){
  return `<section class="card mt"><div class="card-header"><h2>อีเมลยืนยันการสมัครองค์กร</h2></div><div class="card-body"><p class="small muted">ตั้งค่าอีเมลผู้ส่งของ Bookdose และโดเมนเว็บไซต์ เพื่อให้ลูกค้ายืนยันอีเมลก่อนสร้างองค์กร</p><form data-form="registration-settings"><div class="form-grid">
    <label class="check span-2"><input type="checkbox" name="enabled" ${cfg.enabled?'checked':''}>เปิดรับสมัครองค์กรพร้อมยืนยันอีเมล</label>
    ${inputField('โดเมนเว็บไซต์','public_base_url',{value:cfg.public_base_url||'',placeholder:'https://support.example.com',max:500,required:false})}
    ${inputField('อีเมลผู้ส่ง','address',{value:cfg.address||'',type:'email',max:254,required:false})}
    ${inputField('เซิร์ฟเวอร์ SMTP','smtp_host',{value:cfg.smtp_host||'',placeholder:'smtp.example.com',max:253,required:false})}
    <div class="field"><label for="registration-port">พอร์ต SMTP</label><select id="registration-port" name="smtp_port"><option value="465" ${cfg.smtp_port===465?'selected':''}>465 · TLS</option><option value="587" ${cfg.smtp_port===587?'selected':''}>587 · STARTTLS</option></select></div>
    ${inputField('ชื่อผู้ใช้ SMTP','username',{value:cfg.username||'',max:500,required:false})}
    <div class="field"><label for="registration-password">รหัสผ่าน SMTP / App Password</label><input id="registration-password" type="password" name="password" maxlength="2000" autocomplete="new-password" placeholder="${cfg.has_password?'บันทึกไว้แล้ว เว้นว่างเพื่อใช้ค่าเดิม':'รหัสผ่านสำหรับส่งอีเมล'}"></div>
    </div><p class="tiny muted">หากเปลี่ยนเซิร์ฟเวอร์ พอร์ต หรือชื่อผู้ใช้ ต้องกรอกรหัสผ่านใหม่ ใช้บัญชีที่ผู้ให้บริการอนุญาตให้ส่งผ่าน SMTP ด้วยรหัสผ่าน / App Password การบันทึกยังไม่ได้ทดสอบส่งอีเมล</p><button class="btn primary" type="submit">บันทึกอีเมลยืนยัน</button></form></div></section>`;
}

function verificationPage(page,search){
  let content;
  if(state.boot.user){
    content=`<h1>กรุณาออกจากระบบก่อนยืนยันบัญชีใหม่</h1><p>ขณะนี้เข้าสู่ระบบด้วย ${esc(state.boot.user.email)}</p><button class="btn" data-action="verification-logout">ออกจากระบบเพื่อยืนยันอีเมล</button> <a href="#dashboard">กลับพื้นที่ทำงาน</a>`;
  }else if(page==='verify-email'){
    const token=new URLSearchParams(search).get('token')||'';
    content=`<h1>ยืนยันอีเมลของคุณ</h1><p>กดปุ่มด้านล่างเพื่อยืนยันอีเมลและสร้างองค์กรที่คุณสมัครไว้</p><form data-form="verify-email"><input type="hidden" name="token" value="${esc(token)}"><button class="btn primary" type="submit">ยืนยันอีเมลและสร้างองค์กร</button></form><p class="small"><a href="#resend-email">ลิงก์หมดอายุหรือใช้ไม่ได้? ขอลิงก์ใหม่</a></p>`;
  }else{
    content=`<h1>${page==='check-email'?'กรุณาตรวจอีเมลของคุณ':'ขอลิงก์ยืนยันอีเมลใหม่'}</h1><p>${page==='check-email'?'หากอีเมลนี้มีคำขอสมัครที่รอยืนยัน ระบบจะส่งลิงก์ให้ กรุณาตรวจกล่องจดหมายและสแปม':''} ลิงก์มีอายุ 1 ชั่วโมง ให้เปิดลิงก์แล้วกดยืนยันเพื่อเข้าใช้งาน</p><form data-form="resend-email">${inputField('อีเมลที่ใช้สมัคร','email',{type:'email',max:254,value:state.registrationEmail||''})}<p class="tiny muted">ขอลิงก์ใหม่ได้หลังรอ 1 นาที ลิงก์ใหม่จะยกเลิกลิงก์เดิม หากสมัครเกิน 24 ชั่วโมงแล้ว ให้สมัครใหม่</p><button class="btn primary" type="submit">ส่งลิงก์ยืนยันใหม่</button><div class="small" role="status" data-resend-status></div></form>`;
  }
  $('#app').innerHTML=`<main class="portal">${brand()}<section class="card mt"><div class="card-body">${content}<p class="small mt"><a href="#login">เข้าสู่ระบบ</a> · <a href="#register">สมัครองค์กรใหม่</a></p></div></section></main>`;
}

async function registrationForm(form,data){
  const kind=form.dataset.form;
  if(kind==='registration-settings'){
    data.enabled=$('[name="enabled"]',form).checked;
    data.smtp_port=Number(data.smtp_port);
    await api('/api/platform/registration',data);
    await route();toast('บันทึกอีเมลยืนยันแล้ว');return true;
  }
  if(kind==='verify-email'){
    await api('/api/register/verify',data);
    history.replaceState(null,'','/#dashboard');
    await route();toast('ยืนยันอีเมลและสร้างองค์กรเรียบร้อยแล้ว');return true;
  }
  if(kind==='resend-email'){
    await api('/api/register/resend',data);
    state.registrationEmail=data.email;
    $('[data-resend-status]',form).textContent='หากมีคำขอที่รอยืนยัน ระบบจะส่งลิงก์ให้ กรุณาตรวจอีเมลและสแปม หากมีบัญชีแล้วให้เข้าสู่ระบบ';
    return true;
  }
  return false;
}
