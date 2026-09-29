"""ช่องข้อมูลเพิ่มเติมของเคส: what an organization needs to know about each case beyond its subject and status - an
order number, the product's model, the branch - as fields of its own (ตั้งค่าองค์กร → ภาพรวมและบริการ → ช่องข้อมูลของเคส,
owners only). The team fills them in on the case screen (or confirms what the AI assistant proposes); the customer
never sees them.

Each field has a kind, so what is typed can be checked and later filtered and counted:
  text      one line, up to TEXT_MAX letters
  number    a number, kept as written without thousands separators ("1200", "12.5")
  date      YYYY-MM-DD
  select    one of the owner's options (the report can split cases by it)
  checkbox  ticked ("1") or not (no value)

A field may be asked of the customer when they start a web chat (แบบฟอร์มตามหมวดเรื่อง: `customer`, for every
category or only the ones in `categories`): what they type is kept on the chat (conversation_field_values) and becomes
the case's value when a case opens from it; the team sees it on the chat before that. Never required of the customer:
a form that cannot be sent is a customer who gives up.

A field may be required before the case is closed (resolved or closed): a member closing it - from the case screen,
the case list, a macro or the assistant - is told which fields are still empty. Closes that nobody could fill anything
for first (the customer closing their own case, ปิดเคสเมื่อลูกค้าเงียบ) are not stopped. A required checkbox must be
ticked.

The list lives in the organization's settings (case_fields, JSON, in the owner's order) and reaches the staff app with
the workspace; the values are rows of ticket_field_values. A field keeps its id, so a renamed field keeps its values;
its kind never changes (a number that becomes a date would be read wrongly), so a different kind is a new field. A
field taken off the list takes its values with it, after the settings page has said how many cases have one."""
import datetime as dt
import json
import re

from backend.database import audit
from backend.utils.dates import now
from backend.utils.security import uid
from backend.utils.validation import require

KEY = 'case_fields'
KINDS = ('text','number','date','select','checkbox')
DONE = ('resolved','closed')
MAX_FIELDS = 20
NAME_MAX = 40
OPTIONS_MAX = 30
OPTION_MAX = 60
TEXT_MAX = 200
NUMBER_MAX = 10**12
ID = re.compile(r'[a-f0-9]{32}')
CONTROL = re.compile(r'[\x00-\x1f\x7f]')
NUMBER = re.compile(r'-?\d+(\.\d+)?')
DAY = re.compile(r'\d{4}-\d{2}-\d{2}')

TABLE = '''
CREATE TABLE IF NOT EXISTS ticket_field_values (
    ticket_id TEXT NOT NULL, field_id TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT '', PRIMARY KEY(ticket_id,field_id)
);
CREATE INDEX IF NOT EXISTS ticket_field_values_field ON ticket_field_values(field_id);
CREATE TABLE IF NOT EXISTS conversation_field_values (
    conversation_id TEXT NOT NULL, field_id TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(conversation_id,field_id)
);
'''
CATEGORIES_MAX = 30

# A case's values as {field id: value} (JSON), for the case list (repository.list_with_contacts) and the assistant.
VALUES_COLUMN = "(SELECT json_group_object(v.field_id,v.value) FROM ticket_field_values v WHERE v.ticket_id=t.id) AS field_values"


def catalog(db):
    """[{'id','name','kind','options','required','ask'}] in the order the owner put them."""
    row = db.execute('SELECT value FROM settings WHERE key=?',(KEY,)).fetchone()
    try:
        value = json.loads(row[0]) if row and row[0] else []
    except ValueError:
        value = []
    if not isinstance(value,list):
        return []
    return [f for f in value if isinstance(f,dict) and isinstance(f.get('id'),str) and isinstance(f.get('name'),str) and f.get('kind') in KINDS]


def parse_values(text, fields):
    """The list column's JSON as {field id: value}, only fields still on the list."""
    try:
        found = json.loads(text) if text else {}
    except ValueError:
        return {}
    known = {f['id'] for f in fields}
    return {k:v for k,v in found.items() if k in known and isinstance(v,str) and v} if isinstance(found,dict) else {}


