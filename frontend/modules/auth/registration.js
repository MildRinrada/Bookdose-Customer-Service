/* Organization self-registration: platform email settings, and the verify / check / resend email screens.
   Markup: modules/auth/registration-settings.html, pages/auth/verification.html. */

'use strict';

function registrationSettingsPanel(cfg){
  return render('modules/auth/registration-settings',{enabled:cfg.enabled,port465:cfg.smtp_port===465,port587:cfg.smtp_port===587,hasPassword:cfg.has_password,
    baseURLField:inputField('โดเมนเว็บไซต์','public_base_url',{value:cfg.public_base_url||'',placeholder:'https://support.example.com',max:500,required:false}),
    addressField:inputField('อีเมลผู้ส่ง','address',{value:cfg.address||'',type:'email',max:254,required:false}),
    hostField:inputField('เซิร์ฟเวอร์ SMTP','smtp_host',{value:cfg.smtp_host||'',placeholder:'smtp.example.com',max:253,required:false}),
    usernameField:inputField('ชื่อผู้ใช้ SMTP','username',{value:cfg.username||'',max:500,required:false})});
}

function verificationPage(page,search){
  const signedIn=!!state.boot.user;
  $('#app').innerHTML=render('pages/auth/verification',{brand:brand(),signedIn,email:state.boot.user?.email,
    verify:!signedIn&&page==='verify-email',token:new URLSearchParams(search).get('token')||'',
    resend:!signedIn&&page!=='verify-email',checkEmail:page==='check-email',
    emailField:inputField('อีเมลที่ใช้สมัคร','email',{type:'email',max:254,value:state.registrationEmail||''})});
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
