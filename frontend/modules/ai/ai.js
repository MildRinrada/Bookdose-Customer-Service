/* AI drafts and chatbot: settings panel, per-conversation mode controls, draft results and the portal status line.
   Markup: modules/ai/*.html. */

'use strict';

function aiSettingsPanel(){
  const a=state.aiSettings;
  return render('modules/ai/ai-settings',{tenantName:state.work.tenant.name,keyConfigured:a.key_configured,model:a.model,draftsEnabled:a.drafts_enabled,chatbotEnabled:a.chatbot_enabled,
    dailyLimit:a.daily_limit,conversationLimit:a.conversation_limit,maxOutputTokens:a.max_output_tokens,
    requests:a.usage.requests,inputTokens:a.usage.input_tokens.toLocaleString(),outputTokens:a.usage.output_tokens.toLocaleString()});
}

function aiFindConversation(id){return state.detail?.conversations?.find(c=>c.id===id)|| (state.detail?.conversation?.id===id?state.detail.conversation:null);}
function aiControls(id){
  const conv=aiFindConversation(id),a=conv?.ai||{mode:'human'},bot=a.mode==='bot';
  const chatbotOn=conv?.channel==='web'?state.work.ai?.chatbot_enabled:state.work.channels?.[conv?.channel]?.enabled&&state.work.channels?.[conv?.channel]?.chatbot_enabled;
  return render('modules/ai/ai-controls',{id,supported:['web','line','email'].includes(conv?.channel),bot,pending:a.pending,
    canHandToBot:!bot&&chatbotOn&&state.work.ai?.key_configured&&conv?.status==='open'});
}
function aiDraftButton(id){return render('modules/ai/ai-draft-button',{id,enabled:state.work.ai?.drafts_enabled&&state.work.ai?.key_configured});}
function aiCitationsHTML(citations){return citations?.length?render('modules/ai/ai-citations',{count:citations.length,items:citations.map(c=>render('modules/ai/ai-citation',{title:c.title,internal:c.visibility==='internal',quote:c.quote})).join('')}):'';}
function aiPortalStatus(data){return render('modules/ai/ai-portal-status',{bot:data.ai?.mode==='bot',pending:data.ai?.pending});}

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
  if(['pending','running'].includes(job.status)){panel.innerHTML=render('modules/ai/ai-draft-queued',{jobId:job.id});return;}
  if(job.status!=='done'){panel.innerHTML=render('modules/ai/ai-draft-error',{message:job.error||'ร่างคำตอบไม่สำเร็จ กรุณาลองใหม่'});return;}
  const r=job.result;
  panel.innerHTML=render('modules/ai/ai-draft-result',{summary:r.summary,needsHuman:r.needs_human,answer:r.answer,citations:aiCitationsHTML(r.citations),jobId:job.id});
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
    const form=button.closest('form'),area=$('textarea',form);
    area.value=job.result.answer;area.dispatchEvent(new Event('input',{bubbles:true}));($('.richtext',form)||area).focus();
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
      const panel=$(`[data-ai-panel="${id}"]`);panel.innerHTML=render('modules/ai/ai-drafting');
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
