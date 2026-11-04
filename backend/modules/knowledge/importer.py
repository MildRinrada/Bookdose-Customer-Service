"""นำเข้าบทความ: a PDF, Word or text file becomes draft articles the หัวหน้าทีม checks before any is saved.

  1. document.py reads the file into its blocks (headings, paragraphs, list items, table rows).
  2. The blocks are cut at the headings into sections. A question written ถาม / Q: is a section of its own, and a
     heading whose whole part is short keeps its sub-headings with it, so a task's steps stay one section.
  3. With the organization's AI on (AI ช่วยเจ้าหน้าที่), the AI is shown the sections and decides which belong in one
     article, gives each a title the way customers ask, picks a category (an existing one first) and points out the
     existing article that already answers it. It never writes the text: an article's body is the document's own
     words, so a fact the document did not state cannot reach the knowledge base (or the chatbot) from here. The same
     job fills the tone marks a PDF lost (document.UNKNOWN), only ever one mark per place. Without the AI, or when its
     answer does not hold up, each section is a draft as the document cut it.
  4. A draft the AI should word better is rewritten on request ("ให้ AI เรียบเรียง", mode rewrite): the result is
     kept beside the document's words, used only when the หัวหน้าทีม chooses it, and refused when a number, link,
     email address or phone number in it differs from the original's.
  5. Every draft starts as ภายในองค์กร. Saved drafts become ordinary articles; the import is gone once none is left,
     or after KEEP_DAYS. The file itself is never kept."""
import base64
import binascii
import datetime as dt
import json
import os
import re

from backend.database import audit
from backend.database.db import begin, rows
from backend.exceptions.errors import AIError
from backend.modules.knowledge import document, repository, schema
from backend.utils.dates import after, iso, now
from backend.utils.security import uid
from backend.utils.validation import require

MAX_FILE_BYTES = 5*1024*1024
KEEP_DAYS = 7
# A part this short (in characters) is kept whole with its sub-headings: the steps of one task are one section.
KEEP_WHOLE_UNDER = 2500
MAX_SECTIONS = 200
# What the AI is shown of each section: its start is enough to see what it is about.
EXCERPT_CHARS = 600
AI_SECTIONS = 150
MARKS_MAX = 300
ARTICLE_MAX = 50000
PART_CHARS = 20000
REWRITE_MAX = 8000
# The marks a lost glyph may be: tone marks, ์, and the vowels and signs above a letter.
MARKS = ('\u0e48','\u0e49','\u0e4a','\u0e4b','\u0e4c','\u0e34','\u0e35','\u0e36','\u0e37','\u0e31','\u0e47','\u0e4d')
DRAFT_STATES = ('open','saved','skipped')
NOT_DONE = 'รอ AI จัดกลุ่มให้เสร็จก่อน หรือกด "ไม่รอ AI" เพื่อใช้การแบ่งตามหัวข้อในเอกสาร'
AI_NOTES = {
    'disabled':'องค์กรยังไม่ได้เปิด AI ช่วยเจ้าหน้าที่ จึงแบ่งตามหัวข้อในเอกสาร',
    'not_configured':'องค์กรยังไม่ได้เชื่อม AI จึงแบ่งตามหัวข้อในเอกสาร',
    'quota':'ใช้ AI ครบจำนวนของวันนี้แล้ว จึงแบ่งตามหัวข้อในเอกสาร',
    'failed':'AI จัดกลุ่มไม่สำเร็จ จึงแบ่งตามหัวข้อในเอกสาร',
    'skipped':'ไม่รอ AI แบ่งตามหัวข้อในเอกสาร',
}

# Reading the file -----------------------------------------------------------------------------------------------------

