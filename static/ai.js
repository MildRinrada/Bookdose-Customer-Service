'use strict';

function aiSettingsPanel(){
  const a=state.aiSettings;
  return `<section class="card mt" id="ai-settings"><div class="card-header"><div><h2>${icon('sparkle')} AI Assistant & Chatbot</h2><p>ตั้งค่าแยกสำหรับ ${esc(state.work.tenant.name)}</p></div><span class="badge ${a.key_configured?'resolved':''}">${a.key_configured?'บันทึก API Key แล้ว':'ยังไม่ได้ตั้งค่า API Key'}</span></div>
    <form class="card-body" data-form="ai-settings"><div class="notice mb">เมื่อเปิดใช้ ระบบจะส่งข้อความและบทความที่เกี่ยวข้องไปยัง OpenAI เพื่อสร้างคำตอบ มีค่าใช้บริการตามบัญชี API ของคุณ Chatbot อ่านเฉพาะบทความที่เผยแพร่ให้ลูกค้า ส่วนร่างสำหรับเจ้าหน้าที่อาจใช้บทความและบันทึกภายใน</div>
    <div class="form-grid"><div class="field"><label for="ai-key">OpenAI API Key</label><input type="password" id="ai-key" name="api_key" autocomplete="new-password" placeholder="${a.key_configured?'เว้นว่างเพื่อใช้คีย์เดิม':'sk-…'}" maxlength="503"><span class="tiny muted">เก็บเฉพาะฝั่งเซิร์ฟเวอร์ ไม่แสดงคีย์เดิมและไม่รวมในไฟล์สำรอง</span></div><div class="field"><label for="ai-model">โมเดล</label><input id="ai-model" name="model" value="${esc(a.model)}" required maxlength="100"><span class="tiny muted">ต้องเป็นโมเดลที่บัญชีคุณมีสิทธิ์ และรองรับ Structured Outputs</span></div>
    <label class="check"><input type="checkbox" name="drafts_enabled" ${a.drafts_enabled?'checked':''}>เปิด AI ช่วยร่างคำตอบให้เจ้าหน้าที่</label><label class="check"><input type="checkbox" name="chatbot_enabled" ${a.chatbot_enabled?'checked':''}>เปิด Chatbot ตอบลูกค้าผ่าน Web Support</label>
    <div class="field"><label for="ai-daily">เพดานคำขอ AI ต่อวัน / องค์กร (UTC)</label><input id="ai-daily" name="daily_limit" type="number" min="1" max="10000" value="${a.daily_limit}" required></div><div class="field"><label for="ai-conversation">เพดานคำตอบ Chatbot ต่อบทสนทนา</label><input id="ai-conversation" name="conversation_limit" type="number" min="1" max="100" value="${a.conversation_limit}" required></div><div class="field"><label for="ai-output">จำนวน output tokens สูงสุดต่อคำขอ</label><input id="ai-output" name="max_output_tokens" type="number" min="200" max="2000" value="${a.max_output_tokens}" required></div><label class="check"><input name="remove_key" type="checkbox">ลบ API Key (ปิดทั้งสองโหมดก่อนบันทึก)</label></div>
    <div class="flex wrap mt"><button class="btn primary" type="submit">บันทึกการตั้งค่า AI</button><button class="btn" type="button" data-action="ai-test" ${a.key_configured?'':'disabled'}>${icon('checkCircle')}ทดสอบการเชื่อมต่อ</button><span class="tiny muted">การทดสอบใช้ข้อความตัวอย่าง ไม่มีข้อมูลลูกค้า</span></div><div id="ai-test-result" role="status" class="mt"></div></form>
    <div class="card-body"><div class="flex wrap"><span class="badge">วันนี้ ${a.usage.requests} / ${a.daily_limit} คำขอ</span><span class="badge">Input ${a.usage.input_tokens.toLocaleString()} tokens</span><span class="badge">Output ${a.usage.output_tokens.toLocaleString()} tokens</span></div><p class="tiny muted mt">เพดานนับงานที่รับเข้าคิว รวมงานทดสอบและงานไม่สำเร็จ ไม่ใช่วงเงินเป็นบาท เปิด Chatbot แล้วจะเริ่มกับบทสนทนาใหม่ บทสนทนาเดิมให้เจ้าหน้าที่เลือกเปิดเป็นรายเรื่อง</p></div></section>`;
}

