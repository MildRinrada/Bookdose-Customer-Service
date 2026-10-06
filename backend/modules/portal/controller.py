"""HTTP handlers for a customer's dealings with one organization. req.org is the organization and req.db its database;
req.customer is the signed-in customer (on 'customer' routes). The conversation a request is about comes in the
X-Conversation-ID header and must be one of the customer's own in this organization."""
from backend.modules.customers import service as customers
from backend.modules.portal import service


def _current(req):
    return service.owned_conversation(req.db,req.customer,req.headers.get('X-Conversation-ID',''))


def organization_info(req):
    return req.send(200,service.portal_info(req.cd,req.db,req.org))


def organization_logo(req):
    """The organization's picture, fetched with <img> wherever its name is listed. Kept by the browser for an hour:
    it changes rarely and the switcher, the console and the customer's own list all ask for it on every page."""
    return req.send(200,service.organization_logo(req.org),'image/png',{'Cache-Control':'public, max-age=3600'})


def known_issues(req):
    from backend.modules.incidents import service as incidents
    return req.send(200,{'issues':incidents.public(req.db)},headers={'Cache-Control':'no-store'})


def issue_affected(req, issue_id):
    from backend.middleware.rate_limit import limited
    from backend.modules.incidents import service as incidents
    from backend.modules.incidents.model import REPORTS_PER_IP_HOUR
    limited(('issue-affected',req.ip),REPORTS_PER_IP_HOUR,3600)
    return req.send(200,incidents.affected(req.db,issue_id,req.body))


def canonical_code(req):
    """The code this organization goes by now (a former code leads here too: platform/model.py tenant_slugs)."""
    return req.send(200,{'slug':req.org['slug']})


def open_conversation(req):
    return req.send(201,customers.open_conversation(req.cd,req.db,req.org,req.customer,req.body))


def case_detail(req, case_id):
    return req.send(200,service.case_detail(req.db,req.customer,case_id))


def conversation(req):
    return req.send(200,service.conversation_view(req.db,_current(req),req.customer,req.cd))


def thanks_photo(req, card_id):
    """The photo on a thank-you card (automation/thanks.py): kept by the browser for ten minutes."""
    from backend.modules.automation import thanks
    return req.send(200,thanks.photo(req.cd,req.db,req.customer,card_id),'image/png',{'Cache-Control':'private, max-age=600'})


def team_photo(req, key):
    """The photo beside a team reply (portal/photos.py). The key changes with the picture, so the browser keeps it a
    day; the guest chat's route answers the same."""
    from backend.modules.portal import photos
    return req.send(200,photos.photo(req.cd,req.db,key),'image/png',{'Cache-Control':'private, max-age=86400'})


def hand_off(req):
    service.hand_off_to_staff(req.db,_current(req))
    return req.send(200,{'ok':True})


def request_callback(req):
    from backend.modules.portal import callback
    return req.send(200,callback.request(req.db,_current(req),req.customer,req.customer['name'],req.body))


def no_rush(req):
    from backend.modules.portal import no_rush
    return req.send(200,no_rush.request(req.db,_current(req),req.customer['name'],req.body))


def article_feedback(req, article_id):
    from backend.middleware.rate_limit import limited
    from backend.modules.knowledge import feedback
    limited(('kb-feedback',req.ip),feedback.VOTES_PER_IP_HOUR,3600)
    return req.send(200,feedback.vote(req.db,article_id,req.body))


def continue_on_line(req):
    """POST /api/public/<org>/line/continue: a code that carries this chat to the organization's LINE."""
    from backend.modules.channels import move
    return req.send(200,move.new_code(req.db,req.org['id'],_current(req)))


def post_message(req):
    return req.send(201,{'id':service.post_customer_message(req.db,req.org['id'],_current(req),req.customer,req.body)})


def rate(req):
    service.rate_service(req.db,_current(req),req.body)
    return req.send(200,{'ok':True})


def react(req, message_id):
    """An emoji on a team reply of the customer's chat (conversations/reactions.py)."""
    from backend.modules.conversations import reactions
    return req.send(200,reactions.react(req.db,_current(req),message_id,req.body))


def thanks_heart(req, card_id):
    """A heart sent back from the thank-you card (automation/thanks.py)."""
    from backend.modules.automation import thanks
    return req.send(200,thanks.heart(req.cd,req.db,req.customer,card_id))


def resolve_chat(req):
    """ปิดเคส pressed on the chat (automation/closing.py)."""
    return req.send(200,service.resolve_case(req.db,req.org['id'],_current(req),req.customer))


def download_attachment(req, file_id):
    return req.send_download(*service.public_attachment(req.db,req.org['id'],req.customer,file_id))


# What signing in gives (customers/perks.py, incidents/follow.py)
def reopen_case(req, case_id):
    from backend.modules.customers import perks
    return req.send(200,{'conversation_id':perks.reopen_case(req.db,req.org['id'],req.customer,case_id,req.body)})


def resolve_case(req, case_id):
    from backend.modules.customers import perks
    perks.resolve_case(req.db,req.org['id'],req.customer,case_id)
    return req.send(200,{'ok':True})


def export_conversation(req, conversation_id):
    from backend.modules.customers import perks
    return req.send_download(*perks.export_conversation(req.db,req.org,req.customer,conversation_id))


def export_case(req, case_id):
    from backend.modules.customers import perks
    return req.send_download(*perks.export_case(req.db,req.org,req.customer,case_id))


def issues_following(req):
    from backend.modules.incidents import follow
    return req.send(200,{'following':follow.following(req.db,req.customer['account_id'])},headers={'Cache-Control':'no-store'})


def follow_issue(req, issue_id):
    from backend.modules.incidents import follow
    return req.send(200,follow.set_following(req.db,req.customer,issue_id,req.body))