def _line(value, label, limit):
    require(isinstance(value,str),f'{label}ไม่ถูกต้อง')
    value = ' '.join(value.split())
    require(len(value)<=limit and not CONTROL.search(value),f'{label}ต้องเป็นข้อความบรรทัดเดียว ไม่เกิน {limit} ตัวอักษร')
    return value


def form(body, before):
    """The owner's list: names unique (ignoring case), a known kind that never changes for a field already there, and for a
    choice 1-30 distinct options. A row without a known id is new."""
    items = body.get('fields')
    require(isinstance(items,list) and len(items)<=MAX_FIELDS,f'ตั้งช่องข้อมูลได้ไม่เกิน {MAX_FIELDS} ช่อง')
    kinds = {f['id']:f['kind'] for f in before}
    found,names = [],set()
    for item in items:
        require(isinstance(item,dict),'ข้อมูลช่องไม่ถูกต้อง')
        name = _line(item.get('name',''),'ชื่อช่อง',NAME_MAX)
        require(name,'ตั้งชื่อช่องก่อน')
        require(name.lower() not in names,f'มีช่อง “{name}” ซ้ำกัน')
        names.add(name.lower())
        given = item.get('id')
        field_id = given if isinstance(given,str) and given in kinds else uid()
        kind = item.get('kind')
        require(kind in KINDS,f'ชนิดของช่อง “{name}” ไม่ถูกต้อง')
        require(kinds.get(field_id,kind)==kind,f'เปลี่ยนชนิดของช่อง “{name}” ไม่ได้ ถ้าต้องการชนิดอื่น ให้สร้างช่องใหม่')
        options = []
        if kind=='select':
            raw = item.get('options')
            require(isinstance(raw,list),f'ใส่ตัวเลือกของช่อง “{name}”')
            options = list(dict.fromkeys(o for o in (_line(o,'ตัวเลือก',OPTION_MAX) for o in raw) if o))
            require(1<=len(options)<=OPTIONS_MAX,f'ช่อง “{name}” ต้องมีตัวเลือก 1-{OPTIONS_MAX} ข้อ')
        required = item.get('required',False)
        require(type(required) is bool,'การบังคับกรอกต้องเป็นใช่หรือไม่')
        # ให้ Chatbot ถามลูกค้า: asked for while the customer waits after the chatbot hands over (ai/gather.py).
        ask = item.get('ask',False)
        require(type(ask) is bool,'การให้ Chatbot ถามต้องเป็นใช่หรือไม่')
        # ให้ลูกค้ากรอกตอนเริ่มแชท: on the start form, for these categories only (none: every category).
        customer = item.get('customer',False)
        require(type(customer) is bool,'การให้ลูกค้ากรอกต้องเป็นใช่หรือไม่')
        raw = item.get('categories',[]) if customer else []
        require(isinstance(raw,list) and len(raw)<=CATEGORIES_MAX,'หมวดเรื่องของช่องไม่ถูกต้อง')
        categories = list(dict.fromkeys(c for c in (_line(c,'หมวดเรื่อง',OPTION_MAX) for c in raw) if c))
        found.append({'id':field_id,'name':name,'kind':kind,'options':options,'required':required,'ask':ask,
                      'customer':customer,'categories':categories})
    require(len({f['id'] for f in found})==len(found),'ข้อมูลช่องไม่ถูกต้อง')
    return found


def counts(db):
    """{field id: cases with a value} (the settings page, before a field is taken off the list)."""
    return dict(db.execute('SELECT field_id,COUNT(*) FROM ticket_field_values WHERE ticket_id IN (SELECT id FROM tickets) GROUP BY field_id').fetchall())


def overview(db):
    # The categories customers pick from, for a field asked only in some of them.
    from backend.modules.customers import service as customers
    return {'fields':catalog(db),'counts':counts(db),'max':MAX_FIELDS,'categories':[c['name'] for c in customers.categories(db)]}


