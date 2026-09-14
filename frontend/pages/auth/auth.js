/* Sign-in, first-time setup and organization sign-up screens. Markup: templates/pages/auth.html. */

'use strict';

function authPage(setup,register=false){
  const creating=setup||register;
  $('#app').innerHTML=render('pages/auth/auth',{
    kind:setup?'setup':register?'register':'login',setup,register,login:!creating,creating,
    brand:brand(),teamAvatar:avatar('ทีม',1),slugValue:setup?'bookdose':'',
    nameField:creating?inputField('ชื่อผู้ดูแล','name',{placeholder:'ชื่อที่ต้องการให้ทีมเห็น',max:100}):'',
    emailField:inputField('อีเมล','email',{type:'email',placeholder:'you@bookdose.com',max:254}),
    confirmField:register?inputField('ยืนยันรหัสผ่าน','password_confirm',{type:'password',max:200}):'',
    organizationField:creating?inputField('ชื่อองค์กร','organization',{value:setup?'Bookdose':'',placeholder:'ชื่อบริษัทหรือองค์กรของคุณ',max:100}):'',
    setupTokenField:setup&&state.boot.setup_token_required?inputField('รหัสตั้งค่าระบบจากผู้ดูแลโฮสต์','setup_token',{type:'password',max:200}):''});
}

async function submitSignInForm(form,data){const kind=form.dataset.form;if(kind==='setup')data.demo=$('[name="demo"]',form).checked;if(kind==='register'&&data.password!==data.password_confirm)throw new Error('รหัสผ่านยืนยันไม่ตรงกัน');await api(`/api/${kind}`,data);if(kind==='register'){state.registrationEmail=data.email;location.hash='check-email';}else location.hash='dashboard';await route();return;}

Object.assign(actions,{
  'forgot-password':async(button,id)=>{modal('ลืมรหัสผ่าน',render('pages/auth/forgot-password'));return;},
  'verification-logout':async(button,id)=>{await api('/api/logout',{});await route();return;},
});

Object.assign(forms,{
  'setup':submitSignInForm,
  'login':submitSignInForm,
  'register':submitSignInForm,
});
