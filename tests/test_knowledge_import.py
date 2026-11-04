"""นำเข้าบทความ (knowledge/importer.py, knowledge/document.py): a Word, PDF or text file becomes draft articles, the AI
groups and names them without writing their words, and nothing is an article until the หัวหน้าทีม saves it."""
import base64
import io
import json
import unittest
import zipfile
from unittest.mock import patch

import test_ai as ai_tests
from test_app import D
from backend.extensions import openai_client as OpenAI
from backend.modules.ai import service as AI
from backend.modules.knowledge import document

IMPORTS = '/api/article-imports'
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'


def docx(paragraphs):
    """A Word file: paragraphs are (style or '', xml of the runs) or ('table', [[cell, ...], ...])."""
    body = ''
    for style,content in paragraphs:
        if style=='table':
            body += '<w:tbl>'+''.join('<w:tr>'+''.join(f'<w:tc><w:p><w:r><w:t>{c}</w:t></w:r></w:p></w:tc>' for c in row)+'</w:tr>' for row in content)+'</w:tbl>'
            continue
        props = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style and style!='list' else \
            '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' if style=='list' else ''
        runs = content if content.startswith('<') else f'<w:r><w:t xml:space="preserve">{content}</w:t></w:r>'
        body += f'<w:p>{props}{runs}</w:p>'
    styles = (f'<w:styles {W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>'
              '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>'
              '<w:style w:type="paragraph" w:styleId="MyHead"><w:name w:val="Topic"/><w:basedOn w:val="Heading2"/></w:style></w:styles>')
    numbering = (f'<w:numbering {W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>'
                 '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>')
    rels = ('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId9" Type="hyperlink" Target="https://help.example.com/reset" TargetMode="External"/></Relationships>')
    out = io.BytesIO()
    with zipfile.ZipFile(out,'w') as archive:
        archive.writestr('word/document.xml',f'<w:document {W}><w:body>{body}</w:body></w:document>')
        archive.writestr('word/styles.xml',styles)
        archive.writestr('word/numbering.xml',numbering)
        archive.writestr('word/_rels/document.xml.rels',rels)
    return out.getvalue()


def pdf(lines):
    """A one-page PDF: lines are (font size, text, bold), top to bottom, in the standard Helvetica fonts."""
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
    writer = PdfWriter()
    page = writer.add_blank_page(612,792)
    fonts = DictionaryObject({NameObject(name):DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),
                              NameObject('/BaseFont'):NameObject(base)}) for name,base in (('/F1','/Helvetica'),('/F2','/Helvetica-Bold'))})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'):fonts})
    y,ops = 740,[]
    for size,text,bold in lines:
        ops.append(f'BT /{"F2" if bold else "F1"} {size} Tf 72 {y} Td ({text}) Tj ET')
        y -= size*2
    stream = DecodedStreamObject()
    stream.set_data('\n'.join(ops).encode())
    page[NameObject('/Contents')] = writer._add_object(stream)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def upload(name, data):
    return {'name':name,'data':base64.b64encode(data).decode()}


GUIDE = [('Heading1','คู่มือห้องสมุด'),
         ('Heading2','การสมัครสมาชิก'),('','<w:r><w:t xml:space="preserve">กดปุ่มสมัคร แล้ว</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>กรอก</w:t></w:r>'
              '<w:r><w:rPr><w:b/></w:rPr><w:t>อีเมล</w:t></w:r>'),
         ('Heading2','ลืมรหัสผ่าน'),('','ทำตามขั้นตอนนี้'),('list','กดลืมรหัสผ่าน'),('list','เปิดลิงก์ในอีเมลภายใน 30 นาที'),
         ('','<w:hyperlink r:id="rId9"><w:r><w:t>อ่านเพิ่ม</w:t></w:r></w:hyperlink>'),
         ('MyHead','ค่าบริการ'),('table',[['แบบ','ราคา'],['รายเดือน','99 บาท'],['รายปี','990 บาท']])]


