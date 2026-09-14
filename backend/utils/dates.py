"""UTC timestamps, stored as ISO-8601 text with second precision (so they sort and compare as strings)."""
import datetime as dt


def utc_now():
    return dt.datetime.now(dt.timezone.utc)


def iso(moment):
    return moment.isoformat(timespec='seconds')


def now():
    return iso(utc_now())


def after(**delta):
    """Timestamp relative to now, e.g. after(hours=12) or after(seconds=-120) for "two minutes ago"."""
    return iso(utc_now()+dt.timedelta(**delta))


def today():
    return utc_now().date().isoformat()
