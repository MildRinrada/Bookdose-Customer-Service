"""The data shown to support-page customers (never staff notes or internal fields)."""


def organization_view(org, welcome, ai_enabled, articles, response_hours='', email_verification=False, channels=(), categories=()):
    """response_hours is the organization's own first-reply promise; email_verification says whether a sign-up must
    confirm its email (the platform's email is set up); channels are the other ways to reach the team."""
    return {'organization':{'name':org['name'],'slug':org['slug'],'logo':org.get('logo','')},'welcome':welcome,'ai_enabled':ai_enabled,
            'articles':articles,'response_hours':response_hours,'email_verification':email_verification,'channels':list(channels),
            'categories':list(categories)}


def conversation_view(conv, messages, ticket, ai_state, survey=None, staff_read_at=None):
    """staff_read_at: when the team last opened the conversation after the customer wrote (read receipt)."""
    return {'conversation':{'id':conv['id'],'subject':conv['subject'],'status':conv['status']},'messages':messages,
            'ticket':{'id':ticket['id'],'number':ticket['number'],'status':ticket['status']} if ticket else None,'ai':ai_state,'survey':survey,
            'staff_read_at':staff_read_at}
