"""HTTP handlers of ผลงานของฉัน (req.db, req.ctx): always the signed-in member's own - there is no way to ask for
somebody else's, an owner's request included."""
from backend.modules.achievements import badges, recap
from backend.utils.validation import require


def enabled(cd, tenant_id):
    """ผลงานของฉัน is a feature the platform admin gives one organization at a time (platform/model.py FEATURES)."""
    from backend.modules.platform import service as platform
    return platform.feature_state(cd,tenant_id)['achievements']


def _offered(req):
    require(enabled(req.cd,req.ctx['tenant_id']),'องค์กรนี้ยังไม่ได้เปิดใช้ผลงานของฉัน',404)


def overview(req):
    """ตั้งค่าบัญชี → ผลงานของฉัน: every badge, and the months whose summary can be opened."""
    _offered(req)
    return req.send(200,{'badges':badges.view(req.db,req.ctx['tenant_id'],req.ctx['id']),
                         'months':[{'month':m,'label':recap.label(m)} for m in recap.open_months()],
                         'last_month':recap.last_month()})


def month(req):
    _offered(req)
    return req.send(200,recap.recap(req.db,req.ctx,recap.month_arg(req.query)))


def recap_seen(req):
    _offered(req)
    return req.send(200,recap.mark_seen(req.db,req.ctx,req.body))


def badges_seen(req):
    _offered(req)
    keys = req.body.get('keys')
    require(isinstance(keys,list) and len(keys)<=len(badges.BADGES) and all(k in badges.BY_KEY for k in keys),'ข้อมูลเหรียญไม่ถูกต้อง')
    badges.mark_seen(req.db,req.ctx['id'],keys)
    req.db.commit()
    return req.send(200,{'ok':True})
