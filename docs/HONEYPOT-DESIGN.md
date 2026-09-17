# Honeypot & Honeytoken — shared design

Repo `C:\Customer Service Github`. Builds on the security round (`docs/SECURITY-DESIGN.md`): `backend/modules/security`
(events, alerts, ip_blocks, trusted client IP), `/platform/security` dashboard. Rules as before: never commit/push/change
git state, never touch `data/`, never stop/restart the user's servers on :8787/:3000 or overwrite `scratchpad/web3000`,
additive migrations, Thai UI text, frontend CSP rules, legacy server keeps working.

**Goal:** catch attackers, scanners, bots and insiders early — anyone who touches something no legitimate user ever
touches. Every trap must be **invisible and harmless to real users** (no false positives from normal use) and must answer
exactly like the real thing would (a trap must not reveal that it is a trap).

---------------------------------------------------------------------------------------------------------------------------
## 1. Honeypots (built-in, always on unless switched off in settings)

### 1a. Decoy paths
- **Page paths** (served by Next.js, fixed list in one shared frontend constant): `/.env`, `/.env.local`, `/.git/config`,
  `/wp-login.php`, `/wp-admin`, `/xmlrpc.php`, `/phpmyadmin`, `/pma`, `/admin.php`, `/administrator`, `/server-status`,
  `/actuator/env`, `/config.json`, `/backup.zip`, `/backup.sql`, `/db.sql`, `/.DS_Store`, `/id_rsa`, `/vendor/phpunit`
  (prefix). Next forwards the hit (method, path without query, user agent, trusted client IP) to the backend and answers
  the same 404 page an unknown URL gets today.
- **API paths** (backend, built-in + up to 50 custom ones added by Superadmin, exact or prefix): `/api/admin`,
  `/api/v1/users`, `/api/users/export`, `/api/debug`, `/api/internal/config`, `/api/graphql`, `/api/swagger.json`,
  `/api/.env`. Answer = byte-identical to today's unknown-API 404 (same body, headers, timing path).
- Event `honeypot_path` (warning) `{path, method}`; flood-controlled like other events.
- A decoy path must never shadow a real route (validate custom paths against the route table; refuse overlaps).

### 1b. Hidden form fields
- A visually hidden, `aria-hidden`, `tabindex=-1`, `autocomplete=off` text field with a plausible name (e.g. `company_website`)
  on: shared sign-in, staff registration, customer registration, customer forgot-password, guest chat start (which already
  has `website` — reuse the same mechanism). Plus the existing "filled faster than 2 s" timing check where it exists.
- Filled → event `honeypot_form` (warning) `{form}`; the request is **not processed** but answers what a normal failure
  would (sign-in: the usual 401 wrong-password answer — and it does NOT count towards the email's lockout, so a bot can't
  lock real users; registration/forgot: the usual "sent" success answer; guest: the usual 400 generic message).

## 2. Honeytokens (created by Superadmin)
Table `honeytokens(id, kind, label, placed_at_note, secret_hash, lookup_prefix, decoy_email, created_by, created_at,
enabled, trigger_count, last_triggered_at, last_ip)`. Secrets are stored as SHA-256 only; the plaintext is shown **once**
on creation (copy button). Kinds:

| kind | what Superadmin gets | triggers when |
|---|---|---|
| `decoy_account` | a realistic email (e.g. `it-backup@<platform domain>`), never a real account | anyone tries to sign in with that email (any endpoint, any password), requests a password reset for it, or a staff member tries to invite/add it |
| `api_key` | a realistic key string, e.g. `bdk_live_` + 40 chars | the string appears in `Authorization`, `X-API-Key`, any cookie value, a query parameter, or a JSON body string of any request |
| `password` | a realistic password (e.g. for a planted "backup admin" note) | anyone submits it as a password on any sign-in endpoint, for any email |
| `link` | a URL `https://<host>/files/<random>` looking like a shared file (label e.g. "รหัสผ่านระบบสำรอง.pdf") | the URL is opened (page answers a believable "ไฟล์นี้ถูกย้ายหรือหมดอายุ" page) |

Detection must be cheap: API-key/password scanning keys off `lookup_prefix` (first 12 chars) in memory, loaded at start
and refreshed on change; hash only on a prefix match; body scanning only for JSON bodies already parsed and ≤ 1 MB.
A triggered request answers exactly what it would have answered anyway (401, 404…) — never a special response.

