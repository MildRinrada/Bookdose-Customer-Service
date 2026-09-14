/* HTML templates are the .html files under frontend/: ui/ (pieces every screen shares), shell/ (the app frame),
   pages/<screen>/ (one folder per screen, holding its own partials) and modules/<feature>/. They are loaded once
   from /templates.json. A template's name is its path without .html, e.g. render('pages/dashboard/dashboard').
   Syntax, kept deliberately small:
     {{name}}              value, HTML-escaped (safe in text and in attributes)
     {{{name}}}            HTML made by another render() call; never put user text here
     {{#name}}…{{/name}}   shown when the value is truthy (0, '' and empty arrays count as false)
     {{^name}}…{{/name}}   shown when the value is falsy
     {{icon:name}}         an SVG icon from core.js
   Names may use dots (contact.name). Don't nest two sections with the same name.
   A line break plus the indentation after it is removed, so a template can be formatted for reading without
   adding whitespace to the page. When text needs a space before the next tag, keep both on the same line. */

'use strict';

const templates={};

async function loadTemplates(){
  const response=await fetch('/templates.json');
  if(!response.ok)throw new Error('โหลดหน้าจอไม่สำเร็จ กรุณารีเฟรชหน้า');
  for(const [name,markup] of Object.entries(await response.json()))templates[name]=markup.replace(/\r?\n\s*/g,'').trim();
}

function render(name,data={}){
  let html=templates[name];
  if(html===undefined)throw new Error(`ไม่พบ template: ${name}`);
  const value=key=>key.split('.').reduce((v,k)=>v?.[k],data);
  const truthy=v=>Array.isArray(v)?v.length>0:Boolean(v);
  const section=/\{\{([#^])([\w.]+)\}\}([\s\S]*?)\{\{\/\2\}\}/g;
  for(let previous;previous!==html;){previous=html;html=html.replace(section,(m,kind,key,inner)=>truthy(value(key))===(kind==='#')?inner:'');}
  return html.replace(/\{\{\{([\w.]+)\}\}\}|\{\{icon:(\w+)\}\}|\{\{([\w.]+)\}\}/g,(m,raw,iconName,key)=>raw?String(value(raw)??''):iconName?icon(iconName):esc(value(key)));
}
