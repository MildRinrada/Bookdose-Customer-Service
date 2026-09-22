"""Switching a feature on or off for one organization at a time, so something new is tried with one before the rest."""
import unittest

import test_app as base


class FeatureTests(unittest.TestCase):
    def test_every_organization_starts_on_the_defaults(self):
        from backend.modules.platform import model
        features = self.ok(self.admin,'/api/workspace')['features']
        self.assertEqual(set(features),set(model.FEATURES))
        for key,(_,_,default) in model.FEATURES.items():
            self.assertEqual(features[key],default,key)

    def test_switching_one_off_reaches_that_organization_only(self):
        tenant = self.ok(self.admin,'/api/workspace')['tenant']['id']
        self.ok(self.owner,f'/api/platform/tenants/{tenant}/features',{'feature':'help_menu','enabled':False},'PATCH')
        self.assertFalse(self.ok(self.admin,'/api/workspace')['features']['help_menu'])
        # Everything else about the organization is untouched, and the other feature keeps its default.
        self.assertTrue(self.ok(self.admin,'/api/workspace')['features']['snippet_menu'])
        # And back on again.
        self.ok(self.owner,f'/api/platform/tenants/{tenant}/features',{'feature':'help_menu','enabled':True},'PATCH')
        self.assertTrue(self.ok(self.admin,'/api/workspace')['features']['help_menu'])

    def test_only_a_platform_admin_may_switch(self):
        tenant = self.ok(self.admin,'/api/workspace')['tenant']['id']
        self.assertEqual(self.admin.call(f'/api/platform/tenants/{tenant}/features',
                                         {'feature':'help_menu','enabled':False},'PATCH')[0],403)

    def test_an_unknown_feature_is_refused(self):
        tenant = self.ok(self.admin,'/api/workspace')['tenant']['id']
        for bad in ({'feature':'no_such_thing','enabled':True},{'feature':'help_menu','enabled':'yes'},
                    {'feature':'help_menu'},{'enabled':True},{}):
            self.assertEqual(self.owner.call(f'/api/platform/tenants/{tenant}/features',bad,'PATCH')[0],400,bad)

    def test_the_console_lists_what_can_be_switched_and_where_it_stands(self):
        tenant = self.ok(self.admin,'/api/workspace')['tenant']['id']
        self.ok(self.owner,f'/api/platform/tenants/{tenant}/features',{'feature':'snippet_menu','enabled':False},'PATCH')
        page = self.ok(self.owner,'/api/platform/tenants')
        self.assertTrue(any(f['key']=='snippet_menu' for f in page['feature_catalogue']))
        org = next(t for t in page['tenants'] if t['id']==tenant)
        self.assertFalse(org['features']['snippet_menu'])
        self.assertTrue(org['features']['help_menu'])


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(FeatureTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
