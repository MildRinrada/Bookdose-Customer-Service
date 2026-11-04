"""นำเข้าบทความ, step one: a file read into its blocks in order, the way the document itself is built - headings with
their level, paragraphs, list items and table rows. Nothing here guesses what belongs together; importer.py cuts the
blocks into articles.

  Word (.docx)   the heading styles, lists, tables, bold and links, read from the file's own XML (standard library).
  PDF            the text layer by pypdf: a line set larger than the body text is a heading, an indented one a list
                 item; running headers, footers and page numbers are dropped. A scanned page has no text to read.
  .txt / .md     Markdown headings and lists as written; in plain text, a short numbered line is a heading.

Thai from a PDF needs mending (clean): extractors space out the marks above and below a letter, split ำ in two, and
older fonts hand back their private-use glyph codes. Some PDF writers (Chrome among them) record a shifted tone mark
as no character at all; those places are kept as UNKNOWN and counted, for the AI or a person to put right."""
import io
import re
import unicodedata
import zipfile
from xml.etree import ElementTree

from backend.utils.validation import require

KINDS = {'pdf':'pdf','docx':'docx','txt':'txt','md':'md','markdown':'md'}
MAX_PAGES = 300
UNKNOWN = '�'
UNREADABLE = 'อ่านไฟล์นี้ไม่ได้ ไฟล์อาจเสียหรือไม่ใช่ชนิดที่ตั้งชื่อไว้'

# Thai combining marks: the vowels above and below a letter, the tone marks, ็ ์ ํ ๎.
_MARK = 'ัิ-ฺ็-๎'
_SPACE_BEFORE_MARK = re.compile(f'[  ]+(?=[{_MARK}])')
# Windows and Mac Thai fonts keep the shifted marks at U+F700-F71A; each stands for the ordinary letter.
_PRIVATE = dict(zip(range(0xF700,0xF71B),'ฐิีึื่้๊๋์่้๊๋์'
                                         'ญัํ็่้๊๋์ฺุู'))
_CONTROL = re.compile('[\x01-\x08\x0b-\x1f\x7f]')


def _thai(char):
    return '฀'<=char<='๿'


def clean(text):
    """Thai as it was typed, from what an extractor handed back."""
    text = text.replace('\x00',UNKNOWN).translate(_PRIVATE)
    text = _CONTROL.sub('',unicodedata.normalize('NFC',text))
    text = _SPACE_BEFORE_MARK.sub('',text)
    # ํ + า is how ำ is drawn; a tone mark may sit between them.
    text = re.sub('ํ([่-๋]?)า',lambda m:m.group(1)+'ำ',text)
    return re.sub(r'[ \t ]{2,}',' ',text).strip()


def kind_of(name):
    extension = name.rsplit('.',1)[-1].lower() if '.' in name else ''
    require(extension!='doc','ไฟล์ Word แบบเก่า (.doc) อ่านไม่ได้ เปิดใน Word แล้วบันทึกเป็น .docx ก่อน')
    require(extension in KINDS,'นำเข้าได้เฉพาะไฟล์ PDF, Word (.docx), .txt และ .md')
    return KINDS[extension]


def read(name, data):
    """{'kind', 'blocks', 'notes': {'images', 'unknown', 'pages'}}. Each block: {'kind': heading | para | item |
    row, 'text', 'level' (headings, 1 is the largest), 'page' (PDF only), 'qa' (a question, set by importer)}."""
    kind = kind_of(name)
    reader = {'pdf':_pdf,'docx':_docx,'txt':_text,'md':_markdown}[kind]
    blocks,notes = reader(data)
    blocks = [b for b in blocks if b['text']]
    notes['unknown'] = sum(b['text'].count(UNKNOWN) for b in blocks)
    require(blocks,'ไม่พบข้อความในไฟล์นี้' if kind!='pdf' else
            'ไม่พบตัวอักษรในไฟล์ PDF นี้ อาจเป็นภาพสแกน ระบบยังอ่านตัวอักษรจากภาพไม่ได้')
    return {'kind':kind,'blocks':blocks,'notes':notes}


def _block(kind, text, level=0, page=None):
    return {'kind':kind,'text':text,'level':level,'page':page}


# Word ---------------------------------------------------------------------------------------------------------------

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
_HEADING_NAME = re.compile(r'^(?:heading|หัวเรื่อง)\s*(\d)$',re.I)


