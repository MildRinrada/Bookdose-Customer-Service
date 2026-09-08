'use strict';
const channelNames={web:'Web Support',line:'LINE',email:'Email',manual:'บันทึกเอง'};
const deliveryNames={queued:'รอส่ง',sending:'กำลังส่ง',accepted:'บริการปลายทางรับข้อความแล้ว',failed:'ส่งไม่สำเร็จ',unknown:'ไม่ทราบผลการส่ง'};
function channelDeliveryHTML(m){
  if(!m.channel_delivery)return '<div class="message-footer">พร้อมอ่านในหน้าติดตามเรื่อง</div>';
  return `<div class="message-footer" role="status">${esc(deliveryNames[m.delivery]||m.delivery)}${m.delivery==='accepted'?' · ยังไม่ยืนยันการส่งถึงหรืออ่าน':''}${m.channel_delivery.error?`<p>${esc(m.channel_delivery.error)}</p>`:''}${m.channel_delivery.retryable?`<button type="button" class="btn sm" data-action="channel-retry" data-id="${m.id}">ลองส่งอีกครั้ง</button>`:''}</div>`;
}
function channelSummaryHTML(){return (state.channelSettings||[]).map(c=>`<div class="channel-row"><div class="channel-icon">${icon(c.kind==='line'?'chat':'mail')}</div><div class="grow"><h3>${channelNames[c.kind]}</h3><p>${esc(c.config.display_name||c.config.address||'ตั้งค่าบัญชีด้านล่าง')}</p></div><span class="badge ${c.enabled&&c.credentials_configured?'resolved':''}">${c.enabled&&c.credentials_configured?'เปิดรับเรื่อง':'ยังไม่เปิดใช้งาน'}</span></div>`).join('');}
function channelSettingsPanel(){return state.channelSettings.map(c=>{
  const k=c.kind,v=c.config;
  const field=(name,label,type='text',value='',required=false)=>`<div class="field"><label for="${k}-${name}">${label}</label><input id="${k}-${name}" name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} maxlength="${type==='password'?2000:254}" autocomplete="${type==='password'?'new-password':'off'}" ${type==='password'?'placeholder="เว้นว่างเพื่อใช้ข้อมูลเดิม"':''}></div>`;
  return `<section class="card mt" id="channel-${k}"><div class="card-header"><h2>${channelNames[k]} · เชื่อมบัญชีจริง</h2><span class="badge">${c.credentials_configured?'บันทึกข้อมูลเชื่อมต่อแล้ว':'ยังไม่มีข้อมูลเชื่อมต่อ'}</span></div><form class="card-body" data-form="channel-settings" data-kind="${k}">
  <div class="notice mb">${k==='line'?'รับข้อความส่วนตัวจาก LINE OA และให้เจ้าหน้าที่ตอบเป็นข้อความผ่านบัญชีเดิม ต้องเปิดโปรแกรมไว้และใช้ Webhook URL แบบ HTTPS ที่ LINE เข้าถึงได้':'รับอีเมลผ่าน IMAP (TLS 993) และส่งผ่าน SMTP ใช้รหัสผ่านหรือ App Password เดียวกันทั้งสองบริการ เริ่มรับเฉพาะอีเมลใหม่หลังเปิดครั้งแรก ไม่รองรับบัญชีที่บังคับ OAuth อย่างเดียว'}</div>
  <div class="form-grid">${k==='line'?field('channel_secret','Channel Secret','password')+field('access_token','Channel Access Token','password'):field('address','อีเมลรับเรื่อง','email',v.address||'',true)+field('username','ชื่อผู้ใช้ IMAP / SMTP','text',v.username||'')+field('password','รหัสผ่าน / App Password','password')+field('imap_host','เซิร์ฟเวอร์ IMAP','text',v.imap_host||'',true)+field('smtp_host','เซิร์ฟเวอร์ SMTP','text',v.smtp_host||'',true)+`<div class="field"><label for="email-smtp_port">การเชื่อมต่อ SMTP</label><select id="email-smtp_port" name="smtp_port">${options({465:'465 · TLS',587:'587 · STARTTLS'},String(v.smtp_port||465))}</select></div><div class="field"><label for="email-poll_seconds">ตรวจอีเมลทุก (วินาที)</label><input id="email-poll_seconds" name="poll_seconds" type="number" min="30" max="600" value="${v.poll_seconds||60}" required></div>`}
  <div class="field"><label for="${k}-team">ทีมรับเรื่องใหม่</label><select name="team_id" id="${k}-team">${teamOptions(v.team_id)}</select></div><label class="check"><input name="enabled" type="checkbox" ${c.enabled?'checked':''}>เปิดรับและส่ง ${channelNames[k]}</label><label class="check"><input name="remove_credentials" type="checkbox">ลบข้อมูลเชื่อมต่อ (ปิดช่องทางก่อนบันทึก)</label></div>
  <p class="tiny muted mt">ข้อมูลลับเก็บฝั่งเซิร์ฟเวอร์ ไม่แสดงกลับและไม่รวมในไฟล์สำรอง การแก้ตั้งค่าจะยกเลิกข้อความที่ยังรอส่ง ให้เจ้าหน้าที่ตรวจแล้วส่งใหม่</p>
  <div class="flex wrap mt"><button class="btn primary" type="submit">บันทึก ${channelNames[k]}</button><button class="btn" type="button" data-action="channel-test" data-kind="${k}" ${c.credentials_configured?'':'disabled'}>ทดสอบบัญชีที่บันทึกไว้</button>${k==='email'?'<button class="btn" type="button" data-action="channel-sync" data-kind="email">ตรวจอีเมลรอบถัดไปทันที</button>':''}</div><p class="tiny muted mt">ทดสอบการเข้าสู่ระบบเท่านั้น ไม่ส่งข้อความทดสอบ</p>
  ${k==='line'&&c.route_id?`<div class="notice mt"><strong>Webhook URL</strong><p class="channel-url">${esc(location.origin+'/api/webhooks/line/'+c.route_id)}</p><button class="btn sm" type="button" data-action="channel-copy" data-route="${c.route_id}">คัดลอก Webhook URL</button><p>ถ้าเปิดผ่าน localhost ให้เปลี่ยนเป็นโดเมน HTTPS สาธารณะที่ชี้มายังเซิร์ฟเวอร์นี้ แล้วใส่ URL ใน LINE Developers พร้อมเปิด Use webhook</p></div>`:''}
  <div class="mt" role="status">${c.last_error?`<p class="notice">${esc(c.last_error)}</p>`:''}<p class="small muted">ตรวจล่าสุด: ${c.last_checked?date(c.last_checked,true):'—'} · รับข้อความล่าสุด: ${c.last_received?date(c.last_received,true):'—'}</p><div class="flex wrap">${c.outbox.map(o=>`<span class="badge">${esc(deliveryNames[o.status]||o.status)} ${o.count}</span>`).join('')}</div></div>
  <p class="tiny muted mt">AI ช่วยร่างคำตอบให้เจ้าหน้าที่ตรวจและกดส่งได้ ส่วน Chatbot ตอบอัตโนมัติยังใช้กับ Web Support</p></form></section>`;
}).join('');}
async function channelHandleForm(form){
  const data=Object.fromEntries(new FormData(form));
  data.enabled=form.elements.enabled.checked;data.remove_credentials=form.elements.remove_credentials.checked;
  if(form.dataset.kind==='email'){data.smtp_port=Number(data.smtp_port);data.poll_seconds=Number(data.poll_seconds);}
  await api('/api/channels/'+form.dataset.kind,data,'PATCH');toast('บันทึกช่องทางแล้ว');await route();
}
async function channelAction(button){
  const k=button.dataset.kind;
  if(button.dataset.action==='channel-copy'){await navigator.clipboard.writeText(location.origin+'/api/webhooks/line/'+button.dataset.route);toast('คัดลอก Webhook URL แล้ว');return;}
  if(button.dataset.action==='channel-retry'){await api('/api/messages/'+button.dataset.id+'/retry',{});await pollStaffMessages();toast('นำข้อความกลับเข้าคิวแล้ว');return;}
  await api('/api/channels/'+k+'/'+(button.dataset.action==='channel-test'?'test':'sync'),{});
  toast(button.dataset.action==='channel-test'?'เชื่อมต่อบัญชีสำเร็จ':'กำหนดให้ตรวจอีเมลรอบถัดไปแล้ว');await route();
}
document.addEventListener('change',event=>{
  const form=event.target.closest('form[data-channel="line"]');
  if(!form||event.target.name!=='kind')return;
  const reply=form.elements.kind.value==='reply';
  form.elements.files.disabled=reply;if(reply)form.elements.files.value='';
  form.elements.body.maxLength=reply?5000:20000;
});
