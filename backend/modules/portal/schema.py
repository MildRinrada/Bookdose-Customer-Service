"""Support-page form validation and the data shown to visitors (never staff notes or internal fields)."""
from backend.utils.validation import require, field, email_field, person_name


def visitor_form(body):
    """(name, email, subject); the first message must not be empty."""
    name,email,subject = person_name(body),email_field(body),field(body,'subject',300)
    require(field(body,'body',20000),'กรุณาระบุรายละเอียด')
    return name,email,subject


def organization_view(org, welcome, ai_enabled, articles, response_hours=''):
    """response_hours is the organization's own first-reply promise, shown to the customer before they write."""
    return {'organization':{'name':org['name'],'slug':org['slug']},'welcome':welcome,'ai_enabled':ai_enabled,
            'articles':articles,'response_hours':response_hours}


def conversation_view(conv, messages, ticket, ai_state, survey=None):
    return {'conversation':{'id':conv['id'],'subject':conv['subject'],'status':conv['status']},'messages':messages,
            'ticket':{'number':ticket['number'],'status':ticket['status']} if ticket else None,'ai':ai_state,'survey':survey}