def _xml(archive, path):
    try:
        return ElementTree.fromstring(archive.read(path))
    except KeyError:
        return None


def _styles(root):
    """{style id: heading level}. A style takes the level of the one it is based on when it has none of its own."""
    found,based = {},{}
    for style in root.iter(W+'style') if root is not None else ():
        style_id = style.get(W+'styleId')
        name = style.find(W+'name')
        name = name.get(W+'val','') if name is not None else ''
        outline = style.find(f'{W}pPr/{W}outlineLvl')
        match = _HEADING_NAME.match(name.strip())
        if match:
            found[style_id] = int(match.group(1))
        elif name.strip().lower()=='title':
            found[style_id] = 1
        elif outline is not None and outline.get(W+'val','9').isdigit() and int(outline.get(W+'val'))<9:
            found[style_id] = int(outline.get(W+'val'))+1
        parent = style.find(W+'basedOn')
        if parent is not None:
            based[style_id] = parent.get(W+'val')
    for style_id,parent in based.items():
        seen = set()
        while style_id not in found and parent and parent not in seen:
            seen.add(parent)
            if parent in found:
                found[style_id] = found[parent]
            parent = based.get(parent)
    return found


def _numbering(root):
    """{(numId, level): True when that list counts 1. 2. 3.}."""
    if root is None:
        return {}
    abstract = {}
    for item in root.iter(W+'abstractNum'):
        for lvl in item.iter(W+'lvl'):
            fmt = lvl.find(W+'numFmt')
            abstract[(item.get(W+'abstractNumId'),lvl.get(W+'ilvl'))] = fmt is not None and fmt.get(W+'val') not in ('bullet','none')
    ordered = {}
    for num in root.iter(W+'num'):
        ref = num.find(W+'abstractNumId')
        for (abstract_id,level),value in abstract.items():
            if ref is not None and ref.get(W+'val')==abstract_id:
                ordered[(num.get(W+'numId'),level)] = value
    return ordered


def _runs(paragraph, links, bold_ok):
    """The paragraph's words, with **bold** and [links](https://...) kept; (text, pictures in it)."""
    parts,pictures = [],0

    def visit(node, target=None):
        nonlocal pictures
        for child in node:
            if child.tag==W+'hyperlink':
                visit(child,links.get(child.get(R+'id')))
            elif child.tag==W+'r':
                props = child.find(W+'rPr')
                bold = props is not None and props.find(W+'b') is not None and props.find(W+'b').get(W+'val','true') not in ('0','false')
                text = ''
                for item in child:
                    if item.tag==W+'t':
                        text += item.text or ''
                    elif item.tag in (W+'tab',W+'br',W+'cr'):
                        text += ' '
                    elif item.tag in (W+'drawing',W+'pict') or item.tag.endswith('}object'):
                        pictures += 1
                parts.append((text,bold and bold_ok,target))
            elif child.tag in (W+'ins',W+'smartTag',W+'sdt',W+'sdtContent',W+'fldSimple'):
                visit(child,target)
    visit(paragraph)
    out = ''
    for text,bold,target in _merge(parts):
        if not text.strip():
            out += text
            continue
        lead,core,trail = re.match(r'^(\s*)(.*?)(\s*)$',text,re.S).groups()
        if target:
            core = f'[{core}]({target})'
        elif bold:
            core = f'**{core}**'
        out += lead+core+trail
    return out,pictures


def _merge(parts):
    """Runs side by side with the same bold and link, as one (Word splits a word wherever its editing history did)."""
    merged = []
    for text,bold,target in parts:
        if merged and merged[-1][1:]==(bold,target):
            merged[-1] = (merged[-1][0]+text,bold,target)
        else:
            merged.append((text,bold,target))
    return merged


