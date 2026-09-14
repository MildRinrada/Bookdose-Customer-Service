"""AI settings validation and the job status response."""
import re

from backend.exceptions.errors import AI_ERRORS
from backend.utils.validation import require

LIMITS = [('daily_limit',1,10000),('conversation_limit',1,100),('max_output_tokens',200,2000)]


def settings_form(body, current):
    """(settings, model, new API key or '', remove key?) from the admin's form; fields left out keep `current`."""
    cfg = dict(current)
    for key in ('drafts_enabled','chatbot_enabled'):
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
    require(isinstance(key,str) and (not key or re.fullmatch(r'sk-[A-Za-z0-9_\-]{16,500}',key)),'รูปแบบ API Key ไม่ถูกต้อง')
    remove = body.get('remove_key',False)
    require(type(remove) is bool and not (remove and key),'ข้อมูลลบ API Key ไม่ถูกต้อง')
    return cfg,model,key,remove


def job_view(job, result):
    return {'id':job['id'],'status':job['status'],'result':result,
            'error':AI_ERRORS.get(job['error'],''),'input_tokens':job['input_tokens'],'output_tokens':job['output_tokens']}
