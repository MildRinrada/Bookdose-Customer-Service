/* A browser preference shared by staff, sign-in and customer support pages. */
(() => {
  const key='bookdose.text-size';
  const sizes=['80','90','100','110','120','130','140','150'];
  const legacy={normal:'100',large:'110',larger:'130',largest:'150'};
  const valid=value=>sizes.includes(value)?value:(Object.hasOwn(legacy,value)?legacy[value]:'100');
  let selected='100';
  try { selected=valid(localStorage.getItem(key)); } catch { /* Storage may be disabled. */ }
  document.documentElement.dataset.textSize=selected;

  function init(){
    const control=document.createElement('div');
    control.className='text-size-controls';
    const label=document.createElement('label');
    label.htmlFor='text-size-select';label.textContent='ขนาดตัวอักษร';
    const select=document.createElement('select');
    select.id='text-size-select';
    for(const value of sizes){
      const option=document.createElement('option');option.value=value;option.textContent=value+'%';select.append(option);
    }
    const decrease=document.createElement('button'),increase=document.createElement('button');
    for(const [button,text,title] of [[decrease,'A−','ลดขนาดตัวอักษร'],[increase,'A+','เพิ่มขนาดตัวอักษร']]){
      button.type='button';button.textContent=text;button.title=title;button.setAttribute('aria-label',title);
    }
    const steps=document.createElement('div');steps.className='text-size-steps';steps.append(decrease,select,increase);
    control.append(label,steps);
    const apply=value=>{
      selected=valid(value);document.documentElement.dataset.textSize=selected;select.value=selected;
      decrease.disabled=selected===sizes[0];increase.disabled=selected===sizes[sizes.length-1];
    };
    const save=value=>{
      apply(value);
      try { localStorage.setItem(key,selected); } catch { /* Selection still works for this page. */ }
    };
    apply(selected);
    select.addEventListener('change',()=>save(select.value));
    decrease.addEventListener('click',()=>save(sizes[Math.max(0,sizes.indexOf(selected)-1)]));
    increase.addEventListener('click',()=>save(sizes[Math.min(sizes.length-1,sizes.indexOf(selected)+1)]));
    window.addEventListener('storage',event=>{if(event.key===key||event.key===null)apply(event.newValue);});
    // In the staff top bar the control sits behind a small "Aa" button so it doesn't crowd the bar.
    const menu=document.createElement('div');menu.className='text-size-menu';
    const toggle=document.createElement('button');toggle.type='button';toggle.className='text-size-toggle';toggle.textContent='Aa';
    toggle.title='ปรับขนาดตัวอักษร';toggle.setAttribute('aria-label','ปรับขนาดตัวอักษร');toggle.setAttribute('aria-controls','text-size-panel');
    const panel=document.createElement('div');panel.className='text-size-panel';panel.id='text-size-panel';
    menu.append(toggle,panel);
    const setOpen=open=>{panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));};
    setOpen(false);
    toggle.addEventListener('click',()=>setOpen(panel.hidden));
    document.addEventListener('click',event=>{if(!menu.contains(event.target))setOpen(false);});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){setOpen(false);toggle.focus();}});
    const place=()=>{
      const bar=document.querySelector('.top-actions');
      if(bar){
        if(!bar.contains(menu)){setOpen(false);bar.insertBefore(menu,bar.querySelector('.profile-menu'));}
        if(control.parentElement!==panel)panel.append(control);
        return;
      }
      const target=document.querySelector('.portal-header')||document.querySelector('.auth-form')||document.querySelector('main.portal');
      if(target&&!target.contains(control))target.prepend(control);
    };
    new MutationObserver(place).observe(document.body,{childList:true,subtree:true});
    place();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
