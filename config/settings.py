"""Application settings from environment variables, optionally set in a `.env` file at the project root.
Real environment variables always win over `.env`, so hosts such as Render keep full control."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_env_file(path=ROOT/'.env'):
    """Read KEY=VALUE lines (blank lines and # comments are skipped; quotes around a value are removed)."""
    if not path.is_file():
        return
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = (part.strip() for part in line.split('=', 1))
        if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
            value = value[1:-1]
        os.environ.setdefault(key, value)


load_env_file()

# Where databases, attachments and secrets are stored. Defaults to data/ next to app.py.
DATA_DIR = Path(os.environ.get('BOOKDOSE_DATA', ROOT/'data')).resolve()
# Defaults for the command-line options of app.py (--host, --port, --secure-cookies).
HOST = os.environ.get('BOOKDOSE_HOST', '127.0.0.1')
PORT = int(os.environ.get('BOOKDOSE_PORT', '8787'))
SECURE_COOKIES = os.environ.get('BOOKDOSE_SECURE_COOKIES', '').lower() in ('1', 'true', 'yes')


# Read on every call (not at import) so a changed environment takes effect without a restart of the importer.
def setup_token():
    """Secret required to create the platform owner on first run; empty means not required (local use)."""
    return os.environ.get('BOOKDOSE_SETUP_TOKEN', '')


def proxy_secret():
    """Shared with the Next.js web app (frontend/), which forwards /api/* here. Empty means only a web app on this
    machine is believed about the browser's host and address; set it when the web app runs on another host."""
    return os.environ.get('BOOKDOSE_PROXY_SECRET', '')


def on_render():
    """True on Render, where first-run setup is refused without a strong setup token."""
    return os.environ.get('RENDER') == 'true'
