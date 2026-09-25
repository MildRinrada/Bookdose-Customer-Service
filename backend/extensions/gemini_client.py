"""Google Gemini API (generateContent): the same instructions, JSON schema and input as the OpenAI call, for an
organization whose API key is a Gemini key (Google AI Studio: AQ.… or the older AIza…). One request per AI job; nothing is stored there."""
import json
import time
import urllib.error
import urllib.parse
import urllib.request

from backend.exceptions.errors import AIError
from backend.extensions import openai_client
from backend.utils.http import open_without_redirects

URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
# What Google names for new accounts (gemini-2.5-flash answers 404 "no longer available to new users" since 2026).
DEFAULT_MODEL = 'gemini-3.8-flash'
# Room for the model's thinking, which Gemini counts in the same output budget as the answer.
THINKING_TOKENS = 1024
# Google answers 503 "high demand" (or 500/502/504) for a moment when a model is busy: asked again after these waits,
# while the job is still well inside its time (ai/service.JOB_TIMEOUT_SECONDS).
RETRY_WAITS = (2,5)
RETRY_STATUSES = (500,502,503,504)
RETRY_WITHIN_SECONDS = 30
# A Gemini 3 answer with a few turns of history can take longer than OpenAI's 25 seconds; the job allows far more.
TIMEOUT_SECONDS = 60


def is_key(key):
    """A Gemini API key: an Auth key (AQ.…, what AI Studio issues since 2026) or an older Standard key (AIza…).
    Both go in the x-goog-api-key header. OpenAI keys start with sk-."""
    return key.startswith(('AQ.','AIza'))


def is_model(model):
    return model.startswith(('gemini-','gemma-'))


def _schema(value):
    """OpenAI's strict JSON schema, in the part of JSON Schema Gemini accepts: no additionalProperties, and enums of
    strings only. The answer is validated on our side either way (ai/service.py, ai/mood.py)."""
    if isinstance(value,list):
        return [_schema(item) for item in value]
    if not isinstance(value,dict):
        return value
    out = {k:_schema(v) for k,v in value.items() if k!='additionalProperties'}
    if 'enum' in out and not all(isinstance(item,str) for item in out['enum']):
        del out['enum']
    return out


def _thinking(model):
    """As little thinking as each model allows: the answers are short and checked, and thinking uses the output budget."""
    if model.startswith('gemini-2.5-flash'):
        return {'thinkingBudget':0}
    if model.startswith('gemini-2.5-pro'):
        return {'thinkingBudget':128}
    if model.startswith(('gemini-1','gemini-2','gemma-')):
        return None
    # Gemini 3 and later, and the -latest names that point at them.
    return {'thinkingLevel':'low'}


def _send(request):
    """The response body, asking again while Google says the model is busy (RETRY_WAITS)."""
    started = time.monotonic()
    for wait in (*RETRY_WAITS,None):
        try:
            with open_without_redirects(request,TIMEOUT_SECONDS) as response:
                return response.read(1_000_001)
        except urllib.error.HTTPError as error:
            # Only the status, for the server's log: why an owner saw "บริการ AI ไม่พร้อมใช้งาน".
            print(f'Gemini: HTTP {error.code}',flush=True)
            if wait is None or error.code not in RETRY_STATUSES or time.monotonic()-started+wait>RETRY_WITHIN_SECONDS:
                raise
            error.close()
            time.sleep(wait)


def call_provider(key,cfg,payload,mode):
    """Returns (parsed JSON answer, {'input_tokens','output_tokens'}), like openai_client.call_provider. Provider details
    never reach error messages; the key goes in a header, never in the URL."""
    instructions,schema = openai_client.MODES.get(mode,(openai_client.INSTRUCTIONS,openai_client.OUTPUT_SCHEMA))
    model = cfg['model']
    thinking = _thinking(model)
    limit = max(cfg['max_output_tokens'],openai_client.OWNER_OUTPUT_TOKENS.get(mode,0))
    generation = {'responseMimeType':'application/json','responseJsonSchema':_schema(schema),
                  'maxOutputTokens':limit+(0 if thinking=={'thinkingBudget':0} else THINKING_TOKENS)}
    if thinking:
        generation['thinkingConfig'] = thinking
    request_body = {'systemInstruction':{'parts':[{'text':instructions}]},
                    'contents':[{'role':'user','parts':[{'text':json.dumps(payload,ensure_ascii=False)}]}],
                    'generationConfig':generation}
    request = urllib.request.Request(URL.format(model=urllib.parse.quote(model,safe='')),data=json.dumps(request_body).encode(),
        headers={'x-goog-api-key':key,'Content-Type':'application/json'},method='POST')
    try:
        raw = _send(request)
        if len(raw)>1_000_000:
            raise AIError('invalid_output')
        data = json.loads(raw)
        candidate = data['candidates'][0]
        if candidate.get('finishReason')!='STOP':
            raise AIError('invalid_output')
        text = ''.join(part.get('text','') for part in candidate['content']['parts'] if not part.get('thought'))
        result = json.loads(text)
        usage = data.get('usageMetadata') or {}
        output = int(usage.get('candidatesTokenCount',0))+int(usage.get('thoughtsTokenCount',0))
        return result,{'input_tokens':max(0,int(usage.get('promptTokenCount',0))),'output_tokens':max(0,output)}
    except urllib.error.HTTPError as error:
        code = error.code
        # A wrong key is a 400 with API_KEY_INVALID; only that marker is read from the body, nothing is kept.
        try:
            invalid_key = code==400 and b'API_KEY_INVALID' in error.read(20_000)
        except OSError:
            invalid_key = False
        error.close()
        # 404: the model does not exist or is closed to this account - the key is fine, the model name is not.
        raise AIError('unauthorized' if invalid_key or code in (401,403) else 'model_unavailable' if code==404
                      else 'rate_limit' if code==429 else 'provider') from None
    except (urllib.error.URLError,TimeoutError,OSError) as error:
        print(f'Gemini: {type(error).__name__}',flush=True)
        raise AIError('provider') from None
    except (ValueError,KeyError,TypeError,AttributeError,IndexError):
        raise AIError('invalid_output') from None
