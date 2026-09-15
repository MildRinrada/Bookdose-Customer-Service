"""A document written elsewhere, turned into the editor's text (the knowledge base's Markdown): Word (.docx), plain
text or Markdown. Headings, paragraphs, bold text, lists and simple tables survive; layout, pictures and fonts do not.
PDF files are attached to a contract as they are instead (their text cannot be edited reliably)."""
import io
from pathlib import Path
import re
import zipfile
from xml.etree import ElementTree

from backend.exceptions.errors import APIError
from backend.utils.validation import require

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
MAX_CHARS = 50000
MAX_XML_BYTES = 20*1024*1024


def to_text(name, content):
    ext = Path(name).suffix.lower()
    if ext=='.docx':
        return _docx(content)
    if ext in ('.txt','.md'):
        return _plain(content)
    raise APIError(400,'นำเข้าได้เฉพาะไฟล์ Word (.docx), .txt และ .md · ไฟล์ PDF ให้แนบเป็นเอกสารประกอบ')


def _finish(text):
    text = re.sub(r'\n{3,}','\n\n',text.replace('\r\n','\n').replace('\r','\n')).strip()
    require(text,'ไม่พบข้อความในไฟล์')
    return text[:MAX_CHARS]


def _plain(content):
    for encoding in ('utf-8-sig','cp874'):
        try:
            return _finish(content.decode(encoding))
        except UnicodeDecodeError:
            continue
    raise APIError(400,'อ่านข้อความในไฟล์ไม่ได้ กรุณาบันทึกเป็น UTF-8')


def _docx(content):
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            require(archive.getinfo('word/document.xml').file_size<=MAX_XML_BYTES,'ไฟล์ Word ใหญ่เกินไป')
            xml = archive.read('word/document.xml')
    except (zipfile.BadZipFile,KeyError):
        raise APIError(400,'ไฟล์ Word ไม่ถูกต้อง กรุณาบันทึกเป็น .docx') from None
    # Word never needs a DOCTYPE; refusing one keeps entity tricks out of the parser.
    require(b'<!DOCTYPE' not in xml[:4096].upper(),'ไฟล์ Word ไม่ถูกต้อง')
    try:
        body = ElementTree.fromstring(xml).find(W+'body')
    except ElementTree.ParseError:
        raise APIError(400,'ไฟล์ Word ไม่ถูกต้อง') from None
    lines = []
    for block in body if body is not None else []:
        if block.tag==W+'p':
            lines.append(_paragraph(block))
        elif block.tag==W+'tbl':
            for row in block.iter(W+'tr'):
                cells = [' '.join(_runs(p) for p in cell.iter(W+'p')).strip() for cell in row.findall(W+'tc')]
                if any(cells):
                    lines.append('- '+' | '.join(cells))
            lines.append('')
    return _finish('\n'.join(lines))


def _runs(paragraph):
    parts = []
    for run in paragraph.iter(W+'r'):
        text = ''
        for node in run:
            if node.tag==W+'t':
                text += node.text or ''
            elif node.tag==W+'tab':
                text += ' '
        bold = run.find(f'{W}rPr/{W}b')
        if bold is not None and bold.get(W+'val','true') not in ('0','false') and text.strip():
            text = text.replace(text.strip(),f'**{text.strip()}**',1)
        parts.append(text)
    return ''.join(parts)


def _paragraph(paragraph):
    text = _runs(paragraph).strip()
    if not text:
        return ''
    style = paragraph.find(f'{W}pPr/{W}pStyle')
    name = (style.get(W+'val','') if style is not None else '').lower()
    if name=='title' or name in ('heading1','heading 1'):
        return '# '+text.replace('**','')
    if name.startswith('heading'):
        return '## '+text.replace('**','')
    if paragraph.find(f'{W}pPr/{W}numPr') is not None:
        return '- '+text
    return text
