/* Dashboard: greeting, stat cards, recent cases, "Action Needed" list and new-cases chart.
   Markup: pages/dashboard/, ui/stat-card.html. */

'use strict';

function dashboard(){
  const tickets=state.tickets,active=tickets.filter(t=>!isDone(t)),late=tickets.filter(overdue),mine=active.filter(t=>t.assignee_id===state.boot.user.id);
  const today=new Date().toDateString(),resolvedToday=tickets.filter(t=>isDone(t)&&new Date(t.resolved_at).toDateString()===today).length;
  const dates=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);return d;});
  const counts=dates.map(d=>tickets.filter(t=>new Date(t.created_at).toDateString()===d.toDateString()).length),max=Math.max(...counts,1);
  const needed=actionNeeded(tickets);
  return render('pages/dashboard/dashboard',{
    firstName:state.boot.user.name.split(' ')[0],activeCount:active.length,
    today:new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'long',year:'numeric'}).format(new Date()),newTicketButton:newTicketButton(),
    stats:statCard('เคสที่กำลังดูแล',active.length,'ticket','','เคสที่ยังไม่แก้ไขหรือปิด','#tickets?filter=active')
      +statCard('เคสที่มอบหมายให้ฉัน',mine.length,'users','amber','งานที่คุณเป็นผู้รับผิดชอบ','#tickets?filter=mine')
      +statCard('แก้ไขสำเร็จวันนี้',resolvedToday,'checkCircle','green','นับจากเวลาแก้ไขเคสสำเร็จ','#tickets?filter=resolved_today')
      +statCard('เคสที่เกิน SLA',late.length,'clock','red','เวลาตอบกลับหรือเวลาแก้ไข','#tickets?filter=overdue',late.length>0),
    allCount:tickets.length,mineCount:mine.length,newCount:tickets.filter(t=>t.status==='new').length,recentTable:ticketTable(tickets.slice(0,6),true),
    neededCount:needed.length,moreNeeded:Math.max(0,needed.length-5),
    neededItems:needed.slice(0,5).map(({t,reason,tone,symbol})=>render('pages/dashboard/action-needed-item',{tone,id:t.id,number:t.number,subject:t.subject,priority:priority(t.priority),icon:icon(symbol),reason})).join(''),
    chartMax:max,chartMid:max>1&&max%2===0?max/2:0,
    chartColumns:dates.map((d,i)=>render('pages/dashboard/chart-column',{tip:`${date(d)} · ${counts[i]} เคส`,count:counts[i],max,day:['อา','จ','อ','พ','พฤ','ศ','ส'][d.getDay()]})).join(''),
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

Object.assign(actions,{
  'dashboard-tab':async(button,id)=>{
    $$('.tab',button.parentElement).forEach(n=>n.classList.toggle('active',n===button));const filter=button.dataset.filter;
    const tickets=state.tickets.filter(t=>filter==='all'||filter==='mine'&&t.assignee_id===state.boot.user.id&&!isDone(t)||filter==='new'&&t.status==='new');
    $('#dashboard-tickets').innerHTML=ticketTable(tickets.slice(0,6),true);
  },
});
