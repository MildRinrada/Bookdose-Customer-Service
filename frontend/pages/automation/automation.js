/* Automation, managed by admins and team leads: routing rules for new cases, SLA escalation, macros and the
   satisfaction survey. Also the pieces other screens use to run a macro, set a follow-up reminder and show a rating.
   Markup: pages/automation/. */

'use strict';

const ruleChannelLabels={'':'ทุกช่องทาง',web:'Web Support',line:'LINE',email:'Email',facebook:'Facebook Messenger',manual:'เคสที่เจ้าหน้าที่บันทึกเอง'};
const macroStatusLabels={'':'ไม่เปลี่ยนสถานะ',open:statusLabels.open,pending_customer:statusLabels.pending_customer,pending_internal:statusLabels.pending_internal,resolved:statusLabels.resolved,closed:statusLabels.closed};
const escalationReasons={unclaimed:'ไม่มีผู้รับเรื่องทันเวลา',sla_risk:'ใกล้ครบเวลาตอบกลับครั้งแรก'};
const macroResultLabels={reply:'ส่งข้อความแล้ว',status:'เปลี่ยนสถานะแล้ว',followup:'ตั้งเตือนติดตามแล้ว'};
const followupChoices={1:'อีก 1 ชั่วโมง',4:'อีก 4 ชั่วโมง',24:'พรุ่งนี้ (24 ชม.)',72:'อีก 3 วัน'};

function teamName(id){return state.work?.teams.find(t=>t.id===id)?.name||'ทีมที่ไม่มีแล้ว';}

function hoursLabel(value){const h=Number(value);return h>=24&&h%24===0?`${h/24} วัน`:`${h} ชั่วโมง`;}

// "มาจาก Facebook Messenger และมีคำว่า “ชำระเงิน” หรือ “โอนเงิน”"
function ruleCondition(r){
  const words=r.keywords?r.keywords.split('\n'):[];
  return [`มาจาก${ruleChannelLabels[r.channel]||'ทุกช่องทาง'}`,...(words.length?[`มีคำว่า ${words.map(w=>`“${w}”`).join(' หรือ ')}`]:[])].join(' และ ');
}

function ruleActions(r){
  return [r.set_priority&&`ความเร่งด่วน${priorityLabels[r.set_priority]}`,r.set_team_id&&`ส่งให้${teamName(r.set_team_id)}`,
    r.set_assignee_id&&`มอบหมาย ${memberName(r.set_assignee_id)}`].filter(Boolean).join(' · ');
}

function macroSteps(m){
  return [m.reply&&'ส่งข้อความแม่แบบ',m.set_status&&`เปลี่ยนสถานะเป็น “${statusLabels[m.set_status]}”`,
    Number(m.followup_hours)>0&&`เตือนติดตามใน ${hoursLabel(m.followup_hours)}`].filter(Boolean).join(' → ');
}

function escalationRow(e){
  return render('pages/automation/escalation-row',{id:e.ticket_id,number:e.number,subject:e.subject,tone:e.reason==='unclaimed'?'warn':'danger',
    reason:escalationReasons[e.reason]||e.reason,to:e.to_user_id?memberName(e.to_user_id):'ไม่พบหัวหน้าทีม',ago:relative(e.escalated_at),iso:e.escalated_at});
}

function automationPage(data){
  state.automation=data;
  const s=data.settings;
  return render('pages/automation/automation',{ruleCount:data.rules.filter(r=>r.enabled).length,
    rules:data.rules.map(r=>render('pages/automation/rule-row',{id:r.id,name:r.name,enabled:Boolean(r.enabled),condition:ruleCondition(r),actions:ruleActions(r)})).join('')
      ||empty('ยังไม่มีกฎ','ตัวอย่าง: ถ้ามาจาก Facebook และมีคำว่า “ชำระเงิน” ให้ความเร่งด่วนสูงและส่งให้ทีมบัญชีทันที','bolt'),
    macros:data.macros.map(m=>render('pages/automation/macro-row',{id:m.id,name:m.name,steps:macroSteps(m),preview:plainText(m.reply).slice(0,160)})).join('')
      ||empty('ยังไม่มี Macro','เช่น ปุ่ม “ขอข้อมูลเพิ่มเติม” ที่ส่งข้อความแม่แบบ เปลี่ยนสถานะเป็นรอลูกค้า และเตือนติดตามใน 24 ชั่วโมง','bolt'),
    escalationEnabled:s.escalation_enabled,escalationMinutes:s.escalation_minutes,csatEnabled:s.csat_enabled,csatMessage:s.csat_message,
    escalations:data.escalations.map(escalationRow).join('')});
}

