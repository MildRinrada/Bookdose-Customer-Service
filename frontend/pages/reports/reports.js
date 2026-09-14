/* Service report: a period to look at, the numbers for it against the period before, the shape of the work
   (per day, by status, by priority) and how the team did.
   Markup: pages/reports/, ui/stat-card.html, ui/filter-pill.html, pages/dashboard/chart-column.html. */

'use strict';

const reportRanges={7:'7 วันล่าสุด',30:'30 วันล่าสุด',90:'90 วันล่าสุด',365:'1 ปีล่าสุด'};

const localDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

function reportRange(days){const to=new Date(),from=new Date();from.setDate(to.getDate()-(days-1));return {from:localDate(from),to:localDate(to)};}

function reportTickets(previous=false){
  const f=uiState.report;
  let from=f.from?new Date(f.from+'T00:00:00'):null,to=f.to?new Date(f.to+'T23:59:59.999'):null;
  if(previous&&from&&to){const width=to-from+1;to=new Date(from-1);from=new Date(from-width);}
  return state.tickets.filter(t=>(!from||new Date(t.created_at)>=from)&&(!to||new Date(t.created_at)<=to)&&(!f.team||t.team_id===f.team)&&(!f.assignee||t.assignee_id===f.assignee));
}

function reportMetrics(tickets){
  const replied=tickets.filter(t=>t.first_response_at);
  return {total:tickets.length,open:tickets.filter(t=>!isDone(t)).length,late:tickets.filter(overdue).length,
    avg:replied.length?replied.reduce((n,t)=>n+(new Date(t.first_response_at)-new Date(t.created_at))/60000,0)/replied.length:null,
    sla:replied.length?100*replied.filter(t=>new Date(t.first_response_at)<=new Date(t.first_response_due_at)).length/replied.length:null};
}

// "12 เคสมากกว่าช่วงก่อนหน้า" reads better than a bare number, and says nothing when there is nothing to compare.
function reportTrend(now,before,unit,lowerIsBetter=false){
  if(now==null||before==null)return 'ไม่มีข้อมูลช่วงก่อนให้เทียบ';
  const change=now-before,size=Math.abs(change);
  if(size<0.05)return 'เท่ากับช่วงก่อน';
  const rounded=unit==='%'?size.toFixed(1):Math.round(size).toLocaleString('th-TH');
  return `${change>0?'▲':'▼'} ${rounded} ${unit} เทียบช่วงก่อน`;
}

function reportsPage(){
  if(!uiState.report.from)uiState.report={...reportRange(30),team:'',assignee:'',days:30};
  const f=uiState.report,tickets=reportTickets(),m=reportMetrics(tickets),before=reportMetrics(reportTickets(true));
  const days=Math.max(1,Math.round((new Date(f.to)-new Date(f.from))/86400000)+1);
  const counts=[...Array(days)].map((_,i)=>{const day=new Date(f.from+'T00:00:00');day.setDate(day.getDate()+i);
    return {day,count:tickets.filter(t=>new Date(t.created_at).toDateString()===day.toDateString()).length};});
  const max=Math.max(1,...counts.map(c=>c.count)),busiest=counts.reduce((a,b)=>b.count>a.count?b:a,counts[0]);
  const bars=(labels,key,tone)=>Object.entries(labels).map(([value,label])=>{
    const count=tickets.filter(t=>t[key]===value).length,pct=tickets.length?100*count/tickets.length:0;
    return render('pages/reports/bar-row',{label,count,max:tickets.length||1,pct:pct.toFixed(1),
      swatch:`<span class="bar-swatch ${tone}-${value}"></span>`});
  }).join('');
  return render('pages/reports/reports',{from:f.from,to:f.to,late:m.late,total:m.total,
    rangeLabel:`${date(f.from)} - ${date(f.to)}`,
    rangePills:Object.entries(reportRanges).map(([days,label])=>filterPill('report-range',days,label,{pressed:String(f.days)===days})).join(''),
    teamOptions:state.work.teams.filter(t=>state.work.role!=='agent'||t.id===state.work.team_id).map(t=>option(t.id,t.name,f.team===t.id)).join(''),
    assigneeOptions:state.work.members.map(member=>option(member.id,member.name,f.assignee===member.id)).join(''),
    stats:statCard('เคสทั้งหมด',m.total,'ticket','',reportTrend(m.total,before.total,'เคส'),'#tickets')
      +statCard('ยังดูแลอยู่',m.open,'users','',reportTrend(m.open,before.open,'เคส'),'#tickets?filter=active')
      +statCard('ตอบกลับครั้งแรกเฉลี่ย',formatDuration(m.avg),'clock','',reportTrend(m.avg,before.avg,'นาที'),'#tickets')
      +statCard('ตอบทัน SLA',m.sla==null?'-':m.sla.toFixed(1)+'%','checkCircle',m.sla>=90?'green':'amber',reportTrend(m.sla,before.sla,'%'),'#tickets?filter=overdue'),
    busiest:busiest&&busiest.count?`วันที่มากที่สุด ${date(busiest.day)} · ${busiest.count} เคส`:'',
    columns:counts.map(c=>render('pages/dashboard/chart-column',{tip:`${date(c.day)} · ${c.count} เคส`,count:c.count,max,
      day:days<=31?c.day.getDate():''})).join(''),
    statusBars:bars(statusLabels,'status','status'),priorityBars:bars(priorityLabels,'priority','priority'),
    people:reportPeople(tickets),
    emptyState:empty('ไม่มีเคสในช่วงที่เลือก','ลองขยายช่วงวันที่ หรือเลือกทีมอื่น','chart')});
}

/* Who handled what: the table a team lead reads to see where the work sits. */
function reportPeople(tickets){
  const rows=new Map();
  for(const t of tickets){
    const key=t.assignee_id||'';
    const row=rows.get(key)??rows.set(key,{name:key?memberName(key):'ยังไม่มอบหมาย',list:[]}).get(key);
    row.list.push(t);
  }
  return [...rows.values()].sort((a,b)=>b.list.length-a.list.length).map((row,i)=>{
    const m=reportMetrics(row.list);
    return render('pages/reports/person-row',{avatar:avatar(row.name,i),name:row.name,total:m.total,open:m.open,late:m.late,
      avg:formatDuration(m.avg),sla:m.sla==null?'-':m.sla.toFixed(0)+'%'});
  }).join('');
}

Object.assign(actions,{
  'report-export':async(button,id)=>{downloadTicketsCSV(reportTickets(),'report-tickets.csv');return;},
  'report-range':async(button,id)=>{const days=Number(button.dataset.value);uiState.report={...uiState.report,...reportRange(days),days};$('#page').innerHTML=reportsPage();return;},
});

Object.assign(forms,{
  'report-filter':async(form,data)=>{
    if(data.from>data.to)throw new Error('วันเริ่มต้นต้องไม่อยู่หลังวันสิ้นสุด');
    uiState.report={...data,days:0};
    $('#page').innerHTML=reportsPage();return;
  },
});
