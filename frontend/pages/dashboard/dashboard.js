/* Dashboard: greeting, stat cards, recent cases, "ถึงคุณ" (mentions, follow-ups, escalations), "Action Needed",
   the new-cases chart and, for admins and team leads, the manager view: live agent activity, satisfaction,
   automation and the busy hours of the week.
   Markup: pages/dashboard/, ui/stat-card.html. The manager data comes from /api/automation/overview (state.dash). */

'use strict';

function dashboardPath(){return `/api/automation/overview?tz=${new Date().getTimezoneOffset()}`;}

function dashboard(){
  const tickets=state.tickets,active=tickets.filter(t=>!isDone(t)),late=tickets.filter(overdue),mine=active.filter(t=>t.assignee_id===state.boot.user.id);
  const today=new Date().toDateString(),resolvedToday=tickets.filter(t=>isDone(t)&&new Date(t.resolved_at).toDateString()===today).length;
  const dates=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);return d;});
  const counts=dates.map(d=>tickets.filter(t=>new Date(t.created_at).toDateString()===d.toDateString()).length),max=Math.max(...counts,1);
  const needed=actionNeeded(tickets),me=meItems(state.dash?.me||state.alerts);
  return render('pages/dashboard/dashboard',{
    firstName:state.boot.user.name.split(' ')[0],activeCount:active.length,
    today:new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'long',year:'numeric'}).format(new Date()),newTicketButton:newTicketButton(),
    stats:statCard('เคสที่กำลังดูแล',active.length,'ticket','','เคสที่ยังไม่แก้ไขหรือปิด','#tickets?filter=active')
      +statCard('เคสที่มอบหมายให้ฉัน',mine.length,'users','amber','งานที่คุณเป็นผู้รับผิดชอบ','#tickets?filter=mine')
      +statCard('แก้ไขสำเร็จวันนี้',resolvedToday,'checkCircle','green','นับจากเวลาแก้ไขเคสสำเร็จ','#tickets?filter=resolved_today')
      +statCard('เคสที่เกิน SLA',late.length,'clock','red','เวลาตอบกลับหรือเวลาแก้ไข','#tickets?filter=overdue',late.length>0),
    allCount:tickets.length,mineCount:mine.length,newCount:tickets.filter(t=>t.status==='new').length,recentTable:ticketTable(tickets.slice(0,6),true),
    meCount:me.length,meItems:meItemsHTML(me),
    neededCount:needed.length,moreNeeded:Math.max(0,needed.length-5),
    neededItems:needed.slice(0,5).map(({t,reason,tone,symbol})=>render('pages/dashboard/action-needed-item',{tone,id:t.id,number:t.number,subject:t.subject,priority:priority(t.priority),icon:icon(symbol),reason})).join(''),
    chartMax:max,chartMid:max>1&&max%2===0?max/2:0,
    chartColumns:dates.map((d,i)=>render('pages/dashboard/chart-column',{tip:`${date(d)} · ${counts[i]} เคส`,count:counts[i],max,day:['อา','จ','อ','พ','พฤ','ศ','ส'][d.getDay()]})).join(''),
    managerView:state.dash?.manager?managerView(state.dash.manager):'',
    tenantName:state.work.tenant.name});
}

/* Cases the team should act on now: SLA breached, SLA due within 2 hours, customer replied last, or urgent without an owner. */
function actionNeeded(tickets){
  const now=Date.now(),soon=2*3600e3;
  return tickets.filter(t=>!isDone(t)).map(t=>{
    const responseDue=t.first_response_at?Infinity:new Date(t.first_response_due_at).getTime(),resolutionDue=new Date(t.resolution_due_at).getTime(),due=Math.min(responseDue,resolutionDue);
    if(due<now)return {t,due,rank:0,tone:'danger',symbol:'clock',reason:responseDue<now?'เกินเวลาตอบกลับครั้งแรก':'เกินเวลาแก้ไขเคส'};
    if(due-now<=soon)return {t,due,rank:1,tone:'warn',symbol:'clock',reason:`ใกล้ครบ SLA ${responseDue===due?'ตอบกลับ':'แก้ไข'} · เหลือ ${formatDuration((due-now)/60000)}`};
    if(t.last_public_kind==='customer'&&t.first_response_at)return {t,due,rank:2,tone:'info',symbol:'chat',reason:`ลูกค้าตอบกลับล่าสุด ${relative(t.last_public_at)}`};
    if(t.priority==='urgent'&&!t.assignee_id)return {t,due,rank:3,tone:'info',symbol:'users',reason:'เร่งด่วนและยังไม่มีผู้รับผิดชอบ'};
    return null;
  }).filter(Boolean).sort((a,b)=>a.rank-b.rank||a.due-b.due);
}

/* What is waiting for this person: cases escalated to them first, then reminders that are due, then mentions,
   then reminders still ahead. */
