"""Outbound HTTPS requests that carry credentials (OpenAI, LINE, OAuth token endpoints)."""
import urllib.request


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def open_without_redirects(request, timeout):
    """Redirects are refused so a credential can only be sent to the exact URL requested."""
    return urllib.request.build_opener(_NoRedirect).open(request, timeout=timeout)
