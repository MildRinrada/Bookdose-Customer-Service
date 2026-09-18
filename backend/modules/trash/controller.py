"""HTTP handlers for the recycle bin."""
from backend.middleware.auth import require_role
from backend.modules.trash import model, service

STAFF_ONLY = 'เฉพาะเจ้าขององค์กรเปิดถังขยะได้'


@require_role('admin','manager',message=STAFF_ONLY)
def list_items(req):
    return req.send(200,{'items':service.list_items(req.db,req.ctx),'keep_days':model.KEEP_DAYS})


@require_role('admin','manager',message=STAFF_ONLY)
def restore_item(req, item_id):
    item = service.restore(req.db,req.ctx,item_id)
    return req.send(200,{'restored':item['entity'],'kind':item['kind']})


@require_role('admin','manager',message=STAFF_ONLY)
def purge_item(req, item_id):
    service.purge(req.db,req.ctx,item_id)
    return req.send(200,{'purged':item_id})
