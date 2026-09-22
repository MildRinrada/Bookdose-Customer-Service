"""เริ่มต้นใช้งาน on the owner's overview: the four things a new organization has to do before the system does
anything for it, and what is broken now (a channel whose replies do not go out).

A new organization that cannot work out what to set up simply stops using the system, so the order here is the order
that gets it working, and the last step is the one that proves it:

  1. เชื่อมช่องทาง     a way in besides the web chat
  2. เพิ่มทีม          somebody other than the owner to answer
  3. เขียน FAQ 5 บทความ enough for a customer to find an answer alone, and for the bot to have something to answer from
  4. ทดลองแชท         send one message as a customer and watch it arrive - the proof the whole loop works

A step can be partly done (the articles), and says so, because "2 จาก 5" is a reason to carry on and "ยังไม่เสร็จ" is
not. Rules and AI come after: they make a working organization better, they do not make it work, and putting them in
the same list made the list look longer than the job. The card goes away once the four are done and nothing is broken.
"""
from backend.modules.organization import repository as organization

ARTICLE_TARGET = 5


def _step(key, done, title, detail, label, href, count=None, target=None):
    step = {'key':key,'done':bool(done),'title':title,'detail':detail,'action':{'label':label,'href':href}}
    if target:
        step['count'],step['target'] = int(count or 0),int(target)
    return step


def _problem(channel):
    name = channel['name']
    if channel['status']=='error':
        failed = channel['failed']
        title = f'{name} ส่งข้อความไม่สำเร็จ {failed} ข้อความ' if failed else f'{name} เชื่อมต่อไม่สำเร็จ'
        return {'key':f"channel-{channel['kind']}",'level':'critical','title':title,
                'detail':channel['error'] or channel['last_failure'] or 'ตรวจการเชื่อมต่อแล้วลองส่งใหม่',
                'action':{'label':'ตรวจการเชื่อมต่อ','href':'/settings?tab=connections'}}
    detail = (f"ข้อความรอส่งนานเกิน 15 นาที ({channel['waiting']} ข้อความ)" if channel['stuck']
              else f"ไม่แน่ใจว่า {channel['unknown']} ข้อความส่งถึงลูกค้าหรือไม่")
    return {'key':f"channel-{channel['kind']}",'level':'warning','title':f'{name} ส่งข้อความล่าช้า','detail':detail,
            'action':{'label':'ตรวจการเชื่อมต่อ','href':'/settings?tab=connections'}}


def checklist(cd, db, ctx):
    from backend.modules.ai import service as ai
    from backend.modules.automation import repository as automation
    from backend.modules.platform import health
    channels = health.tenant_channels(db)
    members = [m for m in organization.tenant_members(cd,ctx['tenant_id']) if m['active']]
    public = db.execute("SELECT COUNT(*) FROM knowledge_articles WHERE visibility='public'").fetchone()[0]
    # One conversation of any kind is the proof: a message came in, reached the team and can be answered.
    talked = db.execute('SELECT COUNT(*) FROM conversations').fetchone()[0]
    steps = [
        _step('channels',any(c['enabled'] for c in channels),'เชื่อมช่องทางที่ลูกค้าติดต่อเข้ามา',
              'ตอนนี้ลูกค้าติดต่อได้ทางแชทบนเว็บเท่านั้น เชื่อม LINE อีเมล หรือ Facebook เพิ่มได้',
              'เชื่อมช่องทาง','/settings?tab=connections'),
        _step('agents',any(m['role']=='agent' for m in members),'เพิ่มทีมและเจ้าหน้าที่',
              'ยังไม่มีเจ้าหน้าที่ เรื่องจากลูกค้าทั้งหมดจึงรอเจ้าขององค์กรคนเดียว','เพิ่มสมาชิก','/members'),
        _step('articles',public>=ARTICLE_TARGET,f'เขียนคำถามที่พบบ่อย {ARTICLE_TARGET} บทความ',
              'ลูกค้าหาคำตอบเองได้โดยไม่ต้องรอทีม และบอต AI ตอบจากบทความสาธารณะเหล่านี้',
              'เขียนบทความ','/knowledge',count=public,target=ARTICLE_TARGET),
        _step('chat',talked,'ทดลองแชทเป็นลูกค้าหนึ่งครั้ง',
              'เปิดหน้าลูกค้าขององค์กร ส่งข้อความเข้ามาหนึ่งข้อความ แล้วดูว่าเข้ากล่องข้อความจริง จะได้รู้ว่าทุกอย่างต่อกันครบ',
              'เปิดหน้าลูกค้า','/settings?tab=profile'),
    ]
    # Worth doing, but an organization works without them: they are shown apart so the list of four stays a list of four.
    later = [
        _step('rules',automation.enabled_rule_count(db),'ตั้งกฎส่งต่อเรื่อง',
              'ส่งเรื่องให้ทีมหรือคนที่ถูกต้องเองตามช่องทางและคำในข้อความ','ตั้งกฎ','/automation'),
        _step('ai',ai.has_key(ctx['tenant_id']),'เปิด AI ช่วยตอบ',
              'ร่างคำตอบจากคลังความรู้ และให้บอตตอบคำถามทั่วไปแทนทีม','ตั้งค่า AI','/settings?tab=ai'),
    ]
    problems = [_problem(c) for c in channels if c['status']!='ok']
    return {'steps':steps,'later':later,'problems':problems}
