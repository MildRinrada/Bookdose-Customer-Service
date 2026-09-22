"""How much of the shared disk an organization is using, and whether it may store more.

Every organization's attachments live in data/files/<tenant>/ and its database is one file beside the others, all on
the same disk. A disk that fills up stops *every* organization from writing, so each one has a ceiling of its own
(tenants.quota_mb, set by a platform admin; 0 means none). The platform-wide "less than 10% of the disk left"
warning stays as the last line of defence - by then it is already too late, which is what these ceilings are for.

Measuring is done from the database (SUM of the attachment sizes) rather than by walking the folder: it is asked on
every upload, and walking thousands of files each time would be felt. The console, which is opened by a person and
wants the truth about the disk, walks the folder instead (health.org_usage).

Only a new upload is refused when the ceiling is reached. Reading, answering, and everything already stored keep
working: an organization that has run out of room must still be able to serve its customers."""
from backend.database import db as D
from backend.exceptions.errors import APIError
from backend.modules.platform import model


def _file_bytes(path):
    try:
        return path.stat().st_size
    except OSError:
        return 0


def used_bytes(db, tenant_id):
    """What this organization takes on the disk: its attachments and its own database file."""
    attachments = db.execute('SELECT COALESCE(SUM(size),0) FROM attachments').fetchone()[0] or 0
    return int(attachments)+_file_bytes(D.tenant_path(tenant_id))


def quota_bytes(quota_mb):
    return int(quota_mb)*1024*1024 if quota_mb else 0


def state(db, tenant_id, quota_mb):
    """{'used','quota','share','warn','full'} for one organization. quota 0 (no ceiling) gives share 0."""
    used = used_bytes(db,tenant_id)
    quota = quota_bytes(quota_mb)
    share = used/quota if quota else 0.0
    return {'used':used,'quota':quota,'share':round(share,4),
            'warn':bool(quota) and share>=model.QUOTA_WARN,'full':bool(quota) and share>=model.QUOTA_FULL}


def _readable(size):
    if size >= 1024**3:
        return f'{size/1024**3:.1f} GB'
    return f'{size/1024**2:.0f} MB'


def check_room(db, tenant_id, incoming_bytes):
    """Refuse an upload that would take the organization past its ceiling; does nothing when it has none.

    The check is deliberately on what is about to be written, not on what is already there: an organization sitting
    exactly on its ceiling is told before the file is saved, not after.

    The ceiling lives in the control database, and this is called from every channel a message can arrive by (the
    staff pages, the customer's page, guests, and the LINE / Email / Facebook workers), not all of which hold a
    control connection. It opens its own for the one read; a read never blocks another connection (WAL)."""
    from backend.modules.platform import repository
    with D.control() as cd:
        org = repository.find_tenant_quota(cd,tenant_id)
    quota = quota_bytes(org['quota_mb'] if org else 0)
    if not quota:
        return
    used = used_bytes(db,tenant_id)
    if used+incoming_bytes <= quota:
        return
    raise APIError(507,model.QUOTA_MESSAGE.format(used=_readable(used),quota=_readable(quota)))
