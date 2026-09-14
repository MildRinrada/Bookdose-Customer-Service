/* Calls to the server. Every request carries the session's CSRF token, the selected organization
   and, on the support page, the visitor's link token. */

'use strict';

async function api(path,body,method){
  const headers = {};
  if(state.boot?.csrf)headers['X-CSRF-Token']=state.boot.csrf;
  if(state.boot?.tenant_id)headers['X-Tenant-ID']=state.boot.tenant_id;
  if(state.portal?.token)headers['X-Portal-Token']=state.portal.token;
  if(body!==undefined)headers['Content-Type']='application/json';
  let response;
  try{response=await fetch(path,{method:method || (body===undefined?'GET':'POST'),headers,body:body===undefined?undefined:JSON.stringify(body)});}
  catch{throw new Error('ติดต่อโปรแกรมไม่ได้ กรุณาตรวจสอบว่าหน้าต่าง Bookdose ยังเปิดอยู่');}
  if(!response.ok){let error;try{error=(await response.json()).error;}catch{error='เกิดข้อผิดพลาด กรุณาลองใหม่';}throw new Error(error);}
  return response.headers.get('content-type')?.includes('application/json')?response.json():response.blob();
}

async function download(path,filename){const blob=await api(path);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
