"""HTTP handler of ค้นหาด่วน (req.db, req.ctx): GET /api/search?q=<words>."""
from backend.modules.search import service


def search(req):
    return req.send(200,service.search(req.db,req.ctx,(req.query.get('q') or [''])[0]),headers={'Cache-Control':'no-store'})
