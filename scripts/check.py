#!/usr/bin/env python3
"""Development check: Python syntax, JavaScript syntax (needs Node.js) and the automated tests.
Usage: python scripts/check.py"""
import compileall
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    ok = compileall.compile_dir(ROOT/'backend',quiet=1) and compileall.compile_dir(ROOT/'config',quiet=1) and compileall.compile_file(ROOT/'app.py',quiet=1)
    node = shutil.which('node')
    if node:
        for script in sorted((ROOT/'frontend').rglob('*.js')):
            ok = subprocess.run([node,'--check',str(script)]).returncode==0 and ok
    else:
        print('Node.js not found: skipped the JavaScript syntax check')
    ok = subprocess.run([sys.executable,'-m','unittest','discover','-s','tests'],cwd=ROOT).returncode==0 and ok
    print('All checks passed' if ok else 'Some checks failed')
    return 0 if ok else 1


if __name__=='__main__':
    sys.exit(main())
