"""HTTP handlers of ผลงานของฉัน (req.db, req.ctx): always the signed-in member's own - there is no way to ask for
somebody else's, an owner's request included."""
from backend.modules.achievements import badges, recap
from backend.utils.validation import require


def overview(req):
    """ตั้งค่าบัญชี → ผลงานของฉัน: every badge, and the months whose summary can be opened."""
    return req.send(200,{'badges':badges.view(req.db,req.ctx['tenant_id'],req.ctx['id']),
                         'months':[{'month':m,'label':recap.label(m)} for m in recap.open_months()],
                         'last_month':recap.last_month()})


def month(req):
    return req.send(200,recap.recap(req.db,req.ctx,recap.month_arg(req.query)))


def recap_seen(req):
    return req.send(200,recap.mark_seen(req.db,req.ctx,req.body))


def badges_seen(req):
    keys = req.body.get('keys')
    require(isinstance(keys,list) and len(keys)<=len(badges.BADGES) and all(k in badges.BY_KEY for k in keys),'ข้อมูลเหรียญไม่ถูกต้อง')
    badges.mark_seen(req.db,req.ctx['id'],keys)
    req.db.commit()
    return req.send(200,{'ok':True})