On trigger:
- Event `honeytoken_triggered` (**critical**) `{token_id, kind, label, where}` + `trigger_count`/`last_*` update.
- An alert opens immediately (no threshold; one open alert per token+ip) and platform admins are emailed when the mailbox
  is ready (max one per token per hour).
- **Auto-block** the client IP (setting, default on, 24 h) — except loopback and the IP of a currently signed-in platform
  admin session; the block reason names the token label.
- A staff member signed in when it triggers (insider) is recorded in the event (`user_id`, tenant) — not auto-signed-out.

## 3. Settings (extend `GET/POST /api/platform/security/settings`)
```
honeypot: {paths_enabled:true, forms_enabled:true, custom_api_paths:[{path, match:'exact'|'prefix'}],
           block_on_path_hits:{enabled:true, hits:3, window_minutes:10, duration:'1h'},
           block_on_honeytoken:{enabled:true, duration:'24h'}}
```

## 4. API (platform admins only, audited, `security_settings_changed` event on change)
| method path | body → answer |
|---|---|
| GET `/api/platform/security/honeytokens` | `{tokens:[{id, kind, label, placed_at_note, decoy_email, preview, enabled, created_at, created_by, trigger_count, last_triggered_at, last_ip}]}` (`preview` = first 6 chars + `…`, never the secret) |
| POST `/api/platform/security/honeytokens` | `{kind, label, placed_at_note}` → 201 `{token:{…}, secret}` (`secret` = the key / password / full link / decoy email, shown once) |
| PATCH `/api/platform/security/honeytokens/<id>` | `{label?, placed_at_note?, enabled?}` → `{token}` |
| DELETE `/api/platform/security/honeytokens/<id>` | → `{ok}` |
| POST `/api/platform/security/honeytokens/<id>/test` | records a clearly marked test event (`detail.test=true`, severity info, no block, no email) → `{ok}` |
| POST `/api/trap` | **internal**, only accepted from the Next.js server (same trust rule as the client-IP header; anything else → the normal unknown-API 404): `{path, method, user_agent}` → 204 |
| GET `/files/<token>` | Next page; it calls the backend (internal) to record + returns the believable page |

Overview (`/overview`) gains `cards.honeypot_hits` and `cards.honeytoken_triggers`; events filters gain the new kinds.

## 5. Frontend
- Next.js: decoy page paths → 404 page + background trap report (no delay to the response); `/files/[token]` page;
  hidden honeypot field component used in the listed forms (CSS class, not inline style; excluded from autofill and
  screen readers; never focusable).
- `/platform/security` gets a **"กับดัก"** section/tab:
  - Honeytoken list (kind icon + Thai kind name, label, where planted, created, trigger count, last trigger time/IP,
    enabled switch, test button, delete with confirm).
  - "สร้างกับดัก" dialog: choose kind (with one-line Thai explanation and a suggestion where to plant it), label, note →
    result screen shows the secret once with copy button and a clear warning "จะแสดงครั้งเดียว".
  - Honeypot settings: switches for decoy paths / hidden fields, custom API decoy paths editor (validation message
    for overlaps from the server), auto-block settings.
  - Recent trap events (filtered event log) and the new cards in the overview; Thai labels for new event kinds.

## 6. Tests (`tests/test_honeypot.py`)
Decoy API path answer identical to unknown path (body/status/headers) + event; custom path add/validate/refuse overlap;
`/api/trap` refused unless from the trusted proxy; path-hit auto-block after N hits and never for loopback/admin IP;
hidden field on each form → not processed, normal-looking answer, no lockout count; honeytoken create returns secret
once and stores only hash; each kind triggers (decoy email on sign-in/forgot/invite, api key in header/cookie/query/JSON,
password on any endpoint, link) with critical event + alert + auto-block; triggered request's answer unchanged; disabled
token doesn't trigger; test button creates info event only; platform-only access (org admin 403); real users unaffected
(normal sign-in, registration, guest chat, API calls produce no trap events); works on legacy server where applicable.

## File ownership
| files | owner |
|---|---|
| backend/**, tests/**, README.md (backend), docs/SCOPE.md security rows | backend agent |
| frontend/** | frontend agent |

Checks: backend full suite FastAPI + `BOOKDOSE_SERVER=legacy` (only the 3 known Windows '438 != 384' failures); frontend
`npm run typecheck && npm run lint`. Report: built, files, tests, deviations (exact paths/shapes), open issues.
