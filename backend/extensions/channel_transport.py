"""LINE Messaging API over HTTPS and TLS-only IMAP/SMTP, plus parsing and building email. No credentials in logs."""
import base64
from contextlib import contextmanager
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import formatdate, parseaddr
from html.parser import HTMLParser
import imaplib
import ipaddress
import json
import re
import smtplib
import socket
import ssl
import urllib.error
import urllib.request

from backend.exceptions.errors import ChannelError
from backend.utils.files import matches_file_type
from backend.utils.http import open_without_redirects

MAX_MAIL = 8*1024*1024
MAX_FILES = 5*1024*1024


def line_request(token,path,body=None,retry_key=None,data_host=False,maximum=1_000_000):
    headers={'Authorization':'Bearer '+token}
    if body is not None:headers['Content-Type']='application/json'
    if retry_key:headers['X-Line-Retry-Key']=retry_key
    req=urllib.request.Request(('https://api-data.line.me' if data_host else 'https://api.line.me')+path,
        data=json.dumps(body,ensure_ascii=False).encode() if body is not None else None,headers=headers)
    try:
        with open_without_redirects(req,15) as response:
            content=response.read(maximum+1)
            if len(content)>maximum:raise ChannelError('media')
            return content,response.headers.get('Content-Type',''),response.headers.get('x-line-request-id','')
    except urllib.error.HTTPError as error:
        code=error.code
        accepted=error.headers.get('x-line-accepted-request-id','') if error.headers else ''
        error.close()
        if code==409 and retry_key and accepted:return b'{}','application/json',accepted
        raise ChannelError('credentials' if code in (401,403) else 'temporary' if code>=500 or code==429 else 'rejected',retryable=code>=500 or code==429) from None
    except (OSError,urllib.error.URLError,TimeoutError):
        raise ChannelError('network',retryable=True) from None


def verify_line(secret):
    raw,_,_=line_request(secret['access_token'],'/v2/bot/info')
    try:
        data=json.loads(raw)
        if not re.fullmatch(r'U[a-fA-F0-9]{32}',data.get('userId','')):raise ValueError()
        return {'identity':data['userId'],'display_name':str(data.get('displayName','LINE'))[:100]}
    except (ValueError,TypeError,AttributeError):raise ChannelError('credentials') from None


def send_line(secret,recipient,text,retry_key):
    _,_,provider_id=line_request(secret['access_token'],'/v2/bot/message/push',
        {'to':recipient,'messages':text if isinstance(text,list) else [{'type':'text','text':text}]},retry_key)
    return provider_id


def valid_attachment(name,content):
    """An imported file as {'name','data' (base64)} when its type is allowed and its bytes match; otherwise None."""
    name=re.sub(r'[\\/\x00-\x1f]','_',str(name))[:150]
    extension=name.rsplit('.',1)[-1].lower() if '.' in name else ''
    if not content or len(content)>MAX_FILES or not matches_file_type(extension,content):return None
    return {'name':name,'data':base64.b64encode(content).decode()}


def line_media(secret,message):
    message_id=message.get('id','')
    if not isinstance(message_id,str) or not re.fullmatch(r'[0-9]{1,50}',message_id):raise ChannelError('media')
    content,mime,_=line_request(secret['access_token'],f'/v2/bot/message/{message_id}/content',data_host=True,maximum=MAX_FILES)
    names={'image/png':'image.png','image/jpeg':'image.jpg','image/gif':'image.gif',
           'image/webp':'image.webp','video/mp4':'video.mp4','video/webm':'video.webm'}
    name=message.get('fileName') or names.get(mime.split(';')[0],'attachment.bin')
    result=valid_attachment(name,content)
    if not result:raise ChannelError('media')
    return result


def public_socket(host,port,timeout=12):
    """Resolve once, reject nonpublic addresses, and connect to that exact result."""
    try:
        candidates=socket.getaddrinfo(host,port,type=socket.SOCK_STREAM)
        if not candidates or any(not ipaddress.ip_address(item[4][0]).is_global for item in candidates):
            raise ChannelError('host')
        last=None
        for family,socktype,proto,_,address in candidates:
            sock=socket.socket(family,socktype,proto)
            try:
                sock.settimeout(timeout);sock.connect(address);return sock
            except OSError as error:
                last=error;sock.close()
        raise last or OSError()
    except ChannelError:raise
    except OSError:raise ChannelError('network',retryable=True) from None


class SafeSMTP(smtplib.SMTP):
    def _get_socket(self,host,port,timeout):return public_socket(host,port,timeout)


