"""คลังบทความแม่แบบ: the platform team writes the answers every organization needs anyway, an organization takes a
copy, and from that moment the copy is the organization's own."""
import unittest

import test_app as base


class ArticleTemplateTests(unittest.TestCase):
    def a_template(self, title='เวลาทำการ', published=True):
        made = self.ok(self.owner,'/api/platform/templates',
                       {'title':title,'category':'ทั่วไป','body':'เปิดทำการ จันทร์ถึงศุกร์ 9:00 ถึง 18:00'})['id']
        if published:
            self.ok(self.owner,f'/api/platform/templates/{made}/publish',{'published':True})
        return made

    def test_only_published_templates_reach_organizations(self):
        hidden = self.a_template('ยังไม่เผยแพร่',published=False)
        shown = self.a_template()
        offered = {t['id'] for t in self.ok(self.admin,'/api/article-templates')['templates']}
        self.assertIn(shown,offered)
        self.assertNotIn(hidden,offered)
        # Taking one that is not published is refused, not quietly allowed.
        self.assertEqual(self.admin.call(f'/api/article-templates/{hidden}/use',{'visibility':'public'})[0],404)

    def test_taking_a_copy_makes_it_the_organizations_own(self):
        template = self.a_template()
        made = self.ok(self.admin,f'/api/article-templates/{template}/use',{'visibility':'public'})['id']
        article = next(a for a in self.ok(self.admin,'/api/articles')['articles'] if a['id']==made)
        self.assertEqual(article['title'],'เวลาทำการ')
        self.assertEqual(article['visibility'],'public')
        # It is edited like anything the organization wrote itself.
        self.ok(self.admin,f'/api/articles/{made}',{'title':'เวลาทำการของเรา','category':'ทั่วไป',
                                                    'body':'เปิดทุกวัน 8:00 ถึง 20:00','visibility':'public'},'PATCH')
        self.assertEqual(next(a for a in self.ok(self.admin,'/api/articles')['articles'] if a['id']==made)['title'],'เวลาทำการของเรา')
        # And the library remembers it was taken.
        self.assertTrue(next(t for t in self.ok(self.admin,'/api/article-templates')['templates'] if t['id']==template)['taken'])

    def test_the_platform_changing_a_template_never_rewrites_a_copy(self):
        template = self.a_template()
        made = self.ok(self.admin,f'/api/article-templates/{template}/use',{'visibility':'public'})['id']
        self.ok(self.owner,f'/api/platform/templates/{template}',
                {'title':'เวลาทำการ (ใหม่)','category':'ทั่วไป','body':'ข้อความใหม่ของแพลตฟอร์ม'},'PATCH')
        kept = next(a for a in self.ok(self.admin,'/api/articles')['articles'] if a['id']==made)
        self.assertEqual(kept['title'],'เวลาทำการ')

    def test_deleting_a_template_leaves_the_copies_alone(self):
        template = self.a_template()
        made = self.ok(self.admin,f'/api/article-templates/{template}/use',{'visibility':'public'})['id']
        self.ok(self.owner,f'/api/platform/templates/{template}',None,'DELETE')
        self.assertTrue(any(a['id']==made for a in self.ok(self.admin,'/api/articles')['articles']))

    def test_who_may_do_what(self):
        template = self.a_template()
        # An organization's owner never writes the library.
        self.assertEqual(self.admin.call('/api/platform/templates',{'title':'x','category':'y','body':'z'})[0],403)
        # An agent may look at the articles but not take a copy: taking one creates an article.
        agent,_ = self.create_member()
        self.assertEqual(agent.call(f'/api/article-templates/{template}/use',{'visibility':'public'})[0],403)

    def test_refused_templates(self):
        for bad in ({'title':'','category':'ทั่วไป','body':'x'},{'title':'x','category':'','body':'y'},
                    {'title':'x','category':'y','body':''},{}):
            self.assertEqual(self.owner.call('/api/platform/templates',bad)[0],400,bad)


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(ArticleTemplateTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
