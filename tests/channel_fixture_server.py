"""Real HTTP/UI workers with fake provider transports, disposable data only."""
from email.message import EmailMessage
import os
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app
import channel_transport as T

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
    T.verify_line=lambda secret:{'identity':'U'+'a'*32,'display_name':'Browser OA'}
    T.verify_email=lambda cfg,secret:{'uidvalidity':'100','uidnext':5}
    T.fetch_email=fetch
    T.send_line=lambda *args:'mock-line-accepted'
    T.send_email=lambda cfg,secret,recipient,mail:str(mail['Message-ID'])
    app.main()
