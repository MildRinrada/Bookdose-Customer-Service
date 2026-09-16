#!/usr/bin/env python3
"""Bookdose Customer Service entry point: `python app.py` starts the API server; --backup / --restore manage data.
Defaults come from config/settings.py (environment variables or .env).

The server is FastAPI on uvicorn (backend/asgi.py), one worker. BOOKDOSE_SERVER=legacy runs the old http.server
(backend/server.py) instead, as a rollback; both answer through backend/http/dispatch.py."""
import argparse
from http.server import ThreadingHTTPServer
import os
from pathlib import Path

from config import settings
from backend.database import db as D
from backend.database.backup import make_backup, restore_backup
from backend.modules.conversations.service import store_message
from backend.server import Handler
from backend.workers import start_workers, stop_workers


def banner(args, kind):
    print(f'\n  Bookdose Customer Service API on http://{args.host}:{args.port} ({kind})\n  The pages are the web app: cd frontend && npm run dev, then open http://localhost:3000\n  Data: {D.DATA}\n  Press Ctrl+C to stop.\n',flush=True)


def serve_fastapi(args):
    import uvicorn
    from backend.asgi import ServerInfo, create_app, uvicorn_config
    # The background workers start and stop in the application's lifespan.
    application = create_app(ServerInfo(args.host,args.port,args.secure_cookies))
    server = uvicorn.Server(uvicorn_config(application,args.host,args.port,log_level='warning'))
    banner(args,'FastAPI')
    try:
        # uvicorn stops on Ctrl+C (the lifespan stops the workers), then raises the signal again.
        server.run()
    except KeyboardInterrupt:
        pass
    print('\nBookdose stopped. Your data is saved.')


def serve_legacy(args):
    server = ThreadingHTTPServer((args.host,args.port),Handler)
    server.daemon_threads = True
    server.secure_cookies = args.secure_cookies
    workers = start_workers()
    banner(args,'legacy http.server')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nBookdose stopped. Your data is saved.')
    finally:
        stop_workers(workers)
        server.server_close()


def main():
    parser = argparse.ArgumentParser(description='Bookdose Customer Service')
    parser.add_argument('--host',default=settings.HOST)
    parser.add_argument('--port',type=int,default=settings.PORT)
    parser.add_argument('--secure-cookies',action='store_true',default=settings.SECURE_COOKIES,help='Use only behind an HTTPS reverse proxy')
    parser.add_argument('--backup',metavar='ZIP',help='Create a full backup and exit; stop writes first for a consistent platform snapshot')
    parser.add_argument('--restore',metavar='ZIP',help='Restore a full backup to an EMPTY data directory and exit')
    args = parser.parse_args()
    if settings.SERVER not in settings.SERVERS:
        parser.error(f'BOOKDOSE_SERVER must be one of: {", ".join(settings.SERVERS)}')
    os.umask(0o077)
    if args.restore:
        restore_backup(args.restore)
        print(f'Restored to {D.DATA}. All staff sessions have been signed out.')
        return
    D.init()
    if args.backup:
        target = Path(args.backup).resolve()
        target.parent.mkdir(parents=True,exist_ok=True)
        with target.open('xb') as out:
            out.write(make_backup())
        print(f'Backup saved: {target}')
        return
    if settings.SERVER=='legacy':
        serve_legacy(args)
    else:
        serve_fastapi(args)


if __name__=='__main__':
    main()