def save(db, ctx, body):
    """Replace the list. Fields taken off it take their values with them."""
    before = catalog(db)
    fields = form(body,before)
    kept = {f['id'] for f in fields}
    gone = [f for f in before if f['id'] not in kept]
    db.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(KEY,json.dumps(fields,ensure_ascii=False)))
    if gone:
        db.execute(f"DELETE FROM ticket_field_values WHERE field_id IN ({','.join('?'*len(gone))})",[f['id'] for f in gone])
    names = {f['id']:f['name'] for f in before}
    changes = [*(f"เพิ่ม {f['name']}" for f in fields if f['id'] not in names),
               *(f"เปลี่ยนชื่อ {names[f['id']]} → {f['name']}" for f in fields if f['id'] in names and names[f['id']]!=f['name']),
               *(f"ลบ {f['name']}" for f in gone)]
    audit.record(db,ctx['name'],'settings.updated',ctx['tenant_id'],'ช่องข้อมูลของเคส'+(f" ({', '.join(changes)})" if changes else ''))
    db.commit()
    return overview(db)


def value_of(field, raw):
    """What a field keeps for what was sent ('' = no value), or an APIError that says what is wrong."""
    name = field['name']
    if raw is None or raw=='' or raw is False:
        return ''
    kind = field['kind']
    if kind=='checkbox':
        ticked,clear = (True,'1','true','yes','ใช่'),('0','false','no','ไม่ใช่')
        require(isinstance(raw,(bool,str)) and (raw in ticked or raw in clear),f'ช่อง “{name}” ต้องเป็นติ๊กหรือไม่ติ๊ก')
        return '1' if raw in ticked else ''
    if kind=='number':
        text = str(raw).replace(',','').strip() if isinstance(raw,(int,float,str)) and not isinstance(raw,bool) else ''
        require(NUMBER.fullmatch(text) and abs(float(text))<NUMBER_MAX,f'ช่อง “{name}” ต้องเป็นตัวเลข')
        return text
    require(isinstance(raw,str),f'ช่อง “{name}” ไม่ถูกต้อง')
    if kind=='date':
        text = raw.strip()
        try:
            ok = bool(DAY.fullmatch(text)) and bool(dt.date.fromisoformat(text))
        except ValueError:
            ok = False
        require(ok,f'ช่อง “{name}” ต้องเป็นวันที่')
        return text
    text = _line(raw,f'ช่อง “{name}” ',TEXT_MAX if kind=='text' else OPTION_MAX)
    if kind=='select':
        require(not text or text in field['options'],f'ช่อง “{name}” ต้องเลือกจากตัวเลือกที่ตั้งไว้')
    return text


def display(field, value):
    """A value in words, for the activity log: ticked is ใช่, nothing is -."""
    if not value:
        return '-'
    return 'ใช่' if field['kind']=='checkbox' else value


def values_of(db, ticket_id):
    """{field id: value} of the case, fields still on the list only."""
    known = {f['id'] for f in catalog(db)}
    return {r[0]:r[1] for r in db.execute('SELECT field_id,value FROM ticket_field_values WHERE ticket_id=?',(ticket_id,)) if r[0] in known}


def missing(db, ticket_id):
    """The names of the required fields the case has no value in, in the list's order."""
    have = values_of(db,ticket_id)
    return [f['name'] for f in catalog(db) if f['required'] and not have.get(f['id'])]


def require_to_close(db, ticket, status):
    """A member closing a case that is open: every required field has a value, or the member is told which do not."""
    if status in DONE and ticket['status'] not in DONE:
        empty = missing(db,ticket['id'])
        require(not empty,f"กรอก {', '.join(empty)} ก่อนปิดเคส")


def values_form(db, body):
    """{field id: value} the member sent, each checked against its field."""
    sent = body.get('values')
    require(isinstance(sent,dict) and sent,'ไม่มีข้อมูลที่จะบันทึก')
    fields = {f['id']:f for f in catalog(db)}
    require(set(sent)<=set(fields),'บางช่องถูกลบไปแล้ว กรุณาโหลดหน้าใหม่')
    return {field_id:value_of(fields[field_id],raw) for field_id,raw in sent.items()}