// Only people of the chosen team can own its cases; with no team chosen, the case keeps its own team.
function ruleAssigneeOptions(team,selected=''){
  return option('','ไม่มอบหมายเพิ่ม',!selected)+state.work.members.filter(m=>m.active&&(!team||m.team_id===team))
    .map(m=>option(m.id,`${m.name} · ${teamName(m.team_id)}`,m.id===selected)).join('');
}

function ruleForm(rule){
  const r=rule||{enabled:1,channel:'',keywords:'',set_priority:'',set_team_id:'',set_assignee_id:''};
  modal(rule?'แก้ไขกฎรับเรื่อง':'เพิ่มกฎรับเรื่อง',render('pages/automation/rule-form',{id:r.id||'',enabled:Boolean(r.enabled),keywords:(r.keywords||'').split('\n').filter(Boolean).join(', '),
    nameField:inputField('ชื่อกฎ','name',{value:r.name||'',max:100,placeholder:'เช่น ชำระเงินจาก Facebook → ทีมบัญชี'}),
    channelOptions:options(ruleChannelLabels,r.channel||''),priorityOptions:options({'':'ไม่เปลี่ยน',...priorityLabels},r.set_priority||''),
    teamOptions:option('','ไม่เปลี่ยนทีม',!r.set_team_id)+state.work.teams.map(t=>option(t.id,t.name,t.id===r.set_team_id)).join(''),
    assigneeOptions:ruleAssigneeOptions(r.set_team_id,r.set_assignee_id),formActions:formActions(rule?'บันทึกกฎ':'เพิ่มกฎ')}));
}

function macroForm(macro){
  const m=macro||{reply:'',set_status:'',followup_hours:0};
  modal(macro?'แก้ไข Macro':'เพิ่ม Macro',render('pages/automation/macro-form',{id:m.id||'',reply:m.reply,followupHours:Number(m.followup_hours)||0,
    nameField:inputField('ชื่อปุ่ม','name',{value:m.name||'',max:100,placeholder:'เช่น ขอข้อมูลเพิ่มเติม'}),
    statusOptions:options(macroStatusLabels,m.set_status||''),formActions:formActions(macro?'บันทึก Macro':'เพิ่ม Macro')}));
}

const ruleBody=r=>({name:r.name,channel:r.channel,keywords:r.keywords,set_priority:r.set_priority,set_team_id:r.set_team_id,set_assignee_id:r.set_assignee_id});

/* Running a macro. target: {kind:'ticket'|'conversation', id}. The buttons are the macros themselves, so one click
   does every step; the toast says what was done and what did not apply. */
function macroButtons(target){
  return (state.work?.macros||[]).map(m=>render('pages/automation/macro-button',{id:m.id,name:m.name,steps:macroSteps(m),kind:target.kind,target:target.id})).join('');
}

function macroMenu(target){
  const items=(state.work?.macros||[]).map(m=>render('pages/automation/macro-item',{id:m.id,name:m.name,steps:macroSteps(m),
    preview:plainText(m.reply).slice(0,160),kind:target.kind,target:target.id})).join('');
  modal('ใช้ Macro',render('pages/automation/macro-menu',{items,canManage:state.work.role!=='agent'}));
}

function macroResultText(result){
  const done=result.done.map(step=>macroResultLabels[step]).join(' · ')||'ไม่มีขั้นตอนที่ต้องทำ';
  const skipped=[result.skipped.includes('reply')&&'ไม่ได้ส่งข้อความ (ไม่มีช่องทางตอบลูกค้า)',
    result.skipped.includes('ticket')&&'ยังไม่มีเคส จึงไม่ได้เปลี่ยนสถานะหรือตั้งเตือน'].filter(Boolean).join(' · ');
  return skipped?`${done} · ${skipped}`:done;
}

function followupsHTML(list){
  const now=Date.now();
  return list.map(f=>{const due=new Date(f.due_at).getTime(),late=!f.done_at&&due<=now;
    return render('pages/automation/followup-item',{id:f.id,note:f.note,by:f.user_name,done:Boolean(f.done_at),late,
      when:f.done_at?`เสร็จ ${date(f.done_at,true)}`:late?`ถึงเวลาแล้ว · ${date(f.due_at,true)}`:`${date(f.due_at,true)} · อีก ${formatDuration((due-now)/60000)}`});
  }).join('');
}

