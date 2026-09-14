"""Message, attachment and conversation form validation."""
import base64
from pathlib import Path

from backend.exceptions.errors import APIError
from backend.utils.files import matches_file_type
from backend.utils.validation import require, field

ATTACHMENT_TYPES = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
                    '.gif':'image/gif','.webp':'image/webp','.mp4':'video/mp4','.webm':'video/webm',
                    '.pdf':'application/pdf','.txt':'text/plain'}


def message_content(body):
    """(text, [(file name, mime, bytes)]): text and/or up to 3 attachments of 5 MB in total."""
    text = field(body,'body',20000,False)
    uploads = body.get('attachments',[])
    require(isinstance(uploads,list) and len(uploads)<=3,'แนบไฟล์ได้สูงสุด 3 ไฟล์')
    require(text or uploads,'กรุณาพิมพ์ข้อความหรือแนบไฟล์')
    return text,_attachments(uploads)


def _attachments(uploads):
    """Decode uploads and check each file's content really matches its allowed type."""
    validated = []
    total = 0
    for item in uploads:
        require(isinstance(item,dict),'ไฟล์แนบไม่ถูกต้อง')
        name = field(item,'name',150)
        require('/' not in name and '\\' not in name and not any(ord(c)<32 for c in name),'ชื่อไฟล์ไม่ถูกต้อง')
        encoded = item.get('data','')
        require(isinstance(encoded,str),'ไฟล์แนบไม่ถูกต้อง')
        try:
            content = base64.b64decode(encoded,validate=True)
        except (ValueError,TypeError):
            raise APIError(400,'ไฟล์แนบไม่ถูกต้อง')
        total += len(content)
        require(0 < len(content) and total<=5*1024*1024,'ขนาดไฟล์รวมต้องไม่เกิน 5 MB')
        ext = Path(name).suffix.lower()
        mime = ATTACHMENT_TYPES.get(ext)
        require(mime,'รองรับ PNG, JPG, GIF, WebP, MP4, WebM, PDF และ TXT')
        require(matches_file_type(ext[1:],content),'เนื้อหาไฟล์ไม่ตรงกับชนิดไฟล์ที่รองรับ')
        validated.append((name,mime,content))
    return validated


def staff_message_kind(body):
    kind = body.get('kind','reply')
    require(kind in ('reply','note'),'ชนิดข้อความไม่ถูกต้อง')
    return kind


def conversation_status(body):
    status = body.get('status')
    require(status in ('open','closed'),'สถานะไม่ถูกต้อง')
    return status


def ai_mode(body):
    mode = body.get('mode')
    require(mode in ('human','bot'),'โหมดไม่ถูกต้อง')
    return mode


def linked_ticket_id(body):
    return field(body,'ticket_id',32)
