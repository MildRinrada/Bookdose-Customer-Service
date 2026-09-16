"""Text messages (SMS) to a phone number, for the follow links of guest web chat. There is no SMS vendor yet: the
platform chooses a provider in its setting 'sms' ({"provider": ...}):
  off  nothing can be sent (the default; the page hides the SMS option)
  log  for testing: the text is written to the server log instead of being sent
A real vendor is added here as one more provider; callers only use ready() and send(). Nothing here runs inside a
database transaction."""
import json

from backend.exceptions.errors import ChannelError

PROVIDERS = ('off','log')


def config(cd):
    """{'provider'} from the platform setting (control database); 'off' when unset or unreadable."""
    from backend.modules.platform import repository as platform
    try:
        saved = json.loads(platform.setting(cd,'sms') or '{}')
    except ValueError:
        saved = {}
    provider = saved.get('provider') if isinstance(saved,dict) else None
    return {'provider':provider if provider in PROVIDERS else 'off'}


def ready(cd):
    return config(cd)['provider']!='off'


def _log(line):
    print(line,flush=True)


def send(cd, phone, text):
    """Send `text` to `phone` (E.164, e.g. +66812345678). Raises ChannelError('disabled') while the provider is off."""
    provider = config(cd)['provider']
    if provider=='log':
        _log(f'[SMS test] to {phone}: {text}')
        return
    raise ChannelError('disabled')
