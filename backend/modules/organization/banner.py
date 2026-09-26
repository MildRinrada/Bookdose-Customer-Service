"""แบนเนอร์หน้าช่วยเหลือ: the band across the top of the organization's own support pages (/support/<org>: its chat,
FAQ and a case), so a customer sees at once whom they are writing to. The logo and the name are the organization's
own (ข้อมูลองค์กร); here only what the banner adds: a short line under the name, and its colour from a set every
one of which keeps the words readable, in the light and the dark themes alike (the stylesheet has both). Public,
like the name; changed by the organization's admins (ตั้งค่า → ข้อมูลองค์กร)."""
import json

from backend.database import audit
from backend.utils.validation import require

KEY = 'support_banner'
TAGLINE_MAX = 80
TONES = ('stone','mint','sky','sand','rose','forest','navy','charcoal')
# The names the settings page gives them (frontend guest/components/OrgBanner BANNER_TONES), for the history.
TONE_NAMES = {'stone':'เทาอ่อน','mint':'เขียวอ่อน','sky':'ฟ้าอ่อน','sand':'ครีม','rose':'ชมพูอ่อน',
              'forest':'เขียวเข้ม','navy':'น้ำเงินเข้ม','charcoal':'ดำ'}
DEFAULT = {'tagline':'','tone':'stone'}


def config(db):
    row = db.execute('SELECT value FROM settings WHERE key=?',(KEY,)).fetchone()
    try:
        value = json.loads(row[0]) if row and row[0] else None
    except ValueError:
        value = None
    found = {**DEFAULT,**value} if isinstance(value,dict) else dict(DEFAULT)
    return found if found['tone'] in TONES else {**found,'tone':DEFAULT['tone']}


def form(body):
    tagline = body.get('tagline','')
    require(isinstance(tagline,str),'ข้อความใต้ชื่อไม่ถูกต้อง')
    # One line under the name: a line break would only be squashed into a space on the page.
    tagline = ' '.join(tagline.split())
    require(len(tagline)<=TAGLINE_MAX,f'ข้อความใต้ชื่อยาวได้ไม่เกิน {TAGLINE_MAX} ตัวอักษร')
    tone = body.get('tone')
    require(tone in TONES,'เลือกสีแบนเนอร์จากชุดสีที่มีให้')
    return {'tagline':tagline,'tone':tone}


def save(db, ctx, body):
    value = form(body)
    db.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(KEY,json.dumps(value,ensure_ascii=False)))
    audit.record(db,ctx['name'],'settings.updated',ctx['tenant_id'],
                 f"แบนเนอร์หน้าช่วยเหลือ (สี{TONE_NAMES[value['tone']]}{' · ' + value['tagline'] if value['tagline'] else ''})")
    db.commit()
    return value
