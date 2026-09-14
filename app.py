#!/usr/bin/env python3
"""Bookdose Customer Service entry point: `python app.py` starts the server; --backup / --restore manage data.
Defaults come from config/settings.py (environment variables or .env)."""
import argparse
from http.server import ThreadingHTTPServer
import os
from pathlib import Path

from config import settings
from backend.database import db as D
from backend.database.backup import make_backup, restore_backup
from backend.modules.ai.service import Worker as AIWorker
from backend.modules.automation.service import Worker as AutomationWorker
from backend.modules.channels.service import Worker as ChannelWorker
from backend.modules.conversations.service import store_message
from backend.server import Handler


def main():
    parser = argparse.ArgumentParser(description='Bookdose Customer Service')
    parser.add_argument('--host',default=settings.HOST)
    parser.add_argument('--port',type=int,default=settings.PORT)
    parser.add_argument('--secure-cookies',action='store_true',default=settings.SECURE_COOKIES,help='Use only behind an HTTPS reverse proxy')
    parser.add_argument('--backup',metavar='ZIP',help='Create a full backup and exit; stop writes first for a consistent platform snapshot')
    parser.add_argument('--restore',metavar='ZIP',help='Restore a full backup to an EMPTY data directory and exit')
    args = parser.parse_args()
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
    server = ThreadingHTTPServer((args.host,args.port),Handler)
    server.daemon_threads = True
    server.secure_cookies = args.secure_cookies
    ai_worker = AIWorker()
    ai_worker.start()
    channel_worker = ChannelWorker(store_message)
    channel_worker.start()
    automation_worker = AutomationWorker()
    automation_worker.start()
    print(f'\n  Bookdose Customer Service\n  Open http://localhost:{args.port}\n  Data: {D.DATA}\n  Press Ctrl+C to stop.\n',flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nBookdose stopped. Your data is saved.')
    finally:
        ai_worker.stop.set()
        channel_worker.stop.set()
        automation_worker.stop.set()
        server.server_close()


if __name__=='__main__':
    main()
