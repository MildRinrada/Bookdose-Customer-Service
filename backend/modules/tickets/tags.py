"""ป้ายเคส: words the organization chooses for what a case is about (สินค้าชำรุด, ส่งช้า, ขอคืนสินค้า), put on its cases by
the team and by routing rules, so the report can say which problems came most this month.

The category (หมวดเรื่อง) is what the customer picked before writing; a tag is what the team found the case to be, and
one case can be about more than one thing. The list is the organization's own (ตั้งค่าองค์กร → ป้ายเคส, owners only):
a fixed list rather than words typed freely, because "ส่งช้า", "ส่งของช้า" and "จัดส่งล่าช้า" counted apart would
answer the question wrongly. Each tag keeps its id, so a renamed tag keeps its cases; a tag taken off the list comes
off its cases (and out of the rules) with it, after the settings page has said how many cases carry it.

Staff only: the customer never sees a case's tags."""
import json
import re

from backend.database import audit
from backend.utils.dates import now
from backend.utils.security import uid
from backend.utils.validation import require

KEY = 'case_tags'
MAX_TAGS = 50
NAME_MAX = 40
PER_CASE = 10
ID = re.compile(r'[a-f0-9]{32}')

TABLE = '''
CREATE TABLE IF NOT EXISTS ticket_tags (
    ticket_id TEXT NOT NULL, tag_id TEXT NOT NULL, added_at TEXT NOT NULL, added_by TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(ticket_id,tag_id)
);
CREATE INDEX IF NOT EXISTS ticket_tags_tag ON ticket_tags(tag_id);
'''

# The ids of a case's tags, comma separated, for the case list (repository.list_with_contacts).
IDS_COLUMN = '(SELECT GROUP_CONCAT(g.tag_id) FROM ticket_tags g WHERE g.ticket_id=t.id) AS tag_ids'


def catalog(db):
    """[{'id','name'}] in the order the owner put them."""
    row = db.execute('SELECT value FROM settings WHERE key=?',(KEY,)).fetchone()
    try:
        value = json.loads(row[0]) if row and row[0] else []
    except ValueError:
        value = []
    return [t for t in value if isinstance(t,dict) and isinstance(t.get('id'),str) and isinstance(t.get('name'),str)] if isinstance(value,list) else []


def known_ids(db):
    return {t['id'] for t in catalog(db)}


def split_ids(text):
    """The list column's "a,b" as ['a','b']."""
    return [part for part in (text or '').split(',') if part]


def form(body):
    """The owner's list: [{'id','name'}], names 1-40 letters and unique (ignoring case). A row without an id is new."""
    items = body.get('tags')
    require(isinstance(items,list) and len(items)<=MAX_TAGS,f'ตั้งป้ายได้ไม่เกิน {MAX_TAGS} ป้าย')
    found,names = [],set()
    for item in items:
        require(isinstance(item,dict),'ข้อมูลป้ายไม่ถูกต้อง')
        name = item.get('name','')
        require(isinstance(name,str),'ชื่อป้ายไม่ถูกต้อง')
        name = ' '.join(name.split())
        require(1<=len(name)<=NAME_MAX,f'ชื่อป้ายต้องมี 1-{NAME_MAX} ตัวอักษร')
        require(name.lower() not in names,f'มีป้าย “{name}” ซ้ำกัน')
        names.add(name.lower())
        given = item.get('id')
        found.append({'id':given if isinstance(given,str) and ID.fullmatch(given) else uid(),'name':name})
    require(len({t['id'] for t in found})==len(found),'ข้อมูลป้ายไม่ถูกต้อง')
    return found


def counts(db):
    """{tag id: cases carrying it} (the settings page, before a tag is taken off the list)."""
    return dict(db.execute('SELECT tag_id,COUNT(*) FROM ticket_tags WHERE ticket_id IN (SELECT id FROM tickets) GROUP BY tag_id').fetchall())


def overview(db):
    return {'tags':catalog(db),'counts':counts(db),'max':MAX_TAGS,'per_case':PER_CASE}


