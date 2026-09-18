"""How the team uses the knowledge base (backend/modules/knowledge): uses, helpful marks, each member's own pins,
and the version an article had before each change."""
import unittest

import test_app as base

ARTICLES = '/api/articles'


class KnowledgeActivityTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok
    create_member = base.IntegrationTests.create_member

    def article(self, title='ลืมรหัสผ่าน'):
        return self.ok(self.admin,ARTICLES,{'title':title,'category':'บัญชี','body':'กด “ลืมรหัสผ่าน” ที่หน้าเข้าสู่ระบบ'})['id']

    def row(self, client, article):
        return next(a for a in self.ok(client,ARTICLES)['articles'] if a['id']==article)

    def test_uses_marks_and_pins(self):
        agent,_ = self.create_member()
        first,second = self.article(),self.article('เปลี่ยนอีเมล')
        # A repeated use within a few minutes counts once; another kind or another member counts again.
        self.ok(agent,f'{ARTICLES}/{first}/use',{'kind':'copy'})
        self.ok(agent,f'{ARTICLES}/{first}/use',{'kind':'copy'})
        self.ok(agent,f'{ARTICLES}/{first}/use',{'kind':'insert'})
        used = self.ok(self.admin,f'{ARTICLES}/{first}/use',{'kind':'link'})
        self.assertEqual(used['uses'],3);self.assertTrue(used['used_at'])
        # Marks: one per member, changed or taken back; everyone sees the totals, each their own mark.
        self.ok(agent,f'{ARTICLES}/{first}/vote',{'vote':-1})
        self.ok(agent,f'{ARTICLES}/{first}/vote',{'vote':1})
        self.ok(self.admin,f'{ARTICLES}/{first}/vote',{'vote':-1})
        mine = self.row(agent,first)
        self.assertEqual((mine['helpful'],mine['unhelpful'],mine['my_vote']),(1,1,1))
        self.assertEqual(self.row(self.admin,first)['my_vote'],-1)
        self.assertEqual(self.ok(self.admin,f'{ARTICLES}/{first}/vote',{'vote':0})['unhelpful'],0)
        # Pins are the member's own, in their order.
        self.assertEqual(self.ok(agent,f'{ARTICLES}/pins',{'ids':[second,first]})['pins'],[second,first])
        self.assertEqual((self.row(agent,second)['pin_order'],self.row(agent,first)['pin_order']),(1,2))
        self.assertEqual(self.row(self.admin,second)['pin_order'],0)
        self.ok(agent,f'{ARTICLES}/pins',{'ids':[first]})
        self.assertEqual((self.row(agent,second)['pin_order'],self.row(agent,first)['pin_order']),(0,1))
        # What may be sent.
        for path,body in ((f'{ARTICLES}/{first}/use',{'kind':'print'}),(f'{ARTICLES}/{first}/vote',{'vote':2}),
                          (f'{ARTICLES}/{first}/vote',{'vote':True}),(f'{ARTICLES}/pins',{'ids':[first,first]}),
                          (f'{ARTICLES}/pins',{'ids':'x'}),(f'{ARTICLES}/pins',{'ids':['../x']})):
            self.assertEqual(agent.call(path,body)[0],400,(path,body))
        self.assertEqual(agent.call(f'{ARTICLES}/{"0"*32}/use',{'kind':'copy'})[0],404)
        self.assertEqual(agent.call(f'{ARTICLES}/pins',{'ids':["0"*32]})[0],404)

    def test_earlier_versions(self):
        agent,_ = self.create_member()
        article = self.article()
        self.assertEqual(self.row(self.admin,article)['revisions'],0)
        # Saving the same content keeps no version; a change keeps the one before it.
        same = {'title':'ลืมรหัสผ่าน','category':'บัญชี','body':'กด “ลืมรหัสผ่าน” ที่หน้าเข้าสู่ระบบ','visibility':'internal'}
        self.ok(self.admin,f'{ARTICLES}/{article}',same,'PATCH')
        self.ok(self.admin,f'{ARTICLES}/{article}',{**same,'body':'เวอร์ชันสอง'},'PATCH')
        self.ok(self.admin,f'{ARTICLES}/{article}',{**same,'body':'เวอร์ชันสาม','visibility':'public'},'PATCH')
        revisions = self.ok(agent,f'{ARTICLES}/{article}/revisions')['revisions']
        self.assertEqual([r['body'] for r in revisions],['เวอร์ชันสอง','กด “ลืมรหัสผ่าน” ที่หน้าเข้าสู่ระบบ'])
        self.assertEqual(revisions[0]['visibility'],'internal')
        self.assertTrue(revisions[0]['replaced_by'])
        self.assertEqual(self.row(agent,article)['revisions'],2)
        self.assertEqual(agent.call(f'{ARTICLES}/{"0"*32}/revisions')[0],404)


if __name__=='__main__':
    unittest.main()
