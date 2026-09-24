"""The organization's n8n workflow as its AI: the same instructions, JSON schema and input the OpenAI call uses are
POSTed to the workflow's webhook, which answers {"result": {...}, "usage": {"input_tokens", "output_tokens"}}.
The workflow chooses the model (a local Ollama model, OpenAI, Gemini, ...). See integrations/n8n/README.md."""
import ipaddress
import json
import socket
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from config import settings
from backend.exceptions.errors import AIError
from backend.extensions import openai_client
from backend.utils.http import open_without_redirects

# A local model on a laptop is slow: an article of 2,500 tokens takes minutes. The job's own time limit is longer.
TIMEOUT_SECONDS = 300
# Which part of the workflow answers: the staff's reply drafts, the connection test and the staff's AI assistant
# (ask), the chatbot, the owner's overview (an article from unanswered questions, today's summary); reading how a
# customer feels (mood) goes to the assist part too.
FEATURES = {'draft':'assist','test':'assist','ask':'assist','bot':'chatbot','article':'insights','brief':'insights','mood':'assist','summary':'assist'}
LOOPBACK_NAMES = ('localhost','127.0.0.1','::1')


def local_server():
    """This server answers only on this computer (a local install), so a workflow on this computer may be used."""
    return settings.HOST in LOOPBACK_NAMES and not settings.on_render()


def url_problem(url):
    """Why the URL may not be used ('' when it may): https on a public host, or n8n on this computer for a local
    install. Never another address on the server's network."""
    parts = urlsplit(url)
    if parts.scheme not in ('http','https') or not parts.hostname or parts.username or parts.password or parts.fragment:
        return 'URL ของ Webhook ต้องขึ้นต้นด้วย https:// และไม่มีชื่อผู้ใช้หรือรหัสผ่านในลิงก์'
    if parts.hostname in LOOPBACK_NAMES:
        return '' if local_server() else 'ใช้ n8n บนเครื่องนี้ได้เฉพาะเมื่อติดตั้งระบบไว้ใช้บนเครื่องเดียว กรุณาใช้ URL https สาธารณะของ n8n'
    if parts.scheme!='https':
        return 'URL ของ Webhook ต้องเป็น https:// (ยกเว้น n8n บนเครื่องนี้ http://localhost)'
    try:
        address = ipaddress.ip_address(parts.hostname)
    except ValueError:
        address = None
    if (address and not address.is_global) or (not address and '.' not in parts.hostname):
        return 'ห้ามใช้ที่อยู่เครือข่ายภายในสำหรับ Webhook'
    return ''


def _public(host, port):
    """Every address the name resolves to is public (a public name must not lead into the server's network)."""
    try:
        found = socket.getaddrinfo(host,port,type=socket.SOCK_STREAM)
    except OSError:
        return False
    return bool(found) and all(ipaddress.ip_address(item[4][0].split('%')[0]).is_global for item in found)


def call(webhook, cfg, payload, mode):
    """(parsed JSON answer, usage), like openai_client.call_provider. Workflow details never reach error messages."""
    url = webhook['url']
    parts = urlsplit(url)
    if url_problem(url) or (parts.hostname not in LOOPBACK_NAMES and not _public(parts.hostname,parts.port or 443)):
        raise AIError('provider')
    instructions,schema = openai_client.MODES.get(mode,(openai_client.INSTRUCTIONS,openai_client.OUTPUT_SCHEMA))
    body = {'mode':mode,'feature':FEATURES.get(mode,'assist'),'instructions':instructions,'schema':schema,
            'input':json.dumps(payload,ensure_ascii=False),
            'max_output_tokens':max(cfg['max_output_tokens'],openai_client.OWNER_OUTPUT_TOKENS.get(mode,0))}
    headers = {'Content-Type':'application/json','Accept':'application/json'}
    if webhook.get('secret'):
        # Both names n8n's Header Auth is commonly set up with (its form suggests "Authorization"); the request only
        # ever goes to the organization's own workflow, and redirects are refused.
        headers['X-Bookdose-Secret'] = webhook['secret']
        headers['Authorization'] = webhook['secret']
    request = urllib.request.Request(url,data=json.dumps(body,ensure_ascii=False).encode(),headers=headers,method='POST')
    try:
        with open_without_redirects(request,TIMEOUT_SECONDS) as response:
            raw = response.read(1_000_001)
        if len(raw)>1_000_000:
            raise AIError('invalid_output')
        data = json.loads(raw)
        # n8n answers a list when "Respond to Webhook" sends all items; the first one is the answer.
        if isinstance(data,list) and data:
            data = data[0]
        result = data['result']
        if isinstance(result,str):
            result = json.loads(result)
        usage = data.get('usage') or {}
        return result,{'input_tokens':max(0,int(usage.get('input_tokens') or 0)),'output_tokens':max(0,int(usage.get('output_tokens') or 0))}
    except urllib.error.HTTPError as error:
        code = error.code
        error.close()
        # What the owner can act on in n8n: a workflow that is not published (or a Test URL), one that stops at a node.
        raise AIError('unauthorized' if code in (401,403) else 'rate_limit' if code==429 else 'webhook_missing' if code==404
                      else 'webhook_failed' if code>=500 else 'provider') from None
    except (urllib.error.URLError,TimeoutError,OSError):
        raise AIError('provider') from None
    except (ValueError,KeyError,TypeError,AttributeError):
        raise AIError('invalid_output') from None
