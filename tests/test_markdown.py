"""The Markdown the server renders for outgoing mail (backend/utils/markdown.py) must answer like the one the pages
render with (frontend/src/features/rich/markdown-core.ts): the same marks, the same allowlist, and every piece of the
writer's own text escaped so a reply can carry no markup into the reader's mail client."""
import unittest

from backend.extensions import channel_transport as T
from backend.utils import markdown

BASE = 'https://support.example.com'


class MarkdownTests(unittest.TestCase):
    def html(self, text):
        return markdown.to_html(text, BASE)

    def test_the_marks_the_composer_writes(self):
        self.assertEqual(self.html('**หนา**'), '<p><strong>หนา</strong></p>')
        self.assertEqual(self.html('*เอียง*'), '<p><em>เอียง</em></p>')
        self.assertEqual(self.html('__ขีดเส้นใต้__'), '<p><u>ขีดเส้นใต้</u></p>')
        self.assertEqual(self.html('***ทั้งคู่***'), '<p><strong><em>ทั้งคู่</em></strong></p>')
        self.assertEqual(self.html('`code`'), '<p><code>code</code></p>')
        self.assertEqual(self.html('# หัวเรื่อง'), '<h3>หัวเรื่อง</h3>')
        self.assertEqual(self.html('## หัวย่อย'), '<h4>หัวย่อย</h4>')

    def test_lists_however_the_bullet_is_typed(self):
        for bullet in ('-', '*', '•'):
            self.assertEqual(self.html(f'{bullet} หนึ่ง\n{bullet} สอง'), '<ul><li>หนึ่ง</li><li>สอง</li></ul>')
        self.assertEqual(self.html('1. หนึ่ง\n2. สอง'), '<ol><li>หนึ่ง</li><li>สอง</li></ol>')
        # A bullet list and a numbered list next to each other stay two lists.
        self.assertEqual(self.html('- ก\n1. ข'), '<ul><li>ก</li></ul><ol><li>ข</li></ol>')

    def test_only_addresses_a_reader_can_trust_become_links(self):
        self.assertEqual(self.html('[ดูเคส](https://example.com/a)'), '<p><a href="https://example.com/a">ดูเคส</a></p>')
        # Anything that is not http(s), or carries credentials, stays the text the writer typed.
        for bad in ('[x](javascript:alert(1))', '[x](data:text/html,hi)', '[x](https://user:pw@example.com)'):
            self.assertEqual(self.html(bad), f'<p>{markdown.esc(bad)}</p>', bad)
        # An image may only come over https.
        self.assertIn('<img', self.html('![ภาพ](https://example.com/a.png)'))
        self.assertNotIn('<img', self.html('![ภาพ](http://example.com/a.png)'))

    def test_the_writers_own_text_never_becomes_markup(self):
        out = self.html('<script>alert("x")</script> & \'quoted\'')
        for fragment in ('<script', 'alert("x")', "'quoted'"):
            self.assertNotIn(fragment, out)
        self.assertIn('&lt;script&gt;', out)
        self.assertIn('&amp;', out)
        self.assertIn('&#39;', out)
        # A link's address and label are escaped as well.
        self.assertNotIn('"><b>', self.html('[a"><b>](https://example.com/"><b>)'))

    def test_a_code_block_keeps_its_lines(self):
        self.assertEqual(self.html('```\nline 1\nline 2\n```'), '<pre><code>line 1\nline 2</code></pre>')

    def test_empty_and_odd_input_never_raises(self):
        for value in ('', None, '   ', '\n\n', '**', '[](', 123):
            self.assertIsInstance(markdown.to_html(value, BASE), str)


class ReplyMailTests(unittest.TestCase):
    """What actually leaves the server: both forms of the message in one email."""

    def test_a_reply_carries_the_words_twice_and_the_frame_once(self):
        mail = T.build_email({'address': 'team@example.com'}, 'someone@example.com', 'เรื่องทดสอบ',
                             'สวัสดีค่ะ **ทีมงาน** รับเรื่องแล้ว\n\n- ข้อหนึ่ง\n- ข้อสอง',
                             '<id@example.com>', '', [], brand='องค์กรทดสอบ', base=BASE)
        self.assertEqual(mail.get_content_type(), 'multipart/alternative')
        plain = mail.get_body(preferencelist=('plain',)).get_content()
        rich = mail.get_body(preferencelist=('html',)).get_content()
        # The plain part is the message as written, so a text-only reader loses nothing.
        self.assertIn('**ทีมงาน**', plain)
        # The HTML part shows the marks, names the organization, and says how to answer.
        self.assertIn('<strong>ทีมงาน</strong>', rich)
        self.assertIn('>ข้อหนึ่ง</li>', rich)
        self.assertIn('องค์กรทดสอบ', rich)
        self.assertIn(T.REPLY_NOTE, rich)
        self.assertIn(T.REPLY_TITLE, rich)
        self.assertEqual(mail['Subject'], 'Re: เรื่องทดสอบ')

    def test_without_an_organization_name_there_is_no_empty_heading(self):
        mail = T.build_email({'address': 'team@example.com'}, 'someone@example.com', 'Re: x', 'ข้อความ',
                             '<id@example.com>', '', [])
        rich = mail.get_body(preferencelist=('html',)).get_content()
        self.assertNotIn(T.REPLY_TITLE, rich)
        self.assertNotIn(T.REPLY_KICKER, rich)
        self.assertIn('ข้อความ', rich)


if __name__ == '__main__':
    unittest.main()
