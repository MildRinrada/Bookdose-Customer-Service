/* A browser preference shared by staff, sign-in and customer support pages. */
(() => {
  const key='bookdose.text-size';
  const sizes={normal:'ปกติ',large:'ใหญ่',larger:'ใหญ่มาก',largest:'ใหญ่พิเศษ'};
  const valid=value=>Object.hasOwn(sizes,value)?value:'normal';
  let selected='normal';
  try { selected=valid(localStorage.getItem(key)); } catch { /* Storage may be disabled. */ }
  document.documentElement.dataset.textSize=selected;

  function init(){
    const control=document.createElement('div');
    control.className='text-size-controls';
    const label=document.createElement('label');
    label.htmlFor='text-size-select';label.textContent='ขนาดตัวอักษร';
    const select=document.createElement('select');
    select.id='text-size-select';
    for(const [value,title] of Object.entries(sizes)){
      const option=document.createElement('option');option.value=value;option.textContent=title;select.append(option);
    }
    select.value=selected;
    control.append(label,select);
    const apply=value=>{selected=valid(value);document.documentElement.dataset.textSize=selected;select.value=selected;};
    select.addEventListener('change',()=>{
      apply(select.value);
      try { localStorage.setItem(key,selected); } catch { /* Selection still works for this page. */ }
    });
    window.addEventListener('storage',event=>{if(event.key===key||event.key===null)apply(event.newValue);});
    const place=()=>{
      const target=document.querySelector('.top-actions')||document.querySelector('.portal-header')||document.querySelector('.auth-form')||document.querySelector('main.portal');
      if(target&&!target.contains(control))target.prepend(control);
    };
    new MutationObserver(place).observe(document.body,{childList:true,subtree:true});
    place();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
