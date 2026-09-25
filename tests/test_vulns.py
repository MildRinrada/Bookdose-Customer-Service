"""ช่องโหว่ในไลบรารี: the libraries the server runs checked against OSV.dev (mocked here: nothing leaves the machine) -
found, rated, shown on the console's overview and its to-do list, and a new high one in what runs emailed to the
platform admins once."""
import unittest
from unittest.mock import patch

import test_app as base
from test_app import D
from backend.modules.platform import vulns

HIGH = {'id':'GHSA-aaaa-bbbb-cccc','aliases':['CVE-2026-1111','PYSEC-2026-1'],'summary':'Request smuggling in the web server',
        'database_specific':{'severity':'HIGH'},
        'affected':[{'package':{'ecosystem':'PyPI','name':'uvicorn'},'ranges':[{'type':'ECOSYSTEM','events':[{'introduced':'0'},{'fixed':'9.9.9'}]}]}]}
# The same issue under PyPI's own id, without a rating: counted once, under the rated one.
SAME = {'id':'PYSEC-2026-1','aliases':['CVE-2026-1111'],'details':'Request smuggling'}
DEV_CRITICAL = {'id':'GHSA-dddd-eeee-ffff','aliases':['CVE-2026-2222'],'summary':'Prototype pollution in a build tool',
                'severity':[{'type':'CVSS_V3','score':'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'}]}


class OsvFake:
    """api.osv.dev: uvicorn has the high one (twice, under two ids); a build-only npm package a critical one."""
    def __init__(self):
        self.queries = []

    def __call__(self, url, body=None):
        if url.endswith('/querybatch'):
            self.queries.append(body['queries'])
            results = []
            for q in body['queries']:
                name = q['package']['name']
                results.append({'vulns':[{'id':HIGH['id']},{'id':SAME['id']}]} if name.lower()=='uvicorn'
                               else {'vulns':[{'id':DEV_CRITICAL['id']}]} if name=='eslint' else {})
            return {'results':results}
        return {HIGH['id']:HIGH,SAME['id']:SAME,DEV_CRITICAL['id']:DEV_CRITICAL}[url.rsplit('/',1)[1]]


class ScoreTests(unittest.TestCase):
    def test_cvss_scores_and_levels(self):
        self.assertEqual(vulns.cvss3('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'),9.8)
        self.assertEqual(vulns.cvss3('CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N'),6.1)
        self.assertIsNone(vulns.cvss3('nonsense'))
        self.assertEqual(vulns.severity(DEV_CRITICAL),('critical',9.8))
        self.assertEqual(vulns.severity(HIGH),('high',None))

    def test_what_runs_is_listed(self):
        python = dict(vulns.python_packages())
        self.assertIn('fastapi',{name.lower() for name in python})
        self.assertIn('pydantic',{name.lower() for name in python})    # pulled in by fastapi, not written down
        npm = vulns.npm_packages()
        self.assertTrue(any(name=='next' and not dev for name,_,dev in npm))
        self.assertTrue(any(dev for _,_,dev in npm))


class VulnScanTests(unittest.TestCase):
    def fake_packages(self):
        return patch.multiple(vulns,python_packages=lambda:[('fastapi','0.141.1'),('uvicorn','0.53.0')],
                              npm_packages=lambda:[('next','16.0.0',False),('eslint','9.0.0',True)])

    def test_found_shown_and_emailed_once(self):
        self.enable_registration_mail()
        fake = OsvFake()
        with self.fake_packages(), patch.object(vulns,'_request',side_effect=fake):
            shown = self.ok(self.owner,'/api/platform/vulns',{})
        # Only names and versions are sent.
        self.assertEqual(fake.queries[0][1],{'package':{'ecosystem':'PyPI','name':'uvicorn'},'version':'0.53.0'})
        findings = shown['last']['findings']
        self.assertEqual([(f['name'],f['level'],f['dev']) for f in findings],[('uvicorn','high',False),('eslint','critical',True)])
        self.assertEqual((findings[0]['cves'],findings[0]['fixed']),(['CVE-2026-1111'],['9.9.9']))
        self.assertEqual((shown['last']['python'],shown['last']['npm']),(2,2))
        # Emailed at once, the high one in what runs only (the build tool never runs on the server).
        mails = [call.args[3] for call in self.mailer.call_args_list]
        self.assertEqual(len(mails),1)
        body = mails[0].get_content()
        self.assertIn('uvicorn 0.53.0',body)
        self.assertIn('CVE-2026-1111',body)
        self.assertNotIn('eslint',body)
        # On the overview and its to-do list.
        health = self.ok(self.owner,'/api/platform/health')
        self.assertEqual(health['vulns']['last']['findings'][0]['id'],HIGH['id'])
        todo = {i['key']:i for i in health['todo']}
        self.assertEqual(todo['vulns']['level'],'critical')
        self.assertIn('uvicorn',todo['vulns']['detail'])
        # The next day's round finds the same: not emailed again.
        with self.fake_packages(), patch.object(vulns,'_request',side_effect=OsvFake()):
            vulns.scan()
        self.assertEqual(self.mailer.call_count,1)
        # Organizations' admins do not run it.
        self.assertEqual(self.admin.call('/api/platform/vulns',{})[0],403)

    def test_osv_out_of_reach_keeps_the_last_findings_and_retries_soon(self):
        with self.fake_packages(), patch.object(vulns,'_request',side_effect=OsvFake()):
            vulns.scan()
        with self.fake_packages(), patch.object(vulns,'_request',side_effect=OSError('offline')):
            failed = vulns.scan()
        self.assertEqual((failed['ok'],failed['error'],len(failed['findings'])),(False,'OSError',2))
        with D.control() as cd:
            self.assertFalse(vulns.due(cd))
            cd.execute("UPDATE platform_settings SET value=json_set(value,'$.at','2000-01-01T00:00:00+00:00') WHERE key='vuln_scan'")
            cd.commit()
            self.assertTrue(vulns.due(cd))


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(VulnScanTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
