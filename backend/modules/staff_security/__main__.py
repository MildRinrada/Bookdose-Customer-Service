"""python -m backend.modules.staff_security reset <email>: remove every second factor and passkey of a staff account
and sign it out (for someone who lost both their phone and their recovery codes). Run it on the server only."""
import sys

from backend.database import db as D
from backend.modules.staff_security import service

if __name__=='__main__':
    if len(sys.argv)!=3 or sys.argv[1]!='reset':
        print('usage: python -m backend.modules.staff_security reset <email>')
        sys.exit(2)
    D.init()
    if not service.reset_account(sys.argv[2].strip().lower()):
        print('No staff account with that email.')
        sys.exit(1)
    print('Two-factor sign-in and passkeys removed; the account is signed out everywhere.')
