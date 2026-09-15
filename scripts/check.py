#!/usr/bin/env python3
"""Development check: Python syntax, the web app's types and lint (needs Node.js and `npm install` in frontend/)
and the automated tests.
Usage: python scripts/check.py"""
import compileall
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT/'frontend'


def main():
    ok = compileall.compile_dir(ROOT/'backend',quiet=1) and compileall.compile_dir(ROOT/'config',quiet=1) and compileall.compile_file(ROOT/'app.py',quiet=1)
    npm = shutil.which('npm')
    if npm and (WEB/'node_modules').is_dir():
        for script in ('typecheck','lint'):
            ok = subprocess.run([npm,'run',script],cwd=WEB).returncode==0 and ok
    else:
        print('Node.js or frontend/node_modules not found: skipped the web app checks (run npm install in frontend/)')
    ok = subprocess.run([sys.executable,'-m','unittest','discover','-s','tests'],cwd=ROOT).returncode==0 and ok
    print('All checks passed' if ok else 'Some checks failed')
    return 0 if ok else 1


if __name__=='__main__':
    sys.exit(main())
