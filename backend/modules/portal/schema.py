"""The data shown to support-page customers (never staff notes or internal fields)."""


def organization_view(org, welcome, ai_enabled, articles, response_hours='', email_verification=False, channels=(), categories=(),
                      response_in_opening_time=False, banner=None):
    """response_hours is the organization's own first-reply promise (response_in_opening_time: counted in its opening
    hours only); email_verification says whether a sign-up must confirm its email (the platform's email is set up);
    channels are the other ways to reach the team; banner is the support pages' band (organization/banner.py)."""
    return {'organization':{'name':org['name'],'slug':org['slug'],'logo':org.get('logo',''),'banner':banner},
            'welcome':welcome,'ai_enabled':ai_enabled,
            'articles':articles,'response_hours':response_hours,'response_in_opening_time':response_in_opening_time,
            'email_verification':email_verification,'channels':list(channels),'categories':list(categories)}


def conversation_view(conv, messages, ticket, ai_state, survey=None, staff_read_at=None, queue=None, line=None):
    """staff_read_at: when the team last opened the conversation after the customer wrote (read receipt). queue: the
    customer's place and expected wait while they wait for the team (conversations/queue.py), else None. line: whether
    the chat can go on in the organization's LINE, or went there (channels/move.py), else None."""
    return {'conversation':{'id':conv['id'],'subject':conv['subject'],'status':conv['status']},'messages':messages,
            'ticket':{'id':ticket['id'],'number':ticket['number'],'status':ticket['status']} if ticket else None,'ai':ai_state,'survey':survey,
            'staff_read_at':staff_read_at,'queue':queue,'line':line}