def _docx(data):
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        document = _xml(archive,'word/document.xml')
    except (zipfile.BadZipFile,ElementTree.ParseError,OSError):
        document = None
    require(document is not None,UNREADABLE)
    styles = _styles(_xml(archive,'word/styles.xml'))
    ordered = _numbering(_xml(archive,'word/numbering.xml'))
    rels = _xml(archive,'word/_rels/document.xml.rels')
    links = {r.get('Id'):r.get('Target') for r in (rels if rels is not None else ())
             if r.get('TargetMode')=='External' and str(r.get('Target','')).startswith('https://')}
    blocks,notes = [],{'images':0,'pages':0}

    def paragraph(node):
        props = node.find(W+'pPr')
        style = props.find(W+'pStyle') if props is not None else None
        level = styles.get(style.get(W+'val')) if style is not None else None
        outline = props.find(W+'outlineLvl') if props is not None else None
        if outline is not None and outline.get(W+'val','9').isdigit() and int(outline.get(W+'val'))<9:
            level = int(outline.get(W+'val'))+1
        text,pictures = _runs(node,links,bold_ok=not level)
        notes['images'] += pictures
        text = clean(text)
        if level:
            blocks.append(_block('heading',text.replace('**',''),min(level,6)))
            return
        numbering = props.find(W+'numPr') if props is not None else None
        if numbering is not None:
            num,ilvl = numbering.find(W+'numId'),numbering.find(W+'ilvl')
            key = (num.get(W+'val') if num is not None else None,ilvl.get(W+'val') if ilvl is not None else '0')
            blocks.append(_block('item',text,1 if ordered.get(key) else 0))
        else:
            blocks.append(_block('para',text))

    def table(node):
        for row in node.iter(W+'tr'):
            cells = [clean(' '.join(_runs(p,links,True)[0] for p in cell.iter(W+'p'))) for cell in row.iter(W+'tc')]
            if any(cells):
                blocks.append({**_block('row',' | '.join(c for c in cells if c)),'cells':cells})

    def walk(node):
        for child in node:
            if child.tag==W+'p':
                paragraph(child)
            elif child.tag==W+'tbl':
                table(child)
            elif child.tag in (W+'sdt',W+'sdtContent',W+'customXml'):
                walk(child)
    body = document.find(W+'body')
    walk(body if body is not None else document)
    return blocks,notes


# PDF ----------------------------------------------------------------------------------------------------------------

def _pdf(data):
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            require(reader.decrypt(''),'ไฟล์ PDF นี้ตั้งรหัสผ่านไว้ บันทึกเป็นไฟล์ที่ไม่มีรหัสผ่านก่อน')
        pages = list(reader.pages)
    except (PdfReadError,ValueError,KeyError,TypeError,OSError):
        require(False,UNREADABLE)
    require(len(pages)<=MAX_PAGES,f'ไฟล์ PDF ยาวเกิน {MAX_PAGES} หน้า แบ่งเป็นหลายไฟล์ก่อน')
    lines,images = [],0
    for number,page in enumerate(pages,1):
        try:
            lines += _page_lines(page,number)
            images += _images(page)
        except Exception:
            # One page a reader cannot follow is not the whole document lost.
            continue
    return _pdf_blocks(lines,len(pages)),{'images':images,'pages':len(pages)}


def _page_lines(page, number):
    """The page's lines in reading order: (text, x, y, size, bold, page)."""
    lines,current = [],None

    def visit(text, cm, tm, font, size):
        nonlocal current
        if not text:
            return
        scale = abs(tm[0]*cm[0]+tm[1]*cm[2]) or 1
        x,y = tm[4]*cm[0]+tm[5]*cm[2]+cm[4],tm[4]*cm[1]+tm[5]*cm[3]+cm[5]
        height = round((size or 0)*scale,1)
        bold = 'bold' in str((font or {}).get('/BaseFont','')).lower() or 'black' in str((font or {}).get('/BaseFont','')).lower()
        for index,piece in enumerate(text.split('\n')):
            if index:
                current = None
            if not piece.strip():
                if current and piece:
                    current['text'] += piece
                continue
            if current and abs(current['y']-y)<=max(height,current['size'])*0.5:
                current['text'] += piece
                current['size'] = max(current['size'],height)
                current['bold'] = current['bold'] and bold
            else:
                current = {'text':piece,'x':x,'y':y,'size':height,'bold':bold,'page':number}
                lines.append(current)
    page.extract_text(visitor_text=visit)
    for line in lines:
        line['text'] = clean(line['text'])
    return [line for line in lines if line['text']]


def _images(page):
    try:
        objects = page['/Resources'].get('/XObject') or {}
        return sum(1 for ref in objects.values() if ref.get_object().get('/Subtype')=='/Image')
    except Exception:
        return 0


