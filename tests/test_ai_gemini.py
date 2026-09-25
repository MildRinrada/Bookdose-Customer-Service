"""A Gemini API key (AIza…) in the AI settings: the model follows the key, jobs go to Gemini, the request carries the key
in a header only, and Gemini's answers and errors read like OpenAI's. No request leaves the machine."""
import io
import json
import unittest
from unittest.mock import patch
import urllib.error

import test_app as base
from backend.exceptions.errors import AIError
from backend.extensions import gemini_client as Gemini, openai_client as OpenAI
from backend.modules.ai import service as AI

GEMINI_KEY = 'AQ.AbUnitTest-not_a.real-key-0123456789abcdef'
OLD_GEMINI_KEY = 'AIzaUnitTestNotARealKey0123456789abcdef'
OPENAI_KEY = 'sk-unit-test-not-a-real-key-0123456789'
CFG = {'model':'gemini-2.5-flash','max_output_tokens':1000}
CFG3 = {'model':Gemini.DEFAULT_MODEL,'max_output_tokens':1000}
OK = {'answer':'เชื่อมต่อ AI สำเร็จ','summary':'','needs_human':False,'citations':[]}


class Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def gemini_answer(result, finish='STOP'):
    return Response(json.dumps({'candidates':[{'finishReason':finish,'content':{'parts':[{'text':json.dumps(result)}]}}],
                                'usageMetadata':{'promptTokenCount':120,'candidatesTokenCount':30,'thoughtsTokenCount':5}}).encode())


class GeminiSettingsTests(unittest.TestCase):
    setUp = base.IntegrationTests.setUp
    tearDown = base.IntegrationTests.tearDown
    ok = base.IntegrationTests.ok

    def test_gemini_key_is_accepted_and_the_model_follows_it(self):
        saved = self.ok(self.admin,'/api/ai/settings',{'api_key':GEMINI_KEY,'drafts_enabled':True},'PATCH')
        self.assertEqual((saved['provider'],saved['key_provider'],saved['model']),('gemini','gemini',Gemini.DEFAULT_MODEL))
        self.assertTrue(saved['key_configured'])
        self.assertNotIn(GEMINI_KEY,json.dumps(saved))
        # A model of the other service typed in is refused; a Gemini one is kept.
        status,body = self.admin.call('/api/ai/settings',{'model':'gpt-4.1-mini'},'PATCH')
        self.assertEqual(status,400);self.assertIn('Gemini',body['error'])
        self.assertEqual(self.ok(self.admin,'/api/ai/settings',{'model':'gemini-2.5-pro'},'PATCH')['model'],'gemini-2.5-pro')
        # Back to an OpenAI key: the Gemini model left as it was goes back to OpenAI's default.
        back = self.ok(self.admin,'/api/ai/settings',{'api_key':OPENAI_KEY},'PATCH')
        self.assertEqual((back['provider'],back['model']),('openai',AI.DEFAULT_MODEL))
        # The older Standard key (AIza…) is still a Gemini key.
        self.assertEqual(self.ok(self.admin,'/api/ai/settings',{'api_key':OLD_GEMINI_KEY},'PATCH')['provider'],'gemini')
        for bad in ('AIza-short','AQ.short','AQ.Ab has spaces 0123456789abcdef'):
            status,body = self.admin.call('/api/ai/settings',{'api_key':bad},'PATCH')
            self.assertEqual(status,400);self.assertIn('AQ.',body['error'])

    def test_jobs_go_to_gemini_with_a_gemini_key(self):
        self.ok(self.admin,'/api/ai/settings',{'api_key':GEMINI_KEY},'PATCH')
        job = self.ok(self.admin,'/api/ai/test',{})['id']
        with patch.object(Gemini,'call_provider',return_value=(OK,{'input_tokens':1,'output_tokens':1})) as gemini, \
                patch.object(OpenAI,'call_provider') as openai:
            AI.process_one(self.org)
        self.assertEqual(gemini.call_args.args[0],GEMINI_KEY);openai.assert_not_called()
        self.assertEqual(self.ok(self.admin,'/api/ai/jobs/'+job)['status'],'done')


