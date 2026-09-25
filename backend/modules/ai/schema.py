"""AI settings validation and the job status response."""
import re

from backend.exceptions.errors import AI_ERRORS
from backend.extensions import ai_webhook
from backend.utils.validation import require

LIMITS = [('daily_limit',1,10000),('conversation_limit',1,100),('max_output_tokens',200,2000)]


def webhook_form(body):
    """The n8n webhook part of the form: None keeps the saved one, False removes it, {'url','secret'} saves it (an
    empty secret keeps the saved secret; an empty url with a new secret changes only the secret of the saved one)."""
    if body.get('remove_webhook',False) is True:
        return False
    url = body.get('webhook_url','')
    secret = body.get('webhook_secret','')
    require(isinstance(url,str) and isinstance(secret,str) and len(url)<=500 and len(secret)<=200,'ข้อมูล Webhook ไม่ถูกต้อง')
    url,secret = url.strip(),secret.strip()
    if not url and not secret:
        return None
    if url:
        problem = ai_webhook.url_problem(url)
        require(not problem,problem)
    require(not secret or re.fullmatch(r'[\x21-\x7e]{16,200}',secret),'รหัสลับของ Webhook ต้องยาว 16 ตัวขึ้นไป ไม่มีช่องว่างหรือภาษาไทย')
    return {'url':url,'secret':secret}


def settings_form(body, current):
    """(settings, model, new API key or '', remove key?) from the admin's form; fields left out keep `current`."""
    cfg = dict(current)
    for key in ('drafts_enabled','chatbot_enabled','mood_enabled','translate_enabled'):
        value = body.get(key,cfg[key])
        require(type(value) is bool,'สถานะ AI ไม่ถูกต้อง')
        cfg[key] = value
    model = body.get('model',cfg['model'])
    require(isinstance(model,str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,100}',model),'ชื่อโมเดลไม่ถูกต้อง')
    for name,low,high in LIMITS:
        value = body.get(name,cfg[name])
        require(type(value) is int and low<=value<=high,f'{name} ต้องเป็นจำนวนเต็มระหว่าง {low}-{high}')
        cfg[name] = value
    key = body.get('api_key','')
    require(isinstance(key,str),'รูปแบบ API Key ไม่ถูกต้อง')
    key = key.strip()
    # Another provider's key looks alike (sk-…); OpenAI would only answer 401, after the key had been sent there.
    require(not key.startswith('sk-ant-'),'นี่คือ API Key ของ Anthropic (Claude) ซึ่งยังไม่รองรับ: ใช้คีย์ OpenAI (sk-…) หรือ Gemini (AQ.… หรือ AIza…)')
    # OpenAI (platform.openai.com: sk-proj-… or sk-…) or Gemini (aistudio.google.com: an Auth key AQ.…, or an older
    # Standard key AIza…).
    require(not key or re.fullmatch(r'sk-[A-Za-z0-9_\-]{16,500}|AQ\.[A-Za-z0-9_.\-]{20,500}|AIza[A-Za-z0-9_\-]{30,200}',key),
            'รูปแบบ API Key ไม่ถูกต้อง: ใช้คีย์ OpenAI (ขึ้นต้นด้วย sk-) หรือ Gemini (ขึ้นต้นด้วย AQ. หรือ AIza)')
    remove = body.get('remove_key',False)
    require(type(remove) is bool and not (remove and key),'ข้อมูลลบ API Key ไม่ถูกต้อง')
    return cfg,model,key,remove


def job_view(job, result):
    return {'id':job['id'],'status':job['status'],'result':result,
            'error':AI_ERRORS.get(job['error'],''),'input_tokens':job['input_tokens'],'output_tokens':job['output_tokens']}