def _file(body):
    """(file name, bytes) of the upload: {'name', 'data' (base64)}."""
    body = body if isinstance(body,dict) else {}
    name = os.path.basename(str(body.get('name') or '').replace('\\','/')).strip()[:200]
    require(name,'เลือกไฟล์ก่อน')
    document.kind_of(name)
    data = body.get('data')
    require(isinstance(data,str) and data,'เลือกไฟล์ก่อน')
    require(len(data)<=MAX_FILE_BYTES*4//3+8,f'ไฟล์ใหญ่เกิน {MAX_FILE_BYTES//1024//1024} MB')
    try:
        raw = base64.b64decode(data,validate=True)
    except (binascii.Error,ValueError):
        require(False,document.UNREADABLE)
    require(raw,'ไฟล์ว่างเปล่า')
    return name,raw


_QUESTION = re.compile(r'^(?:\*\*)?(?:ถาม|คำถาม|Q)(?:\*\*)?\s*[:：.]\s*(?:\*\*)?\s*(.+)$',re.I)
_ANSWER = re.compile(r'^(?:\*\*)?(?:ตอบ|คำตอบ|A)(?:\*\*)?\s*[:：.]\s*(?:\*\*)?\s*',re.I)
_NUMBERING = re.compile(r'^(?:(?:บทที่|ข้อ|ส่วนที่)\s*)?(?:[\d๐-๙]+(?:\.[\d๐-๙]+)*\.?|[\d๐-๙]+\))\s+')


def _questions(blocks):
    """ถาม / ตอบ (Q: / A:) pairs: the question becomes a heading of its own, below every real one."""
    deepest = max([b['level'] for b in blocks if b['kind']=='heading'] or [0])
    out = []
    for block in blocks:
        asked = _QUESTION.match(block['text']) if block['kind']=='para' else None
        if asked:
            out.append({**block,'kind':'heading','text':asked.group(1).replace('**','').strip(),'level':deepest+1,'qa':True})
        elif block['kind']=='para' and out and out[-1].get('qa') and _ANSWER.match(block['text']):
            out.append({**block,'text':_ANSWER.sub('',block['text'],count=1)})
        else:
            out.append(block)
    return out


def _tree(blocks):
    root = {'title':'','level':0,'own':[],'children':[],'qa':False,'page':None}
    stack = [root]
    for block in blocks:
        if block['kind']=='heading':
            node = {'title':block['text'],'level':block['level'],'own':[],'children':[],'qa':bool(block.get('qa')),'page':block.get('page')}
            while len(stack)>1 and stack[-1]['level']>=node['level']:
                stack.pop()
            stack[-1]['children'].append(node)
            stack.append(node)
        else:
            stack[-1]['own'].append(block)
    return root


def _size(node):
    return sum(len(b['text']) for b in node['own'])+sum(len(c['title'])+_size(c) for c in node['children'])


def _markdown(blocks):
    """Blocks as the knowledge base's Markdown (backend/utils/markdown.py): one line per paragraph, # and ## headings."""
    lines,header = [],False
    for index,block in enumerate(blocks):
        kind = block['kind']
        if kind=='heading':
            lines.append(('# ' if block['depth']<=1 else '## ')+block['text'])
        elif kind=='item':
            lines.append(('1. ' if block['level'] else '- ')+block['text'])
        elif kind=='row':
            # No tables in an article: the first row of a table reads as its heading, each other row as an item.
            first = index==0 or blocks[index-1]['kind']!='row'
            cells = [c for c in block.get('cells') or [block['text']] if c]
            if first and len(cells)>1 and index+1<len(blocks) and blocks[index+1]['kind']=='row':
                lines.append('**'+' | '.join(cells)+'**')
                header = True
            elif len(cells)==2 and not header:
                lines.append(f'- **{cells[0]}**: {cells[1]}')
            else:
                lines.append('- '+' | '.join(cells))
        else:
            lines.append(block['text'])
        if kind!='row':
            header = False
    return '\n'.join(lines)


def _flat(node, depth=0):
    """The node's own words and, below them, every part under it with its heading (depth 1 is # , deeper ## )."""
    out = list(node['own'])
    for child in node['children']:
        out.append({'kind':'heading','text':child['title'],'depth':depth+1,'level':0})
        out += _flat(child,depth+1)
    return out


def _pages(node):
    found = [node['page']]+[b.get('page') for b in node['own']]
    for child in node['children']:
        found += _pages(child)
    return [p for p in found if p]


def sections(blocks, file_title):
    """The document cut into sections, in order: {'ref', 'title', 'path' (the headings above it), 'body' (Markdown),
    'pages': [first, last] or []}."""
    root = _tree(_questions(blocks))
    # One heading over the whole document is its title, not a part of it.
    top,title = root,''
    if len(root['children'])==1 and sum(len(b['text']) for b in root['own'])<40:
        top = root['children'][0]
        title = top['title']
    title = title or file_title
    found = []

    def emit(heading, body_blocks, path, pages):
        body = _markdown(body_blocks).strip()
        if not body:
            return
        # An article holds 50,000 characters: a longer part goes in as several.
        parts = _split(body) if len(body)>ARTICLE_MAX else [body]
        for number,part in enumerate(parts,1):
            name = heading if len(parts)==1 else f'{heading} (ตอนที่ {number})'
            found.append({'ref':f's{len(found)+1}','title':name[:200],'path':path,'body':part,'pages':[min(pages),max(pages)] if pages else []})

    def cut(node, path):
        asks = any(c['qa'] for c in node['children'])
        if node is not top and (not node['children'] or (_size(node)<=KEEP_WHOLE_UNDER and not asks)):
            emit(node['title'],_flat(node),path,_pages(node))
            return
        if node['own']:
            emit(node['title'] or title,node['own'],path,[b['page'] for b in node['own'] if b.get('page')])
        for child in node['children']:
            cut(child,path+[node['title']] if node is not top and node['title'] else path)
    cut(top,[])
    require(found,'ไม่พบเนื้อหาที่ใช้เป็นบทความได้ในไฟล์นี้')
    require(len(found)<=MAX_SECTIONS,f'เอกสารนี้แบ่งได้มากกว่า {MAX_SECTIONS} ส่วน แบ่งเป็นไฟล์ย่อยก่อนนำเข้า')
    return title,found


def _split(body):
    parts,current = [],''
    for line in body.split('\n'):
        if current and len(current)+len(line)>PART_CHARS:
            parts.append(current)
            current = ''
        current += ('\n' if current else '')+line
    return parts+[current] if current else parts


def plain_title(text):
    """A heading as an article's title: without the document's own numbering (1.2, ข้อ 3, บทที่ 2)."""
    stripped = _NUMBERING.sub('',text.strip()).strip(' :-')
    return (stripped or text.strip())[:200]


# Drafts -----------------------------------------------------------------------------------------------------------

def _grams(text):
    text = re.sub(r'[\W_]+','',text.lower())
    return {text[i:i+3] for i in range(max(1,len(text)-2))}


def _duplicate(title, articles):
    """The existing article whose title is nearly this one (Thai has no spaces, so it is compared in letter triples)."""
    mine = _grams(title)
    best,score = None,0.0
    for article in articles:
        theirs = _grams(article['title'])
        overlap = len(mine & theirs)/max(1,len(mine | theirs))
        if overlap>score:
            best,score = article,overlap
    return {'id':best['id'],'title':best['title']} if best and score>=0.6 else None


def _source(section_list, kind):
    pages = [p for s in section_list for p in s['pages']]
    if pages and kind=='pdf':
        low,high = min(pages),max(pages)
        return f'หน้า {low}' if low==high else f'หน้า {low} ถึง {high}'
    first = section_list[0]
    return ' > '.join([*first['path'],first['title']])[:300]


def _draft(number, section_list, title, category, kind, articles, duplicate=None, skip=False):
    if len(section_list)==1:
        body = section_list[0]['body']
    else:
        body = '\n'.join(f"# {plain_title(s['title'])}\n{s['body']}" for s in section_list)
    return {'id':f'd{number}','refs':[s['ref'] for s in section_list],'title':title[:200],'category':(category or 'ทั่วไป')[:80],
            'visibility':'internal','body':body[:ARTICLE_MAX],'source_body':'','source':_source(section_list,kind),
            'duplicate':duplicate if duplicate is not None else _duplicate(title,articles),'suggest_skip':skip,
            'unknown':body.count(document.UNKNOWN),'state':'open','article_id':None,'rewrite':None}


def rule_drafts(section_list, doc_title, kind, articles):
    """One draft per section, named by its heading, in the category of the heading above it (or the document's)."""
    return [_draft(i,[s],plain_title(s['title']),plain_title(s['path'][0]) if s['path'] else plain_title(doc_title)[:80],kind,articles)
            for i,s in enumerate(section_list,1)]


# The AI's part ----------------------------------------------------------------------------------------------------

_LOST = re.compile(f'[\u0e00-\u0e7f{document.UNKNOWN}]{{0,12}}{document.UNKNOWN}[\u0e00-\u0e7f{document.UNKNOWN}]{{0,12}}')


def _lost_words(section_list):
    """{word with its lost marks: ref}, from the first MARKS_MAX different ones."""
    words = {}
    for section in section_list:
        for match in _LOST.finditer(section['body']):
            if match.group(0) not in words and len(words)<MARKS_MAX:
                words[match.group(0)] = f'm{len(words)+1}'
    return words


def payload(doc_title, section_list, articles):
    shown = section_list[:AI_SECTIONS]
    existing = articles[:150]
    words = _lost_words(section_list)
    return {'document':doc_title,
            'sections':[{'ref':s['ref'],'path':s['path'],'title':s['title'],'text':s['body'][:EXCERPT_CHARS].replace(document.UNKNOWN,'[?]'),
                         'characters':len(s['body'])} for s in shown],
            'categories':sorted({a['category'] for a in articles})[:60],
            'existing_articles':[{'ref':f'a{i}','title':a['title'],'category':a['category']} for i,a in enumerate(existing,1)],
            'marks':[{'ref':ref,'word':word.replace(document.UNKNOWN,'[?]')} for word,ref in words.items()],
            '_articles':{f'a{i}':{'id':a['id'],'title':a['title']} for i,a in enumerate(existing,1)},
            '_words':{ref:word for word,ref in words.items()}}


def _text(value, limit):
    return value.strip()[:limit] if isinstance(value,str) and value.strip() else ''


def validate(mode, result, job_payload):
    """The AI's answer, checked against what it was shown; AIError when it does not hold up."""
    if not isinstance(result,dict):
        raise AIError('invalid_output')
    if mode=='rewrite':
        return _validate_rewrite(result,job_payload)
    refs = [s['ref'] for s in job_payload.get('sections',[])]
    groups,used = [],set()
    for item in result.get('articles') if isinstance(result.get('articles'),list) else []:
        if not isinstance(item,dict) or not isinstance(item.get('sections'),list):
            continue
        # A section the AI named twice stays in the first article that took it.
        mine = list(dict.fromkeys(r for r in item['sections'] if isinstance(r,str) and r in refs and r not in used))
        if not mine:
            continue
        used.update(mine)
        duplicate = job_payload.get('_articles',{}).get(item.get('duplicate')) if isinstance(item.get('duplicate'),str) else None
        groups.append({'refs':sorted(mine,key=refs.index),'title':_text(item.get('title'),200),'category':_text(item.get('category'),80),
                       'duplicate':duplicate})
    if not groups:
        raise AIError('invalid_output')
    skip = [r for r in result.get('skip') or [] if isinstance(r,str) and r in refs and r not in used]
    words = job_payload.get('_words') or {}
    marks = {}
    for item in result.get('marks') if isinstance(result.get('marks'),list) else []:
        word = words.get(item.get('ref')) if isinstance(item,dict) else None
        chosen = item.get('marks') if word else None
        # Exactly one mark from MARKS for each lost one, or nothing at all for that word.
        if isinstance(chosen,list) and len(chosen)==word.count(document.UNKNOWN) and all(m in MARKS for m in chosen):
            fixed = iter(chosen)
            marks[word] = re.sub(document.UNKNOWN,lambda _:next(fixed),word)
    return {'groups':groups,'skip':skip,'marks':marks}


_FACT = re.compile(r'https?://[^\s)\]]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|[\d๐-๙]+(?:[.,:/-][\d๐-๙]+)*')
_LIST_NUMBER = re.compile(r'^\s*\d+[.)]\s+',re.M)


def facts(text):
    """The numbers, links and email addresses in a text (a numbered list's own numbers are not facts)."""
    return set(_FACT.findall(_LIST_NUMBER.sub('',text)))


def _validate_rewrite(result, job_payload):
    body,sent = result.get('body'),job_payload.get('body','')
    if not isinstance(body,str) or not body.strip() or not len(sent)*0.4<=len(body)<=len(sent)*1.6+400:
        raise AIError('invalid_output')
    # Nothing made up and nothing lost: the same numbers, links and addresses as the document's words.
    if facts(body)!=facts(sent):
        raise AIError('changed_facts')
    # The article's title is shown above it already; a heading that repeats it goes.
    lines = body.strip().split('\n')
    if re.sub(r'^#+\s*','',lines[0]).strip()==str(job_payload.get('title','')).strip() and lines[0].startswith('#'):
        lines = lines[1:]
    return {'body':'\n'.join(lines).strip() or body.strip()}


def _with_marks(text, marks):
    return _LOST.sub(lambda m:marks.get(m.group(0),m.group(0)),text) if marks else text


def apply(db, job, result, error):
    """A finished AI job of an import (ai/service.py process_one), in the worker's transaction."""
    job_payload = json.loads(job['payload'] or '{}')
    found = _find(db,job_payload.get('_import_id'))
    if not found:
        return
    if job['mode']=='rewrite':
        draft = next((d for d in found['drafts'] if d['id']==job_payload.get('_draft_id')),None)
        if draft and (draft.get('rewrite') or {}).get('job_id')==job['id']:
            draft['rewrite'] = {'job_id':job['id'],'status':'failed' if error else 'done','body':'' if error else result['body'],'error':error or ''}
            _store(db,found)
        return
    if found['ai']!='grouping' or found['job_id']!=job['id']:
        return
    if error:
        found['ai'],found['ai_note'] = 'failed',AI_NOTES['failed']
        _store(db,found)
        return
    sections_by_ref = {}
    for section in found['sections']:
        section['body'] = _with_marks(section['body'],result['marks'])
        sections_by_ref[section['ref']] = section
    articles = _articles(db)
    drafts,taken = [],set()
    for group in result['groups']:
        chosen = [sections_by_ref[r] for r in group['refs']]
        title = group['title'] or plain_title(chosen[0]['title'])
        drafts.append(_draft(len(drafts)+1,chosen,title,group['category'] or (plain_title(chosen[0]['path'][0]) if chosen[0]['path'] else ''),
                             found['kind'],articles,duplicate=group['duplicate'] or _duplicate(title,articles)))
        taken.update(group['refs'])
    # What the AI left out is still offered: as a draft of its own, marked when the AI thought it no article at all.
    skip = set(result['skip'])
    for section in found['sections']:
        if section['ref'] not in taken:
            drafts.append(_draft(len(drafts)+1,[section],plain_title(section['title']),plain_title(section['path'][0]) if section['path'] else '',
                                 found['kind'],articles,skip=section['ref'] in skip))
    order = {s['ref']:i for i,s in enumerate(found['sections'])}
    drafts.sort(key=lambda d:order[d['refs'][0]])
    for number,draft in enumerate(drafts,1):
        draft['id'] = f'd{number}'
    found['drafts'] = drafts
    found['notes']['fixed'] = sum(1 for _ in result['marks'])
    found['ai'],found['ai_note'] = 'done',''
    _store(db,found)


# Storage and views ------------------------------------------------------------------------------------------------

def _articles(db):
    return rows(db,'SELECT id,title,category FROM knowledge_articles ORDER BY updated_at DESC')


def _purge(db):
    db.execute('DELETE FROM knowledge_imports WHERE created_at<?',(after(days=-KEEP_DAYS),))


def _find(db, import_id):
    row = db.execute('SELECT * FROM knowledge_imports WHERE id=? AND created_at>=?',(import_id,after(days=-KEEP_DAYS))).fetchone() if import_id else None
    if not row:
        return None
    found = dict(row)
    for key in ('sections','drafts','notes'):
        found[key] = json.loads(found[key])
    return found


def _store(db, found):
    db.execute('UPDATE knowledge_imports SET sections=?,drafts=?,notes=?,ai=?,ai_note=?,job_id=? WHERE id=?',
               (json.dumps(found['sections'],ensure_ascii=False),json.dumps(found['drafts'],ensure_ascii=False),
                json.dumps(found['notes'],ensure_ascii=False),found['ai'],found['ai_note'],found['job_id'],found['id']))


def _get(db, import_id):
    found = _find(db,import_id)
    require(found,'ไม่พบไฟล์ที่นำเข้า อาจบันทึกครบแล้ว ถูกทิ้ง หรือเกิน 7 วัน',404)
    return found


def _draft_of(found, draft_id):
    draft = next((d for d in found['drafts'] if d['id']==draft_id),None)
    require(draft,'ไม่พบร่างบทความนี้',404)
    return draft


def _reconcile(db, found):
    """A job the worker cancelled (the AI settings changed, the day's limit) never comes back: say so instead of waiting."""
    from backend.modules.ai import repository as ai_repository
    changed = False
    if found['ai']=='grouping':
        job = ai_repository.find_job(db,found['job_id'])
        if not job or job['status'] in ('cancelled','failed'):
            found['ai'],found['ai_note'],changed = 'failed',AI_NOTES['failed'],True
    for draft in found['drafts']:
        rewrite = draft.get('rewrite')
        if rewrite and rewrite['status']=='pending':
            job = ai_repository.find_job(db,rewrite['job_id'])
            if not job or job['status'] in ('cancelled','failed'):
                draft['rewrite'] = {**rewrite,'status':'failed','error':job['error'] if job else 'stale'}
                changed = True
    if changed:
        _store(db,found)
        db.commit()


def view(db, ctx, found):
    from backend.modules.ai import repository as ai_repository, service as ai_service
    progress = None
    if found['ai']=='grouping':
        job = ai_repository.find_job(db,found['job_id'])
        progress = ai_service.progress(db,ctx['tenant_id'],job) if job and job['status'] in ('pending','running') else None
    return {'id':found['id'],'file_name':found['file_name'],'kind':found['kind'],'created_at':found['created_at'],
            'expires_at':iso(dt.datetime.fromisoformat(found['created_at'])+dt.timedelta(days=KEEP_DAYS)),
            'ai':{'state':found['ai'],'note':found['ai_note'],'progress':progress,'available':_ai_ready(db,ctx)},
            'notes':found['notes'],
            'drafts':[{k:v for k,v in d.items() if k!='refs'} for d in found['drafts']]}


def _ai_ready(db, ctx):
    from backend.modules.ai import service as ai_service
    return bool(ai_service.config(db)['drafts_enabled'] and ai_service.has_key(ctx['tenant_id']))


# The หัวหน้าทีม's actions -----------------------------------------------------------------------------------------

def start(db, ctx, body):
    """Read the upload, cut it, keep the drafts and, when the organization's AI is on, ask it to group them."""
    from backend.modules.ai import service as ai_service
    name,raw = _file(body)
    read = document.read(name,raw)
    doc_title,section_list = sections(read['blocks'],plain_title(name.rsplit('.',1)[0]))
    begin(db)
    _purge(db)
    articles = _articles(db)
    import_id = uid()
    found = {'id':import_id,'file_name':name,'kind':read['kind'],'created_by':ctx['id'],'created_at':now(),'sections':section_list,
             'drafts':rule_drafts(section_list,doc_title,read['kind'],articles),'notes':{**read['notes'],'sections':len(section_list),'fixed':0},
             'ai':'off','ai_note':'','job_id':None}
    try:
        found['job_id'] = ai_service.enqueue(db,ctx['tenant_id'],'import',requested_by=ctx['id'],
                                             payload={**payload(doc_title,section_list,articles),'_import_id':import_id})
        found['ai'] = 'grouping'
    except AIError as failure:
        found['ai_note'] = AI_NOTES.get(failure.code,AI_NOTES['failed'])
    db.execute("INSERT INTO knowledge_imports(id,file_name,kind,created_by,created_at,sections,drafts,ai) VALUES(?,?,?,?,?,'[]','[]','off')",
               (import_id,name,found['kind'],ctx['id'],found['created_at']))
    _store(db,found)
    audit.record(db,ctx['name'],'article.import_started',import_id,name)
    db.commit()
    return view(db,ctx,found)


def open_imports(db):
    """The imports still waiting to be checked, newest first (the knowledge page points back to them)."""
    _purge(db)
    db.commit()
    found = []
    for row in rows(db,'SELECT id,file_name,created_at,drafts FROM knowledge_imports ORDER BY created_at DESC'):
        left = sum(1 for d in json.loads(row['drafts']) if d['state']=='open')
        found.append({'id':row['id'],'file_name':row['file_name'],'created_at':row['created_at'],'open':left})
    return {'imports':found}


def get(db, ctx, import_id):
    found = _get(db,import_id)
    _reconcile(db,found)
    return view(db,ctx,found)


def skip_ai(db, ctx, import_id):
    """ไม่รอ AI: the drafts as the document's headings cut them, now."""
    from backend.modules.ai import repository as ai_repository
    begin(db)
    found = _get(db,import_id)
    if found['ai']=='grouping':
        ai_repository.set_job_state(db,found['job_id'],'cancelled','skipped')
        found['ai'],found['ai_note'] = 'off',AI_NOTES['skipped']
        _store(db,found)
    db.commit()
    return view(db,ctx,found)


def set_draft(db, ctx, import_id, draft_id, body):
    """ข้าม / เอากลับมา, and which words a draft keeps: the document's or the AI's rewriting of them."""
    action = (body if isinstance(body,dict) else {}).get('action')
    require(action in ('skip','keep','use_rewrite','use_source','drop_rewrite'),'คำสั่งไม่ถูกต้อง')
    begin(db)
    found = _get(db,import_id)
    require(found['ai']!='grouping',NOT_DONE,409)
    draft = _draft_of(found,draft_id)
    require(draft['state']!='saved','บันทึกร่างนี้เป็นบทความแล้ว',409)
    rewrite = draft.get('rewrite') or {}
    if action in ('skip','keep'):
        draft['state'] = 'skipped' if action=='skip' else 'open'
    elif action=='use_rewrite':
        require(rewrite.get('status')=='done','ยังไม่มีฉบับที่ AI เรียบเรียง',409)
        draft['source_body'] = draft['source_body'] or draft['body']
        draft['body'] = rewrite['body']
    elif action=='use_source':
        if draft['source_body']:
            draft['body'],draft['source_body'] = draft['source_body'],''
    else:
        draft['rewrite'] = None
    _store(db,found)
    db.commit()
    return view(db,ctx,found)


def rewrite(db, ctx, import_id, draft_id):
    """ให้ AI เรียบเรียง: the document's words of one draft, sent to be written more clearly."""
    from backend.modules.ai import service as ai_service
    begin(db)
    found = _get(db,import_id)
    require(found['ai']!='grouping',NOT_DONE,409)
    draft = _draft_of(found,draft_id)
    require(draft['state']=='open','เลือกร่างที่ยังไม่ได้บันทึก',409)
    words = draft['source_body'] or draft['body']
    require(len(words)<=REWRITE_MAX,f'ร่างนี้ยาวเกิน {REWRITE_MAX:,} ตัวอักษร ให้ AI เรียบเรียงทีละส่วนไม่ได้ แก้เองในหน้าแก้ไขแทน')
    try:
        job_id = ai_service.enqueue(db,ctx['tenant_id'],'rewrite',requested_by=ctx['id'],
                                    payload={'title':draft['title'],'body':words,'_import_id':import_id,'_draft_id':draft_id})
    except AIError as failure:
        db.rollback()
        require(False,{'disabled':'เปิด AI ช่วยเจ้าหน้าที่ก่อน จึงให้ AI เรียบเรียงได้','not_configured':'เชื่อม AI ก่อน จึงให้ AI เรียบเรียงได้',
                       'quota':'ใช้ AI ครบจำนวนของวันนี้แล้ว'}.get(failure.code,'ส่งให้ AI ไม่สำเร็จ'),409)
    draft['rewrite'] = {'job_id':job_id,'status':'pending','body':'','error':''}
    _store(db,found)
    db.commit()
    return view(db,ctx,found)


def save(db, ctx, import_id, body):
    """Save drafts as articles. Each item is {'draft_id'} and, from the editor, the words the หัวหน้าทีม changed
    (title, category, body, visibility); the rest keep the draft's."""
    items = (body if isinstance(body,dict) else {}).get('items')
    require(isinstance(items,list) and 0<len(items)<=MAX_SECTIONS,'เลือกร่างที่จะบันทึกก่อน')
    begin(db)
    found = _get(db,import_id)
    require(found['ai']!='grouping',NOT_DONE,409)
    saved = []
    for item in items:
        require(isinstance(item,dict),'รายการไม่ถูกต้อง')
        draft = _draft_of(found,item.get('draft_id'))
        if draft['state']=='saved':
            continue
        fields = {k:item.get(k,draft[k]) for k in ('title','category','body','visibility')}
        visibility = schema.visibility(fields)
        title,category,text = schema.article_fields(fields)
        article_id = uid()
        repository.insert(db,article_id,title,category,text,visibility,ctx['name'])
        audit.record(db,ctx['name'],'article.imported',article_id,found['file_name'])
        draft.update(state='saved',article_id=article_id,title=title,category=category,body=text,visibility=visibility)
        saved.append({'draft_id':draft['id'],'article_id':article_id})
    finished = not any(d['state']=='open' for d in found['drafts'])
    if finished:
        db.execute('DELETE FROM knowledge_imports WHERE id=?',(import_id,))
    else:
        _store(db,found)
    db.commit()
    from backend.modules.ai import insights
    insights.forget(ctx['tenant_id'])
    return {'saved':saved,'finished':finished}


def discard(db, ctx, import_id):
    """ทิ้งการนำเข้านี้: the drafts not saved go; articles already saved from it stay."""
    begin(db)
    found = _get(db,import_id)
    if found['ai']=='grouping':
        from backend.modules.ai import repository as ai_repository
        ai_repository.set_job_state(db,found['job_id'],'cancelled','discarded')
    db.execute('DELETE FROM knowledge_imports WHERE id=?',(import_id,))
    audit.record(db,ctx['name'],'article.import_discarded',import_id,found['file_name'])
    db.commit()
    return {'deleted':import_id}