class SafeSMTPSSL(smtplib.SMTP_SSL):
    def _get_socket(self,host,port,timeout):
        sock=public_socket(host,port,timeout)
        try:return self.context.wrap_socket(sock,server_hostname=host)
        except Exception:sock.close();raise


class SafeIMAP(imaplib.IMAP4_SSL):
    def _create_socket(self,timeout):
        sock=public_socket(self.host,self.port,timeout)
        try:return self.ssl_context.wrap_socket(sock,server_hostname=self.host)
        except Exception:sock.close();raise
    def read(self,size):
        if size>MAX_MAIL:raise ChannelError('size')
        return super().read(size)


@contextmanager
def smtp_session(cfg,secret):
    client=None
    try:
        if cfg['smtp_port']==465:
            client=SafeSMTPSSL(cfg['smtp_host'],465,timeout=12,context=ssl.create_default_context())
        else:
            client=SafeSMTP(cfg['smtp_host'],587,timeout=12)
            client.ehlo();client.starttls(context=ssl.create_default_context());client.ehlo()
        if cfg.get('auth_mode','password')!='password':
            token=secret.get('auth_token')
            if not token:raise ChannelError('oauth_expired')
            value=f"user={cfg['username']}\x01auth=Bearer {token}\x01\x01"
            client.auth('XOAUTH2',lambda challenge=None:value if challenge is None else '')
        else:client.login(cfg['username'],secret['password'])
        yield client
    except smtplib.SMTPAuthenticationError:raise ChannelError('credentials') from None
    except smtplib.SMTPNotSupportedError:raise ChannelError('credentials') from None
    except (OSError,smtplib.SMTPException):raise ChannelError('network',retryable=True) from None
    finally:
        if client:
            try:client.close()
            except OSError:pass


@contextmanager
def imap_session(cfg,secret):
    client=None
    try:
        client=SafeIMAP(cfg['imap_host'],993,ssl_context=ssl.create_default_context(),timeout=12)
        if cfg.get('auth_mode','password')!='password':
            token=secret.get('auth_token')
            if not token:raise ChannelError('oauth_expired')
            value=f"user={cfg['username']}\x01auth=Bearer {token}\x01\x01".encode()
            answers=iter((value,b''))
            client.authenticate('XOAUTH2',lambda challenge:next(answers,b''))
        else:client.login(cfg['username'],secret['password'])
        result,_=client.select('INBOX',readonly=True)
        if result!='OK':raise ChannelError('credentials')
        yield client
    except imaplib.IMAP4.error:raise ChannelError('credentials') from None
    except OSError:raise ChannelError('network',retryable=True) from None
    finally:
        if client:
            try:client.logout()
            except Exception:
                try:client.shutdown()
                except Exception:pass


def mailbox_info(client):
    status,values=client.status('INBOX','(UIDVALIDITY UIDNEXT)')
    raw=b' '.join(v for v in values if isinstance(v,bytes)) if status=='OK' else b''
    validity=re.search(rb'UIDVALIDITY\s+(\d+)',raw)
    next_uid=re.search(rb'UIDNEXT\s+(\d+)',raw)
    if not validity or not next_uid:raise ChannelError('network')
    return {'uidvalidity':validity[1].decode(),'uidnext':int(next_uid[1])}


def verify_email(cfg,secret):
    with smtp_session(cfg,secret):pass
    with imap_session(cfg,secret) as client:return mailbox_info(client)


def fetch_email(cfg,secret,checkpoint):
    with imap_session(cfg,secret) as client:
        info=mailbox_info(client)
        if not checkpoint.get('uidvalidity') or checkpoint['uidvalidity']!=info['uidvalidity']:
            return {**info,'reset':True,'messages':[]}
        last=checkpoint['last_uid']
        status,values=client.uid('search',None,f'UID {last+1}:*')
        if status!='OK':raise ChannelError('network',retryable=True)
        ids=sorted({int(value) for part in values if isinstance(part,bytes) for value in part.split() if value.isdigit() and int(value)>last})[:20]
        records=[]
        for uid in ids:
            status,parts=client.uid('fetch',str(uid),'(RFC822.SIZE)')
            meta=b' '.join(p for p in parts if isinstance(p,bytes)) if status=='OK' else b''
            size=re.search(rb'RFC822.SIZE\s+(\d+)',meta)
            if not size:raise ChannelError('network',retryable=True)
            if int(size[1])>MAX_MAIL:
                records.append((uid,None));continue
            status,parts=client.uid('fetch',str(uid),'(BODY.PEEK[])')
            content=next((part[1] for part in parts if isinstance(part,tuple) and isinstance(part[1],bytes)),None)
            if status!='OK' or content is None:raise ChannelError('network',retryable=True)
            records.append((uid,content if len(content)<=MAX_MAIL else None))
        return {**info,'reset':False,'messages':records}


