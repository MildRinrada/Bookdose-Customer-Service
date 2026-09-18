"""The overview's board (model.py): handover notes for the whole organization and each member's own to-dos."""
from backend.database.db import begin
from backend.exceptions.errors import APIError
from backend.modules.board import repository, schema
from backend.modules.board.model import DONE_HOURS, HANDOVER_DAYS, HANDOVER_SHOWN, OPEN_TODOS_MAX
from backend.utils.dates import after
from backend.utils.security import uid
from backend.utils.validation import require


def view(db, ctx):
    notes = repository.handover(db,after(days=-HANDOVER_DAYS),HANDOVER_SHOWN)
    # Anyone removes their own note; the organization's owners tidy the board.
    for note in notes:
        note['mine'] = note.pop('user_id')==ctx['id']
        note['removable'] = note['mine'] or ctx['role']=='admin'
    return {'handover':notes,'todos':repository.todos(db,ctx['id'],after(hours=-DONE_HOURS)),'handover_days':HANDOVER_DAYS}


def add(db, ctx, body):
    kind,text,due = schema.note_form(body)
    begin(db)
    if kind=='todo':
        require(repository.open_todo_count(db,ctx['id'])<OPEN_TODOS_MAX,f'มีงานที่ยังไม่เสร็จครบ {OPEN_TODOS_MAX} รายการแล้ว ติ๊กงานที่เสร็จก่อน')
    repository.insert(db,uid(),kind,ctx['id'],ctx['name'],text,due)
    return view(db,ctx)


def _own_todo(db, ctx, note_id):
    note = repository.find(db,note_id)
    # Someone else's to-do does not exist for this member.
    if not note or note['kind']!='todo' or note['user_id']!=ctx['id']:
        raise APIError(404,'ไม่พบรายการ')
    return note


def set_done(db, ctx, note_id, body):
    done = schema.done_form(body)
    begin(db)
    _own_todo(db,ctx,note_id)
    repository.set_done(db,note_id,done)
    return view(db,ctx)


def remove(db, ctx, note_id):
    begin(db)
    note = repository.find(db,note_id)
    if not note:
        raise APIError(404,'ไม่พบรายการ')
    if note['kind']=='todo':
        _own_todo(db,ctx,note_id)
    else:
        require(note['user_id']==ctx['id'] or ctx['role']=='admin','ลบได้เฉพาะโน้ตของคุณเอง',403)
    repository.delete(db,note_id)
    return view(db,ctx)