def save(db, ctx, body):
    """Replace the list. Tags taken off it come off every case and out of every routing rule."""
    tags = form(body)
    before = catalog(db)
    kept = {t['id'] for t in tags}
    gone = [t for t in before if t['id'] not in kept]
    db.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(KEY,json.dumps(tags,ensure_ascii=False)))
    if gone:
        marks = ','.join('?'*len(gone))
        db.execute(f'DELETE FROM ticket_tags WHERE tag_id IN ({marks})',[t['id'] for t in gone])
        from backend.modules.automation import repository as automation
        automation.drop_rule_tags(db,{t['id'] for t in gone})
    names = {t['id']:t['name'] for t in before}
    renamed = [f"{names[t['id']]} → {t['name']}" for t in tags if t['id'] in names and names[t['id']]!=t['name']]
    added = [t['name'] for t in tags if t['id'] not in names]
    changes = [*(f'เพิ่ม {n}' for n in added),*(f'เปลี่ยนชื่อ {r}' for r in renamed),*(f"ลบ {t['name']}" for t in gone)]
    audit.record(db,ctx['name'],'settings.updated',ctx['tenant_id'],'ป้ายเคส'+(f" ({', '.join(changes)})" if changes else ''))
    db.commit()
    return overview(db)


def of_ticket(db, ticket_id):
    """The case's tag ids, in the list's order (tags no longer on the list are left out)."""
    order = {t['id']:i for i,t in enumerate(catalog(db))}
    have = [r[0] for r in db.execute('SELECT tag_id FROM ticket_tags WHERE ticket_id=?',(ticket_id,))]
    return sorted((t for t in have if t in order),key=order.get)


def tag_form(db, body):
    """The tag ids a member picked for a case: each on the list, each once, at most PER_CASE."""
    value = body.get('tags')
    require(isinstance(value,list) and all(isinstance(v,str) for v in value),'ข้อมูลป้ายไม่ถูกต้อง')
    picked = list(dict.fromkeys(value))
    require(len(picked)<=PER_CASE,f'ติดป้ายได้ไม่เกิน {PER_CASE} ป้ายต่อเคส')
    require(set(picked)<=known_ids(db),'ป้ายบางอันถูกลบไปแล้ว กรุณาโหลดหน้าใหม่')
    return picked


def set_for_ticket(db, ctx, ticket_id, body):
    """POST /api/tickets/<id>/tags {tags}: the case carries exactly these. Anyone who may see the case may tag it."""
    from backend.middleware.access import get_scoped
    from backend.realtime import events as realtime
    ticket = get_scoped(db,'tickets',ticket_id,ctx)
    picked = tag_form(db,body)
    have = of_ticket(db,ticket['id'])
    added,removed = [t for t in picked if t not in have],[t for t in have if t not in picked]
    if added or removed:
        if removed:
            db.execute(f"DELETE FROM ticket_tags WHERE ticket_id=? AND tag_id IN ({','.join('?'*len(removed))})",[ticket['id'],*removed])
        for tag_id in added:
            db.execute('INSERT OR IGNORE INTO ticket_tags VALUES(?,?,?,?)',(ticket['id'],tag_id,now(),ctx['name']))
        names = {t['id']:t['name'] for t in catalog(db)}
        audit.record(db,ctx['name'],'ticket.tagged',ticket['id'],json.dumps(
            {'added':[names[t] for t in added],'removed':[names[t] for t in removed]},ensure_ascii=False))
        realtime.ticket(db,ticket['id'],public=False,teams=(ticket['team_id'],))
    db.commit()
    return of_ticket(db,ticket['id'])


def add(db, ticket_id, tag_ids, by):
    """Put tags on a case (a routing rule), inside the caller's transaction: only ones still on the list, and never past
    PER_CASE. Returns the ids added."""
    known = known_ids(db)
    have = set(of_ticket(db,ticket_id))
    added = []
    for tag_id in tag_ids:
        if tag_id in known and tag_id not in have and len(have)+len(added)<PER_CASE:
            db.execute('INSERT OR IGNORE INTO ticket_tags VALUES(?,?,?,?)',(ticket_id,tag_id,now(),by))
            added.append(tag_id)
    return added


def names_of(db, tag_ids):
    names = {t['id']:t['name'] for t in catalog(db)}
    return [names[t] for t in tag_ids if t in names]