function aiFindConversation(id){return state.detail?.conversations?.find(c=>c.id===id)|| (state.detail?.conversation?.id===id?state.detail.conversation:null);}
function aiControls(id){
  const conv=aiFindConversation(id),a=conv?.ai||{mode:'human'};
  if(!['web','line','email'].includes(conv?.channel))return '<span class="tiny muted">AI ช่วยร่างบันทึกและคำตอบสำหรับเจ้าหน้าที่</span>';
  return `<span class="badge ${a.mode==='bot'?'new':''}">${icon(a.mode==='bot'?'sparkle':'users')}${a.mode==='bot'?(a.pending?'AI กำลังเตรียมคำตอบ':'AI ดูแลบทสนทนา'):'เจ้าหน้าที่ดูแลบทสนทนา'}</span>${a.mode==='bot'?`<button type="button" class="btn sm" data-action="ai-mode" data-id="${id}" data-mode="human">รับช่วงดูแล</button>`:(conv?.channel==='web'?state.work.ai?.chatbot_enabled:state.work.channels?.[conv?.channel]?.enabled&&state.work.channels?.[conv?.channel]?.chatbot_enabled)&&state.work.ai?.key_configured&&conv?.status==='open'?`<button type="button" class="btn sm" data-action="ai-mode" data-id="${id}" data-mode="bot">ให้ AI ดูแลข้อความถัดไป</button>`:''}`;
}
function aiComposerTools(id,{compact=false}={}){const enabled=state.work.ai?.drafts_enabled&&state.work.ai?.key_configured;return `<div class="ai-tools">${compact?'':`<div class="flex wrap" data-ai-controls="${id}">${aiControls(id)}</div>`}<button type="button" class="btn ai-draft-btn" data-action="ai-draft" data-id="${id}" ${enabled?'':'disabled'} title="${enabled?'ร่างและตรวจแหล่งอ้างอิงก่อนส่ง':'ให้ผู้ดูแลองค์กรเปิด AI ในหน้าตั้งค่าองค์กร'}">${icon('sparkle')}AI ช่วยร่างคำตอบ</button></div><div data-ai-panel="${id}" aria-live="polite"></div>`;}
function aiCitationsHTML(citations){return citations?.length?`<details class="ai-citations"><summary>แหล่งอ้างอิง ${citations.length} รายการ</summary>${citations.map(c=>`<div><strong>${esc(c.title)}</strong>${c.visibility==='internal'?'<span class="badge">ภายในองค์กร</span>':''}<p>“${esc(c.quote)}”</p></div>`).join('')}</details>`:'';}
function aiPortalStatus(data){return `<div class="flex between wrap"><span>${icon(data.ai?.mode==='bot'?'sparkle':'users')} ${data.ai?.mode==='bot'?(data.ai.pending?'AI กำลังตรวจข้อมูลและเตรียมคำตอบ…':'คุณกำลังรับบริการจาก AI Chatbot'):'เจ้าหน้าที่ดูแลเรื่องนี้'}<span class="tiny muted"> · ตรวจแหล่งอ้างอิงประกอบคำตอบได้</span></span><button class="btn sm" data-action="ai-handoff">คุยกับเจ้าหน้าที่</button></div>`;}