function starsText(rating){return '★'.repeat(rating)+'☆'.repeat(5-rating);}

function surveyHTML(survey){
  if(!survey)return '';
  return render('pages/automation/survey-result',{answered:survey.rating!=null,stars:survey.rating?starsText(survey.rating):'',rating:survey.rating,
    sent:date(survey.sent_at,true),answeredAt:survey.answered_at?date(survey.answered_at,true):''});
}

Object.assign(actions,{
  'rule-new':async()=>ruleForm(),
  'rule-edit':async(button,id)=>ruleForm(state.automation.rules.find(r=>r.id===id)),
  'rule-toggle':async(button,id)=>{const r=state.automation.rules.find(r=>r.id===id);
    await api(`/api/automation/rules/${id}`,{...ruleBody(r),enabled:!r.enabled},'PATCH');toast(r.enabled?`ปิดกฎ “${r.name}” แล้ว`:`เปิดกฎ “${r.name}” แล้ว`);await route();},
  'rule-delete':async(button,id)=>{const r=state.automation.rules.find(r=>r.id===id);
    confirmSheet({title:'ลบกฎรับเรื่อง',message:`ลบกฎ “${r.name}” หรือไม่? เคสที่กฎตั้งค่าไปแล้วจะไม่เปลี่ยนกลับ`,confirmLabel:'ลบกฎ',tone:'danger',
      run:async()=>{await api(`/api/automation/rules/${id}`,undefined,'DELETE');toast('ลบกฎแล้ว');await route();}});},
  'macro-new':async()=>macroForm(),
  'macro-edit':async(button,id)=>macroForm(state.automation.macros.find(m=>m.id===id)),
  'macro-delete':async(button,id)=>{const m=state.automation.macros.find(m=>m.id===id);
    confirmSheet({title:'ลบ Macro',message:`ลบปุ่ม “${m.name}” หรือไม่? ทีมจะไม่เห็นปุ่มนี้ในหน้าเคสและกล่องข้อความอีก`,confirmLabel:'ลบ Macro',tone:'danger',
      run:async()=>{await api(`/api/automation/macros/${id}`,undefined,'DELETE');toast('ลบ Macro แล้ว');await route();}});},
  'macro-menu':async(button)=>macroMenu({kind:button.dataset.kind,id:button.dataset.id}),
  'run-macro':async(button,id)=>{
    const body={[button.dataset.kind==='ticket'?'ticket_id':'conversation_id']:button.dataset.target};
    button.disabled=true;
    try{const result=await api(`/api/macros/${id}/run`,body);if($('#modal').open)closeModal(true);toast(macroResultText(result));await route();}
    finally{button.disabled=false;}
  },
  'followup-done':async(button,id)=>{await api(`/api/followups/${id}/done`,{});toast('ปิดรายการติดตามแล้ว');
    if(state.alerts)state.alerts.followups=state.alerts.followups.filter(f=>f.id!==id);await route();},
});

Object.assign(forms,{
  'rule':async(form,data)=>{const id=form.dataset.id;data.enabled=form.elements.enabled.checked;
    await api(`/api/automation/rules${id?'/'+id:''}`,data,id?'PATCH':'POST');closeModal(true);toast('บันทึกกฎแล้ว · มีผลกับเรื่องใหม่ถัดไป');await route();},
  'macro':async(form,data)=>{const id=form.dataset.id;data.followup_hours=Number(data.followup_hours||0);
    await api(`/api/automation/macros${id?'/'+id:''}`,data,id?'PATCH':'POST');closeModal(true);toast('บันทึก Macro แล้ว');await route();},
  'automation-settings':async(form,data)=>{
    await api('/api/automation/settings',{escalation_enabled:form.elements.escalation_enabled.checked,escalation_minutes:Number(data.escalation_minutes),
      csat_enabled:form.elements.csat_enabled.checked,csat_message:data.csat_message},'PATCH');
    toast('บันทึกการตั้งค่าอัตโนมัติแล้ว');await route();},
  'followup':async(form,data)=>{await api(`/api/tickets/${form.dataset.id}/followups`,{hours:Number(data.hours),note:data.note||''});toast('ตั้งเตือนติดตามผลแล้ว');await route();},
});

document.addEventListener('change',event=>{
  const n=event.target;
  if(n.name==='set_team_id'&&n.form?.dataset.form==='rule')n.form.elements.set_assignee_id.innerHTML=ruleAssigneeOptions(n.value);
});
