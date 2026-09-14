"""Real HTTP/UI workers with fake provider transports, disposable data only."""
from email.message import EmailMessage
import os
from pathlib import Path
import sys
import time
from urllib.parse import parse_qs,urlsplit,urlencode
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app
from backend.extensions import channel_transport as T, openai_client
from backend.modules.channels import email_oauth as O
from ai_fixture_server import fake_provider

def fetch(cfg,secret,checkpoint):
    messages=[]
    if checkpoint['last_uid']<5:
        mail=EmailMessage();mail['From']='Browser Customer <customer@example.net>'
        mail['To']=cfg['address'];mail['Subject']='Email browser test';mail['Message-ID']='<browser-input@example.net>'
        mail.set_content('ช่วยตรวจสอบรายงานทางอีเมล')
        messages=[(5,mail.as_bytes())]
    return {'uidvalidity':'100','uidnext':6,'reset':False,'messages':messages}

if __name__=='__main__':
    if 'bookdose-browser-channels-' not in os.environ.get('BOOKDOSE_DATA',''):
        raise SystemExit('Temporary browser-test data directory required')
    O.token_request=lambda provider,data:{'access_token':'browser-access','refresh_token':'browser-refresh','expires_at':time.time()+3600}
    original_start=O.start
    def fake_authorization(db,ctx,origin):
        query=parse_qs(urlsplit(original_start(db,ctx,origin)['url']).query)
        return {'url':'/oauth/email/callback?'+urlencode({'state':query['state'][0],'code':'browser-code'})}
    O.start=fake_authorization
    openai_client.call_provider=fake_provider
    T.verify_line=lambda secret:{'identity':'U'+'a'*32,'display_name':'Browser OA'}
    T.verify_email=lambda cfg,secret:{'uidvalidity':'100','uidnext':5}
    T.fetch_email=fetch
    T.send_line=lambda *args:'mock-line-accepted'
    T.send_email=lambda cfg,secret,recipient,mail:str(mail['Message-ID'])
    app.main()
