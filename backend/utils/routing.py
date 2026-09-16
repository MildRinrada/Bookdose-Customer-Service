"""Route tables. Each module's routes.py lists (HTTP method, URL pattern, controller, access);
backend/http/dispatch.py decides which middleware each access level goes through."""
import re

ID = r'([a-f0-9]{32})'
_patterns = {}


def find(routes, method, path, access):
    """(controller, captured URL parts) of the first matching route, or (None, ())."""
    for route_method, pattern, controller, route_access in routes:
        if route_access==access and route_method==method:
            match = _patterns.setdefault(pattern, re.compile(pattern)).fullmatch(path)
            if match:
                return controller, match.groups()
    return None, ()