async function aiWaitJob(id,epoch){
  for(let i=0;i<80;i++){
    if(epoch!==state.epoch)throw new Error('เปลี่ยนหน้าแล้ว คุณกลับมากดร่างคำตอบใหม่ได้');
    const job=await api(`/api/ai/jobs/${id}`);
    if(!['pending','running'].includes(job.status))return job;
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  return {id,status:'running'};
}
function aiShowDraft(panel,job){
  if(['pending','running'].includes(job.status)){panel.innerHTML=`<div class="notice">งานยังอยู่ในคิว <button class="btn subtle" data-action="ai-check" data-job="${job.id}">ตรวจผลอีกครั้ง</button></div>`;return;}
  if(job.status!=='done'){panel.innerHTML=`<div class="notice warning">${esc(job.error||'ร่างคำตอบไม่สำเร็จ กรุณาลองใหม่')}</div>`;return;}
  const r=job.result;
  panel.innerHTML=`<div class="ai-result"><div class="flex between"><strong class="small">${icon('sparkle')}ร่างจาก AI · ยังไม่ได้ส่ง</strong><button type="button" class="icon-btn" data-action="ai-dismiss" aria-label="ปิดร่าง AI">${icon('close')}</button></div><p class="tiny muted mt">สรุปสำหรับเจ้าหน้าที่: ${esc(r.summary)}</p>${r.needs_human?'<div class="notice warning mb">เรื่องนี้ต้องให้เจ้าหน้าที่ตรวจสอบเพิ่มเติม AI ยังยืนยันคำตอบไม่ได้</div>':''}${r.answer?`<div class="pre small">${esc(r.answer)}</div>`:''}${aiCitationsHTML(r.citations)}<p class="tiny muted mt">ตรวจข้อมูลและความเหมาะสมก่อนส่ง โดยเฉพาะร่างที่อ้างอิงข้อมูลภายใน</p>${r.answer?`<button class="btn primary sm" type="button" data-action="ai-use-draft" data-job="${job.id}">นำร่างใส่ช่องข้อความ</button>`:''}</div>`;
}
async function aiHandleForm(form){
  const data=Object.fromEntries(new FormData(form));
  for(const key of ['drafts_enabled','chatbot_enabled','remove_key'])data[key]=$(`[name="${key}"]`,form).checked;
  for(const key of ['daily_limit','conversation_limit','max_output_tokens'])data[key]=Number(data[key]);
  await api('/api/ai/settings',data,'PATCH');
  $('[name="api_key"]',form).value='';
  toast('บันทึกการตั้งค่า AI แล้ว');await route();$('#ai-settings')?.scrollIntoView({block:'start'});
}
async function aiAction(button){
  const id=button.dataset.id,epoch=state.epoch;
  if(button.dataset.action==='ai-dismiss'){button.closest('.ai-result').remove();return;}
  if(button.dataset.action==='ai-handoff'){await api(`/api/public/${state.portal.slug}/handoff`,{});await pollPortal();toast('ส่งเรื่องให้เจ้าหน้าที่แล้ว');return;}
  if(button.dataset.action==='ai-mode'){
    await api(`/api/conversations/${id}/ai-mode`,{mode:button.dataset.mode});
    await pollStaffMessages();toast(button.dataset.mode==='human'?'เจ้าหน้าที่รับช่วงดูแลแล้ว':'AI จะดูแลข้อความใหม่จากลูกค้า');return;
  }
  if(button.dataset.action==='ai-use-draft'){
    const job=await api(`/api/ai/jobs/${button.dataset.job}`);
    if(job.status!=='done'||!job.result.answer)throw new Error(job.error||'บทสนทนาเปลี่ยนไป กรุณาร่างใหม่');
    const form=button.closest('form');$('textarea',form).value=job.result.answer;$('textarea',form).focus();
    const reply=$('input[value="reply"]',form);if(reply&&!reply.disabled)reply.checked=true;
    toast('ใส่ร่างแล้ว ตรวจทานและกดส่งเมื่อพร้อม');return;
  }
  if(button.dataset.action==='ai-check'){
    const panel=button.closest('[data-ai-panel]');aiShowDraft(panel,await api(`/api/ai/jobs/${button.dataset.job}`));return;
  }
  button.disabled=true;
  try{
    if(button.dataset.action==='ai-test'){
      const node=$('#ai-test-result');node.textContent='กำลังทดสอบการเชื่อมต่อ…';
      const queued=await api('/api/ai/test',{});const job=await aiWaitJob(queued.id,epoch);
      if(epoch!==state.epoch)return;
      node.textContent=job.status==='done'?'เชื่อมต่อ AI สำเร็จ':job.error||'ยังประมวลผลอยู่ กรุณาลองตรวจสอบอีกครั้ง';
      return;
    }
    if(button.dataset.action==='ai-draft'){
      const panel=$(`[data-ai-panel="${id}"]`);panel.innerHTML='<div class="notice">AI กำลังอ่านบทสนทนาและค้นความรู้… คุณพิมพ์ข้อความต่อได้</div>';
      const queued=await api(`/api/conversations/${id}/ai-draft`,{});
      await pollStaffMessages();
      const job=await aiWaitJob(queued.id,epoch);
      if(epoch===state.epoch)aiShowDraft(panel,job);
    }
  }catch(error){
    if(epoch===state.epoch){const panel=id?$(`[data-ai-panel="${id}"]`):$('#ai-test-result');if(panel)panel.textContent=error.message;}
    throw error;
  }finally{button.disabled=false;}
}
