"""Recycle bin rules: keep what was deleted for a while, put it back, or clear it for good.

Deleting is still deliberate (each module asks first and refuses to orphan anything); the bin is the safety net
for the delete that was meant for something else. Every step - the delete, the restore and the final clearing -
is written to the activity log."""
import datetime as dt
import json
import re

from backend.database import audit, db as D
from backend.modules.trash import model, repository
from backend.utils.dates import iso, now, utc_now
from backend.utils.security import uid
from backend.utils.validation import require

NAME = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')


def capture(db, ctx, kind, entity, title, tables, detail=''):
    """Take the snapshot of a delete. Called by the module that owns the rows, before it removes them."""
    payload = {table:[dict(row) for row in table_rows] for table,table_rows in tables.items()}
    repository.insert(db,uid(),kind,entity,title,detail,json.dumps(payload,ensure_ascii=False),ctx['name'],now())


def clear_expired(db):
    """Anything older than the keeping period is gone for good; the bin is a second chance, not an archive."""
    cutoff = iso(utc_now()-dt.timedelta(days=model.KEEP_DAYS))
    if repository.delete_expired(db,cutoff):
        db.commit()


def list_items(db, ctx):
    clear_expired(db)
    kept = model.KEEP_DAYS
    return [{**item,'label':model.KINDS[item['kind']]['label'],
             'days_left':max(0,kept-(utc_now()-dt.datetime.fromisoformat(item['deleted_at'])).days),
             'can_restore':ctx['role'] in model.KINDS[item['kind']]['roles']}
            for item in repository.list_all(db) if item['kind'] in model.KINDS]


def _item(db, ctx, item_id):
    item = repository.find(db,item_id)
    require(item and item['kind'] in model.KINDS,'ไม่พบรายการในถังขยะ',404)
    require(ctx['role'] in model.KINDS[item['kind']]['roles'],'ไม่มีสิทธิ์จัดการรายการนี้ในถังขยะ',403)
    return item


def restore(db, ctx, item_id):
    """Write the snapshot back. Rows that would now clash (an id already taken, a conversation that belongs to
    another case) are left out, and a case whose customer is gone is refused rather than restored broken."""
    item = _item(db,ctx,item_id)
    payload = json.loads(item['payload'])
    _check_links(db,item['kind'],payload)
    D.begin(db)
    for table in model.KINDS[item['kind']]['tables']:
        for row in payload.get(table,[]):
            if _restorable_row(db,table,row):
                columns = [name for name in row if NAME.fullmatch(name)]
                db.execute(f"INSERT INTO {table}({','.join(columns)}) VALUES({','.join('?'*len(columns))})",
                           tuple(row[name] for name in columns))
    repository.delete(db,item_id)
    audit.record(db,ctx['name'],f"{item['kind']}.restored",item['entity'],item['title'])
    if item['kind']=='ticket':
        from backend.realtime import events as realtime
        realtime.ticket(db,item['entity'],public=True,conversations_listed=True)
    db.commit()
    return item


def purge(db, ctx, item_id):
    """Clear one item for good, on purpose."""
    item = _item(db,ctx,item_id)
    repository.delete(db,item_id)
    audit.record(db,ctx['name'],f"{item['kind']}.purged",item['entity'],item['title'])
    db.commit()
    return item


def _check_links(db, kind, payload):
    if kind=='ticket':
        ticket = (payload.get('tickets') or [{}])[0]
        require(repository.row_exists(db,'contacts',ticket.get('contact_id')),
                'กู้คืนไม่ได้: ข้อมูลลูกค้าของเคสนี้ถูกลบไปแล้ว กรุณากู้คืนข้อมูลลูกค้าก่อน',400)
        require(repository.row_exists(db,'teams',ticket.get('team_id')),
                'กู้คืนไม่ได้: ทีมที่ดูแลเคสนี้ไม่มีอยู่แล้ว',400)


def _restorable_row(db, table, row):
    if table=='ticket_conversations':
        return repository.conversation_free(db,row.get('conversation_id'))
    if table=='contact_names':
        return not repository.row_exists(db,table,row.get('contact_id'),'contact_id')
    return not repository.row_exists(db,table,row.get('id'))
