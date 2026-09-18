"""ตั้งค่าองค์กรให้ครบ on the owner's overview: the steps that make the organization work (a channel besides web chat,
agents, public articles, a routing rule, AI) and what is broken now (a channel whose replies do not go out). Each
leads to where it is fixed; the card goes away once every step is done and nothing is broken."""
from backend.modules.organization import repository as organization


def _step(key, done, title, detail, label, href):
    return {'key':key,'done':bool(done),'title':title,'detail':detail,'action':{'label':label,'href':href}}


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
    steps = [
        _step('channels',any(c['enabled'] for c in channels),'เชื่อม LINE อีเมล หรือ Facebook',
              'ตอนนี้ลูกค้าติดต่อได้ทางแชทบนเว็บเท่านั้น','เชื่อมช่องทาง','/settings?tab=connections'),
        _step('agents',any(m['role']=='agent' for m in members),'เพิ่มเจ้าหน้าที่ที่ตอบลูกค้า',
              'ยังไม่มีเจ้าหน้าที่ เรื่องจากลูกค้าทั้งหมดรอเจ้าขององค์กร','เชิญเจ้าหน้าที่','/settings?tab=teams'),
        _step('articles',public,'เผยแพร่บทความให้ลูกค้า',
              'ลูกค้าหาคำตอบเองได้ในคำถามที่พบบ่อย และบอต AI ตอบจากบทความสาธารณะ','เขียนบทความ','/knowledge'),
        _step('rules',automation.enabled_rule_count(db),'ตั้งกฎส่งต่อเรื่อง',
              'ส่งเรื่องให้ทีมหรือคนที่ถูกต้องเองตามช่องทางและคำในข้อความ','ตั้งกฎ','/automation'),
        _step('ai',ai.has_key(ctx['tenant_id']),'เปิด AI ช่วยตอบ',
              'ร่างคำตอบจากคลังความรู้ และให้บอตตอบคำถามทั่วไปแทนทีม','ตั้งค่า AI','/settings?tab=ai'),
    ]
    problems = [_problem(c) for c in channels if c['status']!='ok']
    return {'steps':steps,'problems':problems}
