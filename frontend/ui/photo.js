/* Profile picture: the picture itself is the control. Pointing at it shows a camera badge, clicking it opens the
   file chooser, and the chosen image goes through a cropper (drag to place, slide to zoom) so the person decides
   what ends up in the circle. Only the cropped square is saved - nothing is uploaded until the form is saved.
   Markup: ui/photo-picker.html, ui/photo-cropper.html. */

'use strict';

const CROP_SIZE=320;

function photoPicker(){
  const photo=state.boot?.avatar||'';
  return render('ui/photo-picker',{photo:userAvatar(),hasPhoto:Boolean(photo),avatar:photo});
}

function updatePhotoPreview(dataURL){
  const frame=$('[data-photo-preview]');
  if(frame)frame.innerHTML=dataURL?render('ui/profile-photo',{src:dataURL}):avatar(state.boot?.user?.name,2);
  const remove=$('[data-action="remove-photo"]');
  if(remove)remove.hidden=!dataURL;
}

/* The picture being cropped: the image, how far it is zoomed in and where it sits under the circle. */
let crop=null;

async function openCropper(file){
  if(!['image/png','image/jpeg'].includes(file.type))throw new Error('รองรับเฉพาะไฟล์รูป PNG หรือ JPG');
  if(file.size>5*1024*1024)throw new Error('ไฟล์รูปต้องมีขนาดไม่เกิน 5 MB');
  const bitmap=await createImageBitmap(file).catch(()=>{throw new Error('เปิดไฟล์รูปนี้ไม่ได้ กรุณาเลือกไฟล์อื่น');});
  sheet('ปรับรูปโปรไฟล์',render('ui/photo-cropper'));
  const base=Math.max(CROP_SIZE/bitmap.width,CROP_SIZE/bitmap.height);
  crop={bitmap,base,zoom:1,canvas:$('#crop-canvas'),drag:null,
    x:(CROP_SIZE-bitmap.width*base)/2,y:(CROP_SIZE-bitmap.height*base)/2};
  drawCrop();
}

// What the circle will hold, drawn as it will look: the rest of the picture stays visible but dimmed.
function drawCrop(){
  const {bitmap,base,zoom,canvas}=crop,ctx=canvas.getContext('2d');
  const w=bitmap.width*base*zoom,h=bitmap.height*base*zoom;
  crop.x=Math.min(0,Math.max(CROP_SIZE-w,crop.x));
  crop.y=Math.min(0,Math.max(CROP_SIZE-h,crop.y));
  ctx.clearRect(0,0,CROP_SIZE,CROP_SIZE);
  ctx.drawImage(bitmap,crop.x,crop.y,w,h);
  ctx.fillStyle='#0f172a99';
  ctx.beginPath();ctx.rect(0,0,CROP_SIZE,CROP_SIZE);ctx.arc(CROP_SIZE/2,CROP_SIZE/2,CROP_SIZE/2,0,Math.PI*2,true);ctx.fill();
  ctx.strokeStyle='#ffffffd9';ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(CROP_SIZE/2,CROP_SIZE/2,CROP_SIZE/2-1,0,Math.PI*2);ctx.stroke();
}

// Zooming keeps the middle of the circle on the same part of the picture.
function zoomCrop(zoom){
  const middle=CROP_SIZE/2,step=zoom/crop.zoom;
  crop.x=middle-(middle-crop.x)*step;
  crop.y=middle-(middle-crop.y)*step;
  crop.zoom=zoom;
  drawCrop();
}

/* Saved at 256 px, and smaller if the picture is too detailed to fit the profile size limit. */
function applyCrop(){
  if(!crop)return;
  const {bitmap,base,zoom}=crop;
  let url='';
  for(const size of [256,192,128]){
    const out=document.createElement('canvas');out.width=out.height=size;
    const step=size/CROP_SIZE;
    out.getContext('2d').drawImage(bitmap,crop.x*step,crop.y*step,bitmap.width*base*zoom*step,bitmap.height*base*zoom*step);
    url=out.toDataURL('image/png');
    if(url.length<=170000)break;
  }
  if(url.length>170000)throw new Error('รูปนี้มีรายละเอียดมากเกินไป กรุณาเลือกรูปอื่น');
  const field=$('input[name="avatar"]');
  if(field)field.value=url;
  updatePhotoPreview(url);
  bitmap.close();crop=null;
  closeSheet();
  toast('ปรับรูปแล้ว · กดบันทึกโปรไฟล์เพื่อใช้รูปนี้');
}

Object.assign(actions,{
  'pick-photo':async(button,id)=>{$('#photo-file')?.click();return;},
  'remove-photo':async(button,id)=>{
    const field=$('input[name="avatar"]');if(field)field.value='';
    updatePhotoPreview('');
    toast('รูปจะถูกลบเมื่อกดบันทึกโปรไฟล์');return;},
  'apply-crop':async(button,id)=>{applyCrop();return;},
});

document.addEventListener('change',event=>{
  const input=event.target;
  if(!input.dataset?.photoInput)return;
  const file=input.files[0];
  input.value='';
  if(file)openCropper(file).catch(error=>toast(error.message,true));
});

document.addEventListener('input',event=>{if(crop&&event.target.id==='crop-zoom')zoomCrop(Number(event.target.value));});

// Dragging the picture under the circle.
document.addEventListener('pointerdown',event=>{
  if(!crop||event.target!==crop.canvas)return;
  crop.drag={id:event.pointerId,x:event.clientX,y:event.clientY};
  crop.canvas.setPointerCapture(event.pointerId);
});
document.addEventListener('pointermove',event=>{
  if(!crop?.drag||event.pointerId!==crop.drag.id)return;
  const scale=CROP_SIZE/crop.canvas.getBoundingClientRect().width;
  crop.x+=(event.clientX-crop.drag.x)*scale;
  crop.y+=(event.clientY-crop.drag.y)*scale;
  crop.drag={id:crop.drag.id,x:event.clientX,y:event.clientY};
  drawCrop();
});
document.addEventListener('pointerup',()=>{if(crop)crop.drag=null;});
document.querySelector('#sheet').addEventListener('close',()=>{crop?.bitmap.close();crop=null;});
