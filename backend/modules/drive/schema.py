"""Project Drive forms: a folder's name, one uploaded file (its type, size and real content), and the ids in paths."""
import io
import re
import zipfile

from backend.modules.contracts import schema as contract_schema
from backend.utils.files import matches_file_type
from backend.utils.validation import field, require

ID = re.compile(r'[a-f0-9]{32}')
# What may be put in the drive (the web app lists the same, frontend/src/features/drive/files.ts). The request body
# is at most 8 MB and files travel as base64, so one file per request of at most 5 MB.
FILE_TYPES = {'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp',
              '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              '.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              '.zip':'application/zip','.txt':'text/plain','.csv':'text/csv','.md':'text/markdown'}
MAX_FILE_BYTES = contract_schema.MAX_FILE_BYTES
# The part of an Office file's zip that says which kind it is.
OFFICE_PARTS = {'docx':'word/','xlsx':'xl/','pptx':'ppt/'}
# The read-only folders' names, which a folder of the drive may not take.
SYSTEM_NAMES = ('เอกสารสัญญา/TOR','ไฟล์ส่งมอบงาน','หลักฐานการชำระเงิน')


def an_id(value, message='ไม่พบไฟล์'):
    require(isinstance(value,str) and ID.fullmatch(value),message,404)
    return value


def folder_name(body):
    """A folder's name: 1-100 characters, no slashes or control characters, not one of the read-only folders."""
    name = re.sub(r'\s+',' ',field(body,'name',100))
    require(not any(c in name for c in '/\\') and not any(ord(c)<32 for c in name),'ชื่อโฟลเดอร์ใช้ / หรือ \\ ไม่ได้')
    require(name.lower() not in [n.lower() for n in SYSTEM_NAMES],'ชื่อนี้เป็นโฟลเดอร์ของระบบ กรุณาใช้ชื่ออื่น')
    return name


def folder_id(body):
    """The folder to upload into, or '' for the general folder (made on first use)."""
    value = body.get('folder_id') or ''
    require(value=='' or (isinstance(value,str) and ID.fullmatch(value)),'ไม่พบโฟลเดอร์',404)
    return value


def content_ok(extension, content):
    """The bytes are what the name says: the shared signature check for PDF, pictures and text, a readable zip for
    ZIP and Office files (an Office file holding its own part), UTF-8 text for CSV and Markdown."""
    if extension in ('csv','md'):
        return matches_file_type('txt',content)
    if extension=='zip' or extension in OFFICE_PARTS:
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                names = archive.namelist()
        except (zipfile.BadZipFile,ValueError):
            return False
        return extension=='zip' or any(n.startswith(OFFICE_PARTS[extension]) for n in names)
    return matches_file_type(extension,content)


def upload(body):
    """(name, mime, bytes, note) of the one file of an upload: {folder_id, note, files:[{name, data}]}."""
    items = body.get('files')
    require(isinstance(items,list) and len(items)==1,'อัปโหลดได้ครั้งละ 1 ไฟล์')
    name,mime,content = contract_schema.upload(items[0],FILE_TYPES)
    require(content_ok(name.rsplit('.',1)[-1].lower(),content),'เนื้อหาไฟล์ไม่ตรงกับชนิดไฟล์')
    return name,mime,content,field(body,'note',500,False)