def _pdf_blocks(lines, page_count):
    if not lines:
        return []
    # What repeats at the same height on many pages is a running header or footer, a bare number a page number.
    seen = {}
    for line in lines:
        seen.setdefault((line['text'],round(line['y'])),set()).add(line['page'])
    repeated = {key for key,pages in seen.items() if page_count>=3 and len(pages)>=max(2,page_count//2)}
    lines = [l for l in lines if (l['text'],round(l['y'])) not in repeated and not re.fullmatch(r'(?:หน้า\s*)?[\d๐-๙]+(?:\s*/\s*[\d๐-๙]+)?',l['text'])]
    if not lines:
        return []
    weight = {}
    for line in lines:
        weight[line['size']] = weight.get(line['size'],0)+len(line['text'])
    body = max(weight,key=weight.get)
    larger = sorted({l['size'] for l in lines if l['size']>=body*1.12},reverse=True)[:5]
    margin = min(weight_x for weight_x in _common_x(lines))
    blocks,previous = [],None
    for line in lines:
        text = line['text']
        if line['size'] in larger and len(text)<=150:
            blocks.append(_block('heading',text,larger.index(line['size'])+1,line['page']))
            previous = None
            continue
        if line['bold'] and len(text)<=80 and line['size']>=body*0.95 and not text.endswith((':','：')):
            blocks.append(_block('heading',text,len(larger)+1,line['page']))
            previous = None
            continue
        bullet = re.match(r'^[•●▪◦‣\-–*]\s*(.+)$',text)
        indented = line['x']>margin+line['size']
        if bullet or indented:
            blocks.append(_block('item',bullet.group(1) if bullet else text,0,line['page']))
            previous = None
            continue
        joined = previous and previous['page']==line['page'] and abs(previous['x']-line['x'])<2 and abs(previous['size']-line['size'])<0.5 \
            and 0<previous['y']-line['y']<=line['size']*1.8
        if joined:
            last = blocks[-1]
            # A Thai line breaks between words that have no space between them.
            last['text'] += ('' if _thai(last['text'][-1]) and _thai(text[0]) else ' ')+text
        else:
            blocks.append(_block('para',text,0,line['page']))
        previous = line
    return blocks


def _common_x(lines):
    """The left edges most lines start at (the text's margin), from the most common."""
    count = {}
    for line in lines:
        count[round(line['x'])] = count.get(round(line['x']),0)+len(line['text'])
    best = max(count.values())
    return [x for x,n in count.items() if n>=best*0.5]


# Plain text and Markdown --------------------------------------------------------------------------------------------

def _decode(data):
    for encoding in ('utf-8-sig','cp874'):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    require(False,UNREADABLE)


_MD_HEAD = re.compile(r'^(#{1,6})\s+(.+?)\s*#*\s*$')
_MD_ITEM = re.compile(r'^\s*(?:([-*+•])|\d+[.)])\s+(.+)$')
_NUMBERED_HEAD = re.compile(r'^((?:\d+\.)+\d*|ข้อ\s*\d+)\s*\S.{0,90}$')


def _markdown(data):
    blocks = []
    for line in _decode(data).splitlines():
        text = clean(line)
        head,item = _MD_HEAD.match(text),_MD_ITEM.match(line)
        if head:
            blocks.append(_block('heading',head.group(2),len(head.group(1))))
        elif item:
            blocks.append(_block('item',clean(item.group(2)),0 if item.group(1) else 1))
        elif text:
            blocks.append(_block('para',text))
    return blocks,{'images':len(re.findall(r'!\[[^\]]*\]\((?!https://)',_decode(data))),'pages':0}


def _text(data):
    """Paragraphs are separated by blank lines; a short numbered line standing alone ("1. ...", "2.1 ...") is a heading,
    and so is a short first line on its own, the document's title."""
    blocks = []
    for chunk in re.split(r'\n\s*\n',_decode(data)):
        rows = [clean(r) for r in chunk.splitlines() if clean(r)]
        if not rows:
            continue
        numbered = _NUMBERED_HEAD.match(rows[0])
        if numbered and len(rows[0])<=100:
            depth = numbered.group(1).rstrip('.').count('.')+1 if numbered.group(1)[0].isdigit() else 1
            blocks.append(_block('heading',rows[0],min(depth+1,6)))
            rows = rows[1:]
        elif not blocks and len(rows)==1 and len(rows[0])<=80 and not rows[0].endswith(('.','?',':','ค่ะ','ครับ')):
            blocks.append(_block('heading',rows[0],1))
            rows = []
        for row in rows:
            item = _MD_ITEM.match(row)
            blocks.append(_block('item',item.group(2),0 if item.group(1) else 1) if item else _block('para',row))
    return blocks,{'images':0,'pages':0}
