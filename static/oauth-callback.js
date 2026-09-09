'use strict';
(async()=>{
  const params=new URLSearchParams(location.search);
  history.replaceState(null,'',location.pathname);
  const node=document.querySelector('#oauth-result');
  try{
    if(params.has('error'))throw Error('ไม่ได้อนุญาตการเชื่อมบัญชี กรุณากลับไปตั้งค่าและเริ่มใหม่');
    const boot=await (await fetch('/api/bootstrap',{credentials:'same-origin'})).json();
    if(!boot.user)throw Error('กรุณาเข้าสู่ระบบ แล้วเริ่มเชื่อมบัญชีใหม่');
    const response=await fetch('/api/channels/email/oauth/complete',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':boot.csrf,'X-Tenant-ID':boot.tenant_id},body:JSON.stringify({state:params.get('state'),code:params.get('code')})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'เชื่อมบัญชีไม่สำเร็จ');
    node.textContent='เชื่อมบัญชีสำเร็จ กลับไปตั้งค่าองค์กร แล้วเปิดรับและส่ง Email เพื่อเริ่มใช้งาน';
  }catch(error){node.textContent=error.message;}
})();
