"""Browser-only mail capture. Never enabled by the production application."""
import json
import os
from pathlib import Path
import sys
import tempfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app
import registration_service as RS


def capture_mail(cfg,secret,recipient,mail):
    (RS.D.DATA.parent/'verification-mail.json').write_text(json.dumps({'recipient':recipient,'body':mail.get_content()}))
    return str(mail['Message-ID'])


if __name__=='__main__':
    data=Path(os.environ.get('BOOKDOSE_DATA','')).resolve()
    if not data.is_relative_to(Path(tempfile.gettempdir()).resolve()) or not data.parent.name.startswith('bookdose-browser-'):
        raise SystemExit('Only run this fixture with a temporary browser-test directory')
    RS.T.send_email=capture_mail
    app.main()