class KnowledgeImportTests(unittest.TestCase):
    setUp = ai_tests.AITests.setUp
    tearDown = ai_tests.AITests.tearDown
    ok = ai_tests.AITests.ok
    enable = ai_tests.AITests.enable
    create_member = ai_tests.AITests.create_member

    def run_job(self, answer):
        """The next AI job, answered with `answer(payload, mode)`."""
        with patch.object(OpenAI,'call_provider',side_effect=lambda key,cfg,payload,mode:(answer(payload,mode),{'input_tokens':1,'output_tokens':1})):
            AI.process_one(self.org)

    def start(self, name, data):
        return self.ok(self.admin,IMPORTS,upload(name,data))

    # Reading files
    def test_a_word_file_becomes_one_draft_per_heading_with_lists_links_and_tables(self):
        found = self.start('คู่มือ.docx',docx(GUIDE))
        self.assertEqual(found['ai']['state'],'off')
        drafts = found['drafts']
        self.assertEqual([d['title'] for d in drafts],['การสมัครสมาชิก','ลืมรหัสผ่าน','ค่าบริการ'])
        # The one heading over the whole document is its title, and the category of what is under it.
        self.assertEqual({d['category'] for d in drafts},{'คู่มือห้องสมุด'})
        self.assertEqual(drafts[0]['body'],'กดปุ่มสมัคร แล้ว**กรอกอีเมล**')
        self.assertEqual(drafts[1]['body'],'ทำตามขั้นตอนนี้\n1. กดลืมรหัสผ่าน\n1. เปิดลิงก์ในอีเมลภายใน 30 นาที\n[อ่านเพิ่ม](https://help.example.com/reset)')
        self.assertEqual(drafts[2]['body'],'**แบบ | ราคา**\n- รายเดือน | 99 บาท\n- รายปี | 990 บาท')
        self.assertTrue(all(d['visibility']=='internal' and d['state']=='open' for d in drafts))
        self.assertEqual(drafts[1]['source'],'ลืมรหัสผ่าน')
        # Nothing is an article yet.
        self.assertFalse({a['title'] for a in self.ok(self.admin,'/api/articles')['articles']} & {d['title'] for d in drafts})

    def test_questions_and_answers_in_a_text_file_are_an_article_each(self):
        text = 'คำถามที่พบบ่อย\n\nถาม: ยืมได้กี่เล่ม\nตอบ: ครั้งละ 3 เล่ม\n\nถาม: อ่านบนมือถือได้ไหม\nตอบ: ได้ ผ่านแอป'
        drafts = self.start('faq.txt',text.encode())['drafts']
        self.assertEqual([(d['title'],d['body'],d['category']) for d in drafts],
                         [('ยืมได้กี่เล่ม','ครั้งละ 3 เล่ม','คำถามที่พบบ่อย'),('อ่านบนมือถือได้ไหม','ได้ ผ่านแอป','คำถามที่พบบ่อย')])

    def test_a_pdf_heading_is_the_larger_print_and_the_page_is_the_source(self):
        drafts = self.start('guide.pdf',pdf([(24,'Library guide',True),(16,'Opening hours',False),(11,'Open 9 to 5 on weekdays.',False),
                                              (16,'Borrowing',False),(11,'Three books for 14 days.',False)]))['drafts']
        self.assertEqual([(d['title'],d['body'],d['source'],d['category']) for d in drafts],
                         [('Opening hours','Open 9 to 5 on weekdays.','หน้า 1','Library guide'),
                          ('Borrowing','Three books for 14 days.','หน้า 1','Library guide')])

    def test_thai_from_a_pdf_is_mended_and_a_lost_mark_is_shown(self):
        self.assertEqual(document.clean('ทํา น ้ํา ได ้'),'ทำ น้ำ ได้')
        self.assertEqual(document.clean('ที\x00'),'ที'+document.UNKNOWN)
        self.assertEqual(document.clean('ก'),'ก้')

    def test_what_cannot_be_read_says_why(self):
        for name,data,words in (('old.doc',b'x','.docx'),('a.exe',b'x','PDF'),('a.pdf',b'not a pdf','อ่านไฟล์นี้ไม่ได้'),
                                ('a.pdf',pdf([]),'ภาพสแกน'),('a.docx',b'PK nothing','อ่านไฟล์นี้ไม่ได้')):
            status,body = self.admin.call(IMPORTS,upload(name,data))
            self.assertEqual(status,400,name)
            self.assertIn(words,body['error'],name)
        agent,_ = self.create_member()
        self.assertEqual(agent.call(IMPORTS,upload('a.txt',b'hello'))[0],403)

    # The AI groups and names, and never writes the words
    def test_the_ai_groups_names_and_finds_the_lost_marks_without_writing_the_words(self):
        self.enable()
        existing = self.ok(self.admin,'/api/articles',{'title':'วิธีสมัครสมาชิก','category':'บัญชี','body':'ขั้นตอนสมัคร','visibility':'public'})['id']
        text = '# คู่มือ\n## เปิดบัญชี\nกดสมัคร\n## ยืนยันอีเมล\nเปิดลิงก์ที�ส่งไป\n## สารบัญ\n1 2 3'
        found = self.start('guide.md',text.encode())
        self.assertEqual(found['ai']['state'],'grouping')
        status,body = self.admin.call(f"{IMPORTS}/{found['id']}/save",{'items':[{'draft_id':'d1'}]})
        self.assertEqual(status,409)
        seen = {}

        def answer(payload, mode):
            seen.update(payload)
            return {'articles':[{'sections':['s1','s2','s1'],'title':'วิธีเปิดบัญชีและยืนยันอีเมล','category':'บัญชี','duplicate':'a1'}],
                    'skip':['s3'],'marks':[{'ref':'m1','marks':['่']}]}
        self.run_job(answer)
        self.assertEqual(seen['marks'],[{'ref':'m1','word':'เปิดลิงก์ที[?]ส่งไป'}])
        self.assertEqual(seen["existing_articles"][:1],[{'ref':'a1','title':'วิธีสมัครสมาชิก','category':'บัญชี'}])
        found = self.ok(self.admin,f"{IMPORTS}/{found['id']}")
        self.assertEqual(found['ai']['state'],'done')
        first,left = found['drafts']
        self.assertEqual(first['title'],'วิธีเปิดบัญชีและยืนยันอีเมล')
        self.assertEqual(first['body'],'# เปิดบัญชี\nกดสมัคร\n# ยืนยันอีเมล\nเปิดลิงก์ที่ส่งไป')
        self.assertEqual(first['duplicate'],{'id':existing,'title':'วิธีสมัครสมาชิก'})
        # What the AI would leave out is still there to see, marked.
        self.assertEqual((left['title'],left['suggest_skip']),('สารบัญ',True))

    def test_an_ai_answer_that_does_not_hold_up_leaves_the_documents_own_cut(self):
        self.enable()
        found = self.start('guide.md','## หนึ่ง\nก\n## สอง\nข'.encode())
        self.run_job(lambda payload,mode:{'articles':[{'sections':['s9'],'title':'x','category':'','duplicate':''}],'skip':[],'marks':[]})
        found = self.ok(self.admin,f"{IMPORTS}/{found['id']}")
        self.assertEqual(found['ai']['state'],'failed')
        self.assertEqual([d['title'] for d in found['drafts']],['หนึ่ง','สอง'])
        # A mark for a lost glyph is one mark, or none.
        from backend.modules.knowledge import importer
        sent = {'sections':[{'ref':'s1'}],'_words':{'m1':'ที�'}}
        checked = importer.validate('import',{'articles':[{'sections':['s1'],'title':'','category':'','duplicate':''}],'skip':[],
                                              'marks':[{'ref':'m1','marks':['่้']}]},sent)
        self.assertEqual(checked['marks'],{})

    def test_not_waiting_for_the_ai(self):
        self.enable()
        found = self.start('guide.md','## หนึ่ง\nก'.encode())
        found = self.ok(self.admin,f"{IMPORTS}/{found['id']}/skip-ai",{})
        self.assertEqual((found['ai']['state'],found['ai']['note']),('off','ไม่รอ AI แบ่งตามหัวข้อในเอกสาร'))
        self.run_job(lambda payload,mode:self.fail('a cancelled job is not sent'))

    # Rewriting on request
    def test_a_rewrite_keeps_every_number_and_link_or_is_refused(self):
        self.enable()
        found = self.start('guide.md','## ยืมหนังสือ\nยืมได้ 3 เล่ม นาน 14 วัน ดูที่ https://lib.example.com'.encode())
        self.ok(self.admin,f"{IMPORTS}/{found['id']}/skip-ai",{})
        path = f"{IMPORTS}/{found['id']}/drafts/d1"
        self.ok(self.admin,path+'/rewrite',{})
        self.run_job(lambda payload,mode:{'body':'ยืมได้ 5 เล่ม นาน 14 วัน ดูที่ https://lib.example.com'})
        draft = self.ok(self.admin,f"{IMPORTS}/{found['id']}")['drafts'][0]
        self.assertEqual((draft['rewrite']['status'],draft['rewrite']['error']),('failed','changed_facts'))
        self.ok(self.admin,path+'/rewrite',{})
        self.run_job(lambda payload,mode:{'body':'1. ยืมได้ครั้งละ 3 เล่ม\n2. นาน 14 วัน\nดูรายละเอียดที่ https://lib.example.com'})
        draft = self.ok(self.admin,f"{IMPORTS}/{found['id']}")['drafts'][0]
        self.assertEqual(draft['rewrite']['status'],'done')
        # The document's words stay until the หัวหน้าทีม chooses the AI's, and can come back.
        self.assertTrue(draft['body'].startswith('ยืมได้ 3 เล่ม'))
        draft = self.ok(self.admin,path,{'action':'use_rewrite'},'PATCH')['drafts'][0]
        self.assertTrue(draft['body'].startswith('1. ยืมได้ครั้งละ'))
        draft = self.ok(self.admin,path,{'action':'use_source'},'PATCH')['drafts'][0]
        self.assertTrue(draft['body'].startswith('ยืมได้ 3 เล่ม'))

    # Saving
    def test_saved_drafts_become_internal_articles_and_the_import_goes_when_none_is_left(self):
        found = self.start('คู่มือ.docx',docx(GUIDE))
        base = f"{IMPORTS}/{found['id']}"
        self.ok(self.admin,base+'/drafts/d3',{'action':'skip'},'PATCH')
        saved = self.ok(self.admin,base+'/save',{'items':[{'draft_id':'d1','title':'วิธีสมัครสมาชิก','visibility':'public'}]})
        self.assertFalse(saved['finished'])
        self.assertEqual(self.ok(self.admin,IMPORTS)['imports'],[{'id':found['id'],'file_name':'คู่มือ.docx','created_at':found['created_at'],'open':1}])
        saved = self.ok(self.admin,base+'/save',{'items':[{'draft_id':'d2'},{'draft_id':'d1'}]})
        self.assertEqual((len(saved['saved']),saved['finished']),(1,True))
        articles = {a['title']:a for a in self.ok(self.admin,'/api/articles')['articles'] if a['category']=='คู่มือห้องสมุด'}
        self.assertEqual({t:(a['visibility'],a['category']) for t,a in articles.items()},
                         {'วิธีสมัครสมาชิก':('public','คู่มือห้องสมุด'),'ลืมรหัสผ่าน':('internal','คู่มือห้องสมุด')})
        self.assertEqual(self.admin.call(base)[0],404)
        self.assertEqual(self.ok(self.admin,IMPORTS)['imports'],[])
        with D.tenant(self.org) as db:
            actions = [r[0] for r in db.execute("SELECT action FROM audit_logs WHERE action LIKE 'article.import%'")]
        self.assertEqual(sorted(actions),['article.import_started','article.imported','article.imported'])

    def test_discarding_keeps_what_was_saved(self):
        found = self.start('คู่มือ.docx',docx(GUIDE))
        base = f"{IMPORTS}/{found['id']}"
        self.ok(self.admin,base+'/save',{'items':[{'draft_id':'d1'}]})
        self.ok(self.admin,base,None,'DELETE')
        self.assertEqual(self.admin.call(base)[0],404)
        self.assertEqual([a['title'] for a in self.ok(self.admin,'/api/articles')['articles'] if a['category']=='คู่มือห้องสมุด'],['การสมัครสมาชิก'])

    def test_an_import_is_forgotten_after_a_week(self):
        found = self.start('a.txt','หัวข้อ\n\nเนื้อหา'.encode())
        with D.tenant(self.org) as db:
            db.execute("UPDATE knowledge_imports SET created_at='2000-01-01T00:00:00+00:00'")
            db.commit()
        self.assertEqual(self.admin.call(f"{IMPORTS}/{found['id']}")[0],404)
        self.assertEqual(self.ok(self.admin,IMPORTS)['imports'],[])
        with D.tenant(self.org) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM knowledge_imports').fetchone()[0],0)


if __name__=='__main__':
    unittest.main()
