"""Server-independent HTTP layer: the route table, the order of middleware per access level and the request object
controllers receive. backend/asgi.py (FastAPI on uvicorn, the default) and backend/server.py (the old http.server,
kept for rollback) both answer every request through dispatch.dispatch()."""
