"""จัดหน้าภาพรวม: each member arranges the overview for the work they actually do, and the organization can set what
new members start from. The server keeps the arrangement and checks its shape; what a card is called belongs to the
screen, which is what these tests hold to - an unknown name is stored, not refused, so a card released tomorrow needs
no migration today."""
import json
import unittest

import test_app as base

PREFS = '/api/account/preferences'
ORG_DEFAULT = '/api/settings/dashboard'


class DashboardLayoutTests(unittest.TestCase):
    def layout_of(self, client):
        return self.ok(client,PREFS)['preferences']['dashboard']

    def org_default(self, client=None):
        return self.ok(client or self.admin,'/api/workspace')['settings'].get('dashboard_layout')

    def test_nobody_has_arranged_anything_to_begin_with(self):
        agent,_ = self.create_member()
        self.assertEqual(self.layout_of(agent),{'hidden':[],'box':{}})
        self.assertEqual(self.org_default(),'')

    def test_what_a_member_arranges_is_theirs_alone(self):
        agent,_ = self.create_member()
        mine = {'hidden':['chart'],'box':{'sla':{'x':0,'y':0,'w':8,'h':9},'waiting':{'x':8,'y':0,'w':4,'h':6}}}
        self.ok(agent,PREFS,{'dashboard':mine})
        self.assertEqual(self.layout_of(agent),mine)
        # The owner's own page did not move, and neither did the organization's starting point.
        self.assertEqual(self.layout_of(self.admin),{'hidden':[],'box':{}})
        self.assertEqual(self.org_default(),'')

    def test_arranging_does_not_disturb_the_rest_of_the_preferences(self):
        self.ok(self.admin,PREFS,{'alias':'ทีมดูแลลูกค้า'})
        self.ok(self.admin,PREFS,{'dashboard':{'box':{'stats':{'x':0,'y':4,'w':12,'h':3}}}})
        prefs = self.ok(self.admin,PREFS)['preferences']
        self.assertEqual(prefs['alias'],'ทีมดูแลลูกค้า')
        self.assertEqual(prefs['dashboard']['box'],{'stats':{'x':0,'y':4,'w':12,'h':3}})

    def test_a_card_name_the_server_has_never_heard_of_is_kept(self):
        """The list of cards lives in the screen. A release that adds one must not need the server to know first."""
        spot = {'x':0,'y':0,'w':4,'h':4}
        self.ok(self.admin,PREFS,{'dashboard':{'box':{'a_card_from_next_year':spot}}})
        self.assertEqual(self.layout_of(self.admin)['box'],{'a_card_from_next_year':spot})

    def test_a_gap_is_kept_exactly_where_it_was_left(self):
        """Nothing is packed or shifted: two cards with six empty columns between them stay six columns apart."""
        board = {'box':{'tickets':{'x':0,'y':0,'w':3,'h':6},'sla':{'x':9,'y':0,'w':3,'h':6}}}
        self.ok(self.admin,PREFS,{'dashboard':board})
        self.assertEqual(self.layout_of(self.admin)['box'],board['box'])

    def test_the_shape_is_checked(self):
        for bad in ({'hidden':['Not A Card']},{'hidden':'stats'},{'box':['stats']},{'box':{'Stats':{'x':0,'y':0,'w':4,'h':4}}},
                    # Off the right-hand edge, too narrow to read, too short to read, and missing a side.
                    {'box':{'stats':{'x':10,'y':0,'w':4,'h':4}}},{'box':{'stats':{'x':0,'y':0,'w':1,'h':4}}},
                    {'box':{'stats':{'x':0,'y':0,'w':4,'h':1}}},{'box':{'stats':{'x':0,'y':0,'w':4}}},
                    {'box':{'stats':{'x':0,'y':0,'w':4.5,'h':4}}},
                    {'hidden':[f'card{i}' for i in range(41)]}):
            self.assertEqual(self.admin.call(PREFS,{'dashboard':bad})[0],400,bad)
        self.assertEqual(self.admin.call(PREFS,{'dashboard':'stats'})[0],400)
        # A card put away twice is put away once.
        self.ok(self.admin,PREFS,{'dashboard':{'hidden':['stats','sla','stats']}})
        self.assertEqual(self.layout_of(self.admin)['hidden'],['stats','sla'])

    def test_the_owner_sets_what_new_members_start_from(self):
        layout = {'hidden':['chart'],'box':{'waiting':{'x':0,'y':0,'w':6,'h':7}}}
        self.ok(self.admin,ORG_DEFAULT,{'dashboard':layout})
        self.assertEqual(json.loads(self.org_default()),layout)
        # Everyone in the organization reads it; nobody's own arrangement was touched by it.
        agent,_ = self.create_member()
        self.assertEqual(json.loads(self.org_default(agent)),layout)
        self.assertEqual(self.layout_of(agent),{'hidden':[],'box':{}})
        # Saving an empty one puts the organization back on the screen's own arrangement.
        self.ok(self.admin,ORG_DEFAULT,{'dashboard':{'hidden':[],'box':{}}})
        self.assertEqual(self.org_default(),'')

    def test_only_an_owner_sets_the_organizations_starting_point(self):
        agent,_ = self.create_member()
        self.assertEqual(agent.call(ORG_DEFAULT,{'dashboard':{'box':{'sla':{'x':0,'y':0,'w':4,'h':5}}}})[0],403)
        self.assertEqual(self.org_default(),'')
        # An agent still arranges their own page.
        self.ok(agent,PREFS,{'dashboard':{'box':{'sla':{'x':0,'y':0,'w':4,'h':5}}}})
        self.assertEqual(self.layout_of(agent)['box'],{'sla':{'x':0,'y':0,'w':4,'h':5}})

    def test_the_platform_can_switch_the_whole_thing_off_for_one_organization(self):
        """Switched off, the organization is back on the arrangement the page ships with - and what its members
        arranged is kept, not thrown away, so switching it on again gives them their own page back."""
        tenant = self.ok(self.admin,'/api/workspace')['tenant']['id']
        board = {'box':{'sla':{'x':0,'y':0,'w':8,'h':9}}}
        self.ok(self.admin,PREFS,{'dashboard':board})
        self.assertTrue(self.ok(self.admin,'/api/workspace')['features']['dashboard_layout'])
        self.ok(self.owner,f'/api/platform/tenants/{tenant}/features',{'feature':'dashboard_layout','enabled':False},'PATCH')
        self.assertFalse(self.ok(self.admin,'/api/workspace')['features']['dashboard_layout'])
        # Still saved, untouched, while the feature is off.
        self.assertEqual(self.layout_of(self.admin)['box'],board['box'])
        self.ok(self.owner,f'/api/platform/tenants/{tenant}/features',{'feature':'dashboard_layout','enabled':True},'PATCH')
        self.assertEqual(self.layout_of(self.admin)['box'],board['box'])

    def test_another_organizations_starting_point_stays_its_own(self):
        self.ok(self.admin,ORG_DEFAULT,{'dashboard':{'box':{'sla':{'x':0,'y':0,'w':4,'h':5}}}})
        self.second_organization()
        self.assertEqual(self.org_default(),'')


# The setUp, the sign-ins and the helpers of the main integration test, without its tests.
for _name, _member in vars(base.IntegrationTests).items():
    if not _name.startswith(('test_', '__')):
        setattr(DashboardLayoutTests, _name, _member)


if __name__ == '__main__':
    unittest.main()