class GeminiClientTests(unittest.TestCase):
    def test_request_shape_and_answer(self):
        sent = []
        def fake_open(request, timeout):
            sent.append(request)
            return gemini_answer(OK)
        with patch.object(Gemini,'open_without_redirects',side_effect=fake_open):
            result,usage = Gemini.call_provider(GEMINI_KEY,CFG,{'test':'x'},'test')
        self.assertEqual(result,OK)
        self.assertEqual(usage,{'input_tokens':120,'output_tokens':35})
        request = sent[0]
        self.assertNotIn(GEMINI_KEY,request.full_url)
        self.assertTrue(request.full_url.endswith('/models/gemini-2.5-flash:generateContent'))
        self.assertEqual(request.get_header('X-goog-api-key'),GEMINI_KEY)
        body = json.loads(request.data)
        self.assertNotIn('additionalProperties',json.dumps(body['generationConfig']['responseJsonSchema']))
        self.assertEqual(body['generationConfig']['thinkingConfig'],{'thinkingBudget':0})
        self.assertEqual(body['generationConfig']['responseMimeType'],'application/json')
        with patch.object(Gemini,'open_without_redirects',side_effect=fake_open):
            Gemini.call_provider(GEMINI_KEY,CFG3,{'test':'x'},'test')
        self.assertEqual(json.loads(sent[1].data)['generationConfig']['thinkingConfig'],{'thinkingLevel':'low'})

    def test_errors(self):
        def http(code, body=b'{}'):
            return urllib.error.HTTPError('https://x',code,'x',{},io.BytesIO(body))
        cases = [(http(400,b'{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}'),'unauthorized'),(http(400),'provider'),
                 (http(404),'model_unavailable'),(http(401),'unauthorized'),(http(429),'rate_limit')]
        for error,code in cases:
            with patch.object(Gemini,'open_without_redirects',side_effect=error), patch.object(Gemini.time,'sleep'), \
                    self.assertRaises(AIError) as raised:
                Gemini.call_provider(GEMINI_KEY,CFG,{},'test')
            self.assertEqual(raised.exception.code,code)
        # Busy for a moment (503): asked again, and the second answer is used.
        with patch.object(Gemini,'open_without_redirects',side_effect=[http(503),gemini_answer(OK)]) as sent, \
                patch.object(Gemini.time,'sleep') as slept:
            self.assertEqual(Gemini.call_provider(GEMINI_KEY,CFG,{},'test')[0],OK)
        self.assertEqual(sent.call_count,2);slept.assert_called_once_with(Gemini.RETRY_WAITS[0])
        # Still busy: a fallback model answers.
        urls = []
        def busy_then_fallback(request, timeout):
            urls.append(request.full_url)
            if len(urls)<=2:
                raise http(503)
            return gemini_answer(OK)
        with patch.object(Gemini,'open_without_redirects',side_effect=busy_then_fallback), patch.object(Gemini.time,'sleep'):
            self.assertEqual(Gemini.call_provider(GEMINI_KEY,CFG,{},'test')[0],OK)
        self.assertIn('/models/gemini-2.5-flash:',urls[0]);self.assertIn(f'/models/{Gemini.FALLBACK_MODELS[0]}:',urls[2])
        # Every model busy: 'busy', not a wrong key.
        tries = 2*(1+len(Gemini.FALLBACK_MODELS))
        with patch.object(Gemini,'open_without_redirects',side_effect=[http(503) for _ in range(tries)]) as sent, \
                patch.object(Gemini.time,'sleep'), self.assertRaises(AIError) as raised:
            Gemini.call_provider(GEMINI_KEY,CFG,{},'test')
        self.assertEqual((sent.call_count,raised.exception.code),(tries,'busy'))
        # Cut off by the token limit: not a usable answer.
        with patch.object(Gemini,'open_without_redirects',return_value=gemini_answer(OK,'MAX_TOKENS')), self.assertRaises(AIError) as raised:
            Gemini.call_provider(GEMINI_KEY,CFG,{},'test')
        self.assertEqual(raised.exception.code,'invalid_output')


if __name__=='__main__':
    unittest.main()
