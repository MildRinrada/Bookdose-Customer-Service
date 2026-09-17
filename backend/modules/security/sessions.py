"""Session limits (idle + absolute) and the platform security settings they come from.

A session is valid while now < created_at + absolute and now < last_active_at + idle. last_active_at moves only with
real use: any non-GET request, or the activity endpoints the pages call at most once a minute while someone is using
them. Polling GETs and realtime sockets never move it. Staff sessions of a platform admin use the 'platform' limits."""
import copy
import datetime as dt
import json

from backend.exceptions.errors import APIError
from backend.modules.security import model
from backend.modules.security.events import parse
from backend.utils.dates import iso, utc_now

SETTINGS_KEY = 'security'


def settings(cd):
    """The saved settings over the defaults (a value missing or of the wrong type keeps its default)."""
    from backend.modules.platform import repository as platform
    merged = copy.deepcopy(model.DEFAULT_SETTINGS)
    try:
        saved = json.loads(platform.setting(cd,SETTINGS_KEY) or '{}')
    except ValueError:
        saved = {}
    for group,values in merged.items():
        stored = saved.get(group) if isinstance(saved,dict) else None
        if not isinstance(stored,dict):
            continue
        if group=='honeypot':
            _merge_honeypot(values,stored)
            continue
        for name,value in values.items():
            if isinstance(value,dict):
                inner = stored.get(name)
                if isinstance(inner,dict):
                    for field,default in value.items():
                        if type(inner.get(field)) is int:
                            value[field] = inner[field]
            elif type(stored.get(name)) is int:
                values[name] = stored[name]
    return merged


def _merge_honeypot(values, stored):
    """The saved honeypot settings over the defaults, value by value (a value of the wrong type keeps its default)."""
    for name in ('paths_enabled','forms_enabled'):
        if type(stored.get(name)) is bool:
            values[name] = stored[name]
    paths = stored.get('custom_api_paths')
    if isinstance(paths,list):
        values['custom_api_paths'] = [{'path':p['path'],'match':p['match']} for p in paths
                                      if isinstance(p,dict) and isinstance(p.get('path'),str) and p.get('match') in ('exact','prefix')]
    for group in ('block_on_path_hits','block_on_honeytoken'):
        inner = stored.get(group)
        if not isinstance(inner,dict):
            continue
        for field,default in values[group].items():
            if type(inner.get(field)) is type(default) and (field!='duration' or inner[field] in model.BLOCK_DURATIONS):
                values[group][field] = inner[field]


def save(cd, values):
    from backend.modules.platform import repository as platform
    platform.save_setting(cd,SETTINGS_KEY,json.dumps(values))


def seconds_of(values, actor):
    """(idle seconds, absolute seconds) of one actor ('staff', 'platform', 'customer') in a settings dict."""
    limits = values['sessions'][actor]
    if actor=='customer':
        return limits['idle_days']*86400,limits['absolute_days']*86400
    return limits['idle_minutes']*60,limits['absolute_hours']*3600


def limits(cd, actor):
    return seconds_of(settings(cd),actor)


def _ends(created_at, last_active_at, seconds, expires_at):
    """(idle end, absolute end) as datetimes. The absolute end is also capped by the expires_at written when the
    session was made, so a lifetime raised later in the settings never lengthens a session already running."""
    idle,absolute = seconds
    created = parse(created_at) or utc_now()
    active = parse(last_active_at) or created
    end = created+dt.timedelta(seconds=absolute)
    cap = parse(expires_at)
    return active+dt.timedelta(seconds=idle),min(end,cap) if cap else end


def expiry(created_at, last_active_at, seconds, expires_at=None):
    """{idle_expires_at, absolute_expires_at} as ISO timestamps."""
    idle_end,absolute_end = _ends(created_at,last_active_at,seconds,expires_at)
    return {'idle_expires_at':iso(min(idle_end,absolute_end)),'absolute_expires_at':iso(absolute_end)}


def expired_reason(created_at, last_active_at, seconds, expires_at=None, moment=None):
    """'absolute', 'idle' or None."""
    moment = moment or utc_now()
    idle_end,absolute_end = _ends(created_at,last_active_at,seconds,expires_at)
    if moment>=absolute_end:
        return 'absolute'
    if moment>=idle_end:
        return 'idle'
    return None


def expired_error(reason):
    return APIError(401,model.EXPIRED_MESSAGE,extra={'reason':reason})


def add_session_columns(cd):
    """The session times, added to existing databases. Rows from before the upgrade count as made and used now, so
    nobody is signed out by it (their old expires_at still ends them no later than before)."""
    from backend.utils.dates import now
    for table,columns in model.SESSION_COLUMNS.items():
        present = {row[1] for row in cd.execute(f'PRAGMA table_info({table})')}
        for column in columns:
            if column not in present:
                cd.execute(f"ALTER TABLE {table} ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
            cd.execute(f"UPDATE {table} SET {column}=? WHERE {column}=''",(now(),))