class PlainHTML(HTMLParser):
    def __init__(self):super().__init__();self.parts=[];self.hidden=0
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style'):self.hidden+=1
        if tag in ('p','div','br','li'):self.parts.append('\n')
    def handle_endtag(self,tag):
        if tag in ('script','style'):self.hidden=max(0,self.hidden-1)
    def handle_data(self,data):
        if not self.hidden:self.parts.append(data)


def email_address(value):
    _,address=parseaddr(str(value))
    if not re.fullmatch(r'[A-Za-z0-9.!#$%&\x27*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',address) or len(address)>254:
        raise ChannelError('ignored')
    return address.lower()


def parse_email(raw,own_address):
    mail=BytesParser(policy=policy.default).parsebytes(raw)
    if len(mail.get_all('From',[]))!=1:raise ChannelError('ignored')
    sender=email_address(mail['From'])
    if sender==own_address.lower() or str(mail.get('Auto-Submitted','no')).lower()!='no' or str(mail.get('Precedence','')).lower() in ('bulk','list','junk') or mail.get_content_type()=='multipart/report':
        raise ChannelError('ignored')
    subject=re.sub(r'[\r\n\x00]',' ',str(mail.get('Subject','(ไม่มีหัวเรื่อง)')))[:300]
    name=parseaddr(str(mail['From']))[0][:100] or sender
    selected=mail.get_body(preferencelist=('plain','html'))
    text=''
    if selected:
        try:text=selected.get_content()
        except (LookupError,UnicodeError):text=selected.get_payload(decode=True).decode('utf-8',errors='replace')
        if selected.get_content_type()=='text/html':
            parser=PlainHTML();parser.feed(text);text=''.join(parser.parts)
    attachments=[];skipped=0;total=0
    for part in mail.iter_attachments():
        content=part.get_payload(decode=True) or b''
        file=valid_attachment(part.get_filename() or 'attachment.bin',content)
        if file and len(attachments)<3 and total+len(content)<=MAX_FILES:
            attachments.append(file);total+=len(content)
        else:skipped+=1
    text=str(text).strip()[:19000] or '(อีเมลไม่มีข้อความที่แสดงได้)'
    if skipped:text+=f'\n\n[มีไฟล์แนบ {skipped} ไฟล์ที่ไม่ได้นำเข้า กรุณาตรวจจากอีเมลต้นทาง]'
    references=re.findall(r'<[^>\r\n]{1,250}>',str(mail.get('In-Reply-To',''))+' '+str(mail.get('References','')))[-20:]
    message_id=str(mail.get('Message-ID',''))[:300]
    return {'sender':sender,'name':name,'subject':subject,'body':text,'attachments':attachments,
            'references':references,'message_id':message_id}


def build_email(cfg,recipient,subject,text,message_id,reference,attachments):
    mail=EmailMessage()
    mail['From']=cfg['address'];mail['To']=recipient
    mail['Subject']=subject if subject.lower().startswith('re:') else 'Re: '+subject
    mail['Date']=formatdate(localtime=False,usegmt=True);mail['Message-ID']=message_id
    mail['Auto-Submitted']='auto-generated'
    if reference:
        mail['In-Reply-To']=reference;mail['References']=reference
    mail.set_content(text)
    for file in attachments:
        major,minor=file['mime'].split('/',1)
        mail.add_attachment(file['content'],maintype=major,subtype=minor,filename=file['name'])
    return mail


def send_email(cfg,secret,recipient,mail):
    with smtp_session(cfg,secret) as client:
        try:
            refused=client.send_message(mail,from_addr=cfg['address'],to_addrs=[recipient])
            if refused:raise ChannelError('rejected')
        except smtplib.SMTPResponseException as error:
            code=error.smtp_code
            raise ChannelError('temporary' if 400<=code<500 else 'rejected',retryable=400<=code<500) from None
        except smtplib.SMTPRecipientsRefused:raise ChannelError('rejected') from None
        except (OSError,smtplib.SMTPException):
            # SMTP has no idempotency key. A lost final ACK must never be auto-retried.
            raise ChannelError('unknown',uncertain=True) from None
    return str(mail['Message-ID'])
