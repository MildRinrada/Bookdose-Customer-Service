"""Guest web chat: a customer chats with one organization on the web without an account (/chat/<org>, or the widget
on the organization's own website), and keeps following the chat by this browser (a cookie), a follow link by email
or SMS, or LINE notices. Everything a guest is lives in that organization's database.

  guest_visitors       one guest: the contact made for it (created_by 'guest'), the name it gave, the email / phone a
                       follow link was sent to and when opening that link proved it, and account_id once its history
                       moved into a customer account (a merged visitor is kept only as history).
  guest_devices        a browser holding the guest's cookie g_<org slug>: the token (hashed), the CSRF token the page
                       sends back, and whether the cookie outlives the browser (remember).
  guest_conversations  the conversations a visitor started (only these are theirs, even after staff merge contacts).
  guest_seen           when the visitor last read each conversation (a reply read in time is never notified).
  guest_links          follow links /chat/<org>/resume#t=<token> (hashed): 30 days, 20 uses, revoked by a newer link
                       of the same way or by a merge. 'line' links travel inside LINE notices.
  guest_line_codes     6-digit codes for LINE (hashed, 10 minutes; the same limits as an account's codes).
  guest_line_links     the LINE user of the organization's official account a visitor is linked with.
  guest_notifications  notices waiting for the automation worker: a team reply ('reply', one per conversation per
                       unread spell per proven channel) or the confirmation of LINE linking ('linked').

Control database: guest_verified_emails lists the organizations holding a guest with a proven email, so a customer
account with that verified email takes those chats over when it signs in without opening every organization."""
import json

CONTACT_SOURCE = 'guest'
GUEST_NAME = 'ผู้เยี่ยมชม'
COOKIE_PREFIX = 'g_'
COOKIE_MAX_AGE = 400*86400          # the browsers' cap for a cookie's lifetime
COOKIE_REFRESH_SECONDS = 86400      # a remembered cookie is sent again when the device was last seen longer ago
DEVICE_UNUSED_DAYS = 400
LINK_DAYS = 30
LINK_USES = 20
LINE_CODE_MINUTES = 10
START_PER_IP_HOUR = 5
START_PER_VISITOR_DAY = 10
LINKS_PER_VISITOR_HOUR = 3
LINKS_PER_TARGET_HOUR = 3
LINKS_PER_IP_HOUR = 10
MIN_FORM_MS = 2000                  # a start form sent sooner than this after it was shown is a bot
MAX_NOTICE_ATTEMPTS = 3

THEMES = ('purple','blue','green','orange','charcoal')
POSITIONS = ('right','left')
MAX_ORIGINS = 10
DEFAULT_GUEST_CHAT = {'enabled':True}
DEFAULT_WIDGET = {'enabled':False,'origins':[],'position':'right','theme':'purple','title':''}
DEFAULT_SETTINGS = [('guest_chat',json.dumps(DEFAULT_GUEST_CHAT)),('widget',json.dumps(DEFAULT_WIDGET))]

TENANT_TABLES = '''
CREATE TABLE IF NOT EXISTS guest_visitors (
    id TEXT PRIMARY KEY, contact_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    email_verified_at TEXT, phone TEXT NOT NULL DEFAULT '', phone_verified_at TEXT, account_id TEXT,
    created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guest_devices (
    token_hash TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, csrf TEXT NOT NULL, remember INTEGER NOT NULL DEFAULT 1,
    user_agent TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guest_conversations (
    conversation_id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guest_seen (
    visitor_id TEXT NOT NULL, conversation_id TEXT NOT NULL, seen_at TEXT NOT NULL, PRIMARY KEY(visitor_id,conversation_id)
);
CREATE TABLE IF NOT EXISTS guest_links (
    token_hash TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, via TEXT NOT NULL CHECK(via IN ('email','sms','line')),
    target TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, expires_at TEXT NOT NULL, uses INTEGER NOT NULL DEFAULT 0,
    revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS guest_line_codes (
    code_hash TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guest_line_links (
    visitor_id TEXT PRIMARY KEY, line_user_id TEXT NOT NULL UNIQUE, linked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guest_notifications (
    id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL, conversation_id TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL CHECK(channel IN ('email','sms','line')),
    kind TEXT NOT NULL DEFAULT 'reply' CHECK(kind IN ('reply','linked')),
    created_at TEXT NOT NULL, sent_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS guest_visitors_contact ON guest_visitors(contact_id);
CREATE INDEX IF NOT EXISTS guest_visitors_email ON guest_visitors(email);
CREATE INDEX IF NOT EXISTS guest_devices_visitor ON guest_devices(visitor_id);
CREATE INDEX IF NOT EXISTS guest_conversations_visitor ON guest_conversations(visitor_id,created_at);
CREATE INDEX IF NOT EXISTS guest_links_visitor ON guest_links(visitor_id,via);
CREATE INDEX IF NOT EXISTS guest_line_codes_visitor ON guest_line_codes(visitor_id);
CREATE INDEX IF NOT EXISTS guest_notifications_pending ON guest_notifications(sent_at,created_at);
CREATE INDEX IF NOT EXISTS guest_notifications_conversation ON guest_notifications(conversation_id,channel);
'''

CONTROL_TABLES = '''
CREATE TABLE IF NOT EXISTS guest_verified_emails (
    email TEXT NOT NULL, tenant_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(email,tenant_id)
);
'''