function meItems(alerts){
  if(!alerts)return [];
  const now=Date.now(),items=[];
  for(const e of alerts.escalations||[])items.push({rank:0,at:e.escalated_at,tone:'danger',icon:'bolt',title:`BD-${e.number} ยกระดับมาหาคุณ`,
    detail:`${escalationReasons[e.reason]||''} · ${e.subject}`,href:`#tickets/${e.ticket_id}`,when:shortAgo(e.escalated_at)});
  for(const f of alerts.followups||[]){
    const due=new Date(f.due_at).getTime(),late=due<=now;
    items.push({rank:late?1:3,at:f.due_at,tone:late?'warn':'info',icon:'clock',title:`${late?'ถึงเวลาติดตาม':'ติดตามผล'} BD-${f.number}`,
      detail:`${f.note} · ${f.subject}`,href:`#tickets/${f.ticket_id}`,when:late?'ถึงกำหนด':`อีก ${formatDuration((due-now)/60000)}`});
  }
  for(const m of alerts.mentions||[])items.push({rank:2,at:m.created_at,tone:'info',icon:'at',title:`${m.author_name} กล่าวถึงคุณ`,
    detail:`${m.ticket_number?`BD-${m.ticket_number} · `:''}${plainText(m.body).slice(0,90)}`,href:m.ticket_id?`#tickets/${m.ticket_id}`:`#inbox/${m.conversation_id}`,when:shortAgo(m.created_at)});
  return items.sort((a,b)=>a.rank-b.rank||(a.rank===3?String(a.at).localeCompare(String(b.at)):String(b.at).localeCompare(String(a.at))));
}

function meItemsHTML(items){
  if(!items.length)return '<div class="empty-mini">ไม่มีรายการรอคุณ ✨</div>';
  return items.slice(0,6).map(n=>render('pages/dashboard/me-item',{...n,icon:icon(n.icon)})).join('');
}

// Manager view
const presenceLabels={online:'กำลังใช้งาน',away:'ไม่ได้ใช้งานชั่วคราว',offline:'ออฟไลน์'};
const presenceOrder={online:0,away:1,offline:2};
const weekdayShort=['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.'];
const weekdayFull=['วันอาทิตย์','วันจันทร์','วันอังคาร','วันพุธ','วันพฤหัสบดี','วันศุกร์','วันเสาร์'];
const heatDays=[1,2,3,4,5,6,0];   // Monday first, like a work week

function presence(seen){
  if(!seen)return 'offline';
  const minutes=(Date.now()-new Date(seen))/60000;
  return minutes<=5?'online':minutes<=30?'away':'offline';
}

const hourText=h=>`${String(h%24).padStart(2,'0')}:00`;

function managerView(m){
  const agents=m.agents.map(a=>({...a,presence:presence(a.last_seen)}))
    .sort((x,y)=>presenceOrder[x.presence]-presenceOrder[y.presence]||y.open-x.open||x.name.localeCompare(y.name,'th'));
  const c=m.csat,a=m.automation;
  return render('pages/dashboard/manager-view',{updated:clockTime.format(new Date(m.generated_at)),
    agentCount:agents.length,onlineCount:agents.filter(x=>x.presence==='online').length,
    agentRows:agents.map((x,i)=>render('pages/dashboard/agent-row',{avatar:avatar(x.name,i),name:x.name,role:roleLabels[x.role],team:teamName(x.team_id),
      presence:x.presence,presenceLabel:presenceLabels[x.presence],seen:x.last_seen?`ล่าสุด ${relative(x.last_seen)}`:'ยังไม่เคยเข้าใช้',
      open:x.open,resolved:x.resolved_today,replies:x.replies_today,speed:formatDuration(x.avg_first_response),csat:x.csat==null?'-':`${x.csat.toFixed(1)} ★`})).join(''),
    csatCount:c.count,csatSent:c.sent,csatAverage:c.average==null?'':c.average.toFixed(1),csatStars:c.average==null?'':starsText(Math.round(c.average)),
    csatSatisfied:c.satisfied,csatBars:[5,4,3,2,1].map(n=>render('pages/dashboard/csat-bar',{label:`${n} ★`,count:c.distribution[n],max:Math.max(1,c.count)})).join(''),
    rules:a.rules,macros:a.macros,escalationsToday:a.escalations_today,followupsDue:a.followups_due,
    escalationOn:a.escalation_enabled,escalationText:a.escalation_enabled?`ยกระดับเมื่อไม่มีผู้รับเรื่องใน ${a.escalation_minutes} นาที`:'ปิดการยกระดับ SLA อัตโนมัติ',
    csatOn:a.csat_enabled,csatText:a.csat_enabled?'ส่งแบบประเมินความพึงพอใจเมื่อปิดเคส':'ปิดการส่งแบบประเมิน',
    recentEscalations:m.escalations.slice(0,3).map(escalationRow).join(''),
    ...heatmapParts(m.heatmap)});
}

/* The week as a grid of hours, darker where more new conversations arrive, plus the three busiest three-hour
   windows and what that means for the shifts. Every figure is an average per week over the period. */