def customer_fields(db, category=None):
    """The fields the start form asks for (all categories' with `category` None), as the form needs them."""
    return [{'id':f['id'],'name':f['name'],'kind':f['kind'],'options':f['options'],'categories':f.get('categories') or []}
            for f in catalog(db) if f.get('customer') and (category is None or not f.get('categories') or category in f['categories'])]


def customer_values(db, category, sent):
    """{field id: value} of what the customer filled in on the start form, each checked against its field; a field not
    on the form for this category is refused, an empty one left out."""
    if sent in (None,{}):
        return {}
    require(isinstance(sent,dict) and len(sent)<=MAX_FIELDS,'ข้อมูลในแบบฟอร์มไม่ถูกต้อง')
    asked = {f['id']:f for f in catalog(db) if f['id'] in {c['id'] for c in customer_fields(db,category)}}
    require(set(sent)<=set(asked),'แบบฟอร์มเปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่')
    found = {field_id:value_of(asked[field_id],raw) for field_id,raw in sent.items()}
    return {k:v for k,v in found.items() if v}


def keep_for_conversation(db, conversation_id, values):
    db.executemany('INSERT OR REPLACE INTO conversation_field_values VALUES(?,?,?,?)',
                   [(conversation_id,field_id,value,now()) for field_id,value in values.items()])


def of_conversation(db, conversation_id):
    """What the customer filled in on the start form, for the team: [{'field','name','value'}] in the list's order."""
    have = {r[0]:r[1] for r in db.execute('SELECT field_id,value FROM conversation_field_values WHERE conversation_id=?',(conversation_id,))}
    return [{'field':f['id'],'name':f['name'],'value':display(f,have[f['id']])} for f in catalog(db) if have.get(f['id'])]


def copy_to_ticket(db, conversation_id, ticket_id):
    """A case opened from the chat takes what the customer filled in, into the fields it has no value in yet."""
    known = {f['id'] for f in catalog(db)}
    have = values_of(db,ticket_id)
    for field_id,value in db.execute('SELECT field_id,value FROM conversation_field_values WHERE conversation_id=?',(conversation_id,)).fetchall():
        if field_id in known and not have.get(field_id):
            db.execute('INSERT OR IGNORE INTO ticket_field_values VALUES(?,?,?,?,?)',(ticket_id,field_id,value,now(),'ลูกค้า'))


def set_for_ticket(db, ctx, ticket_id, body):
    """POST /api/tickets/<id>/fields {values: {field id: value}}: those fields take these values ('' clears one); the
    others stay. Anyone who may see the case may fill them. A closed case keeps its required fields filled."""
    from backend.middleware.access import get_scoped
    from backend.realtime import events as realtime
    ticket = get_scoped(db,'tickets',ticket_id,ctx)
    values = values_form(db,body)
    fields = {f['id']:f for f in catalog(db)}
    have = values_of(db,ticket['id'])
    changed = {k:v for k,v in values.items() if have.get(k,'')!=v}
    if ticket['status'] in DONE:
        emptied = [fields[k]['name'] for k,v in changed.items() if not v and fields[k]['required']]
        require(not emptied,f"เคสนี้ปิดแล้ว {', '.join(emptied)} ต้องมีข้อมูล")
    if changed:
        for field_id,value in changed.items():
            if value:
                db.execute('''INSERT INTO ticket_field_values VALUES(?,?,?,?,?) ON CONFLICT(ticket_id,field_id) DO UPDATE SET
                              value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by''',
                           (ticket['id'],field_id,value,now(),ctx['name']))
            else:
                db.execute('DELETE FROM ticket_field_values WHERE ticket_id=? AND field_id=?',(ticket['id'],field_id))
        audit.record(db,ctx['name'],'ticket.fields',ticket['id'],json.dumps(
            [{'field':fields[k]['name'],'before':display(fields[k],have.get(k,'')),'after':display(fields[k],v)} for k,v in changed.items()],ensure_ascii=False))
        realtime.ticket(db,ticket['id'],public=False,teams=(ticket['team_id'],))
    db.commit()
    return values_of(db,ticket['id'])