function heatmapParts({weeks,counts}){
  const total=counts.flat().reduce((sum,n)=>sum+n,0),max=Math.max(0,...counts.flat());
  const level=n=>n?Math.min(4,Math.ceil(4*n/max)):0,avg=n=>(n/weeks).toFixed(1);
  const rows=heatDays.map(d=>render('pages/dashboard/heat-row',{day:weekdayShort[d],
    cells:counts[d].map((n,h)=>render('pages/dashboard/heat-cell',{level:level(n),tip:`${weekdayShort[d]} ${hourText(h)}–${hourText(h+1)} · เฉลี่ย ${avg(n)} เรื่อง/สัปดาห์`})).join('')})).join('');
  const windows=[];
  for(const d of heatDays)for(let s=0;s<=21;s++)windows.push({d,s,n:counts[d][s]+counts[d][s+1]+counts[d][s+2]});
  const peaks=[];
  for(const w of [...windows].sort((x,y)=>y.n-x.n)){
    if(!w.n||peaks.length===3)break;
    if(!peaks.some(p=>p.d===w.d&&Math.abs(p.s-w.s)<3))peaks.push(w);
  }
  const share=n=>total?Math.round(100*n/total):0;
  const dayTotals=heatDays.map(d=>({d,n:counts[d].reduce((sum,x)=>sum+x,0)})).sort((x,y)=>y.n-x.n);
  const quiet=windows.filter(w=>w.d>=1&&w.d<=5&&w.s>=8&&w.s<=17).sort((x,y)=>x.n-y.n)[0];
  const advice=[];
  if(total<20)advice.push({label:'ข้อมูลยังน้อย',detail:`มี ${total} เรื่องใน ${weeks} สัปดาห์ ผลวิเคราะห์จะแม่นขึ้นเมื่อมีเรื่องมากขึ้น`});
  if(peaks.length)advice.push({label:`เพิ่มคนพร้อมตอบช่วง ${weekdayShort[peaks[0].d]} ${hourText(peaks[0].s)}–${hourText(peaks[0].s+3)}`,detail:`ช่วงเดียวมีเรื่องเข้า ${share(peaks[0].n)}% ของทั้งสัปดาห์`});
  if(dayTotals[0].n)advice.push({label:`${weekdayFull[dayTotals[0].d]} งานเข้ามากที่สุด`,detail:`${share(dayTotals[0].n)}% ของเรื่องทั้งสัปดาห์ · ${weekdayFull[dayTotals.at(-1).d]} น้อยที่สุด (${share(dayTotals.at(-1).n)}%)`});
  if(quiet&&total)advice.push({label:`ช่วงเงียบ: ${weekdayShort[quiet.d]} ${hourText(quiet.s)}–${hourText(quiet.s+3)}`,detail:'เหมาะกับพักกะ ประชุมทีม หรือเคลียร์งานหลังบ้าน'});
  const summary=peaks.length?`ช่วงที่เรื่องเข้ามากที่สุด ${peaks.map(p=>`${weekdayFull[p.d]} ${hourText(p.s)} ถึง ${hourText(p.s+3)}`).join(', ')}`:'ยังไม่มีเรื่องเข้ามาในช่วงที่วิเคราะห์';
  return {weeks,total,summary,rows,
    hourLabels:Array.from({length:24},(_,h)=>`<span class="heat-hour">${h%3===0?String(h).padStart(2,'0'):''}</span>`).join(''),
    peaks:peaks.map(p=>render('pages/dashboard/peak-item',{label:`${weekdayFull[p.d]} ${hourText(p.s)}–${hourText(p.s+3)}`,detail:`เฉลี่ย ${avg(p.n)} เรื่อง/สัปดาห์ · ${share(p.n)}% ของทั้งสัปดาห์`})).join(''),
    advice:advice.map(x=>render('pages/dashboard/peak-item',x)).join('')};
}

/* The manager view and "ถึงคุณ" keep themselves current while the overview is open; the rest of the page stays. */
async function refreshDashboard(){
  if(document.hidden||$('#modal').open||state.route!=='dashboard')return;
  const epoch=state.epoch;
  try{
    const fresh=await api(dashboardPath());
    if(epoch!==state.epoch)return;
    state.dash=fresh;state.alerts=fresh.me;
    const me=meItems(fresh.me),list=$('#me-items'),count=$('#me-count');
    if(list)list.innerHTML=meItemsHTML(me);
    if(count){count.textContent=`${me.length} รายการ`;count.classList.toggle('pending_customer',me.length>0);}
    const view=$('#manager-view');if(view&&fresh.manager)view.innerHTML=managerView(fresh.manager);
    updateNotificationBadge();
  }catch{/* The next round tries again; the page keeps what it shows. */}
}

Object.assign(actions,{
  'dashboard-tab':async(button,id)=>{
    $$('.tab',button.parentElement).forEach(n=>n.classList.toggle('active',n===button));const filter=button.dataset.filter;
    const tickets=state.tickets.filter(t=>filter==='all'||filter==='mine'&&t.assignee_id===state.boot.user.id&&!isDone(t)||filter==='new'&&t.status==='new');
    $('#dashboard-tickets').innerHTML=ticketTable(tickets.slice(0,6),true);
  },
});
