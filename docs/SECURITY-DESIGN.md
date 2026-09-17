# Security round: lockout, session limits, Superadmin security dashboard — shared design

Repo `C:\Customer Service Github`. Scope `docs/SCOPE.md` (customer service only). API = FastAPI via `backend/http/dispatch.py`
(legacy http.server must keep working too), realtime hub in `backend/realtime/`. Rules as before: never commit/push/change
git state, never touch `data/`, never stop/restart the user's servers on :8787/:3000 (own ports + temp data), additive
migrations, Thai user-facing text, frontend CSP rules (no `style={}`, no `dangerouslySetInnerHTML`).

Actors: **staff** (organization members, `backend/modules/auth`), **platform admins / Superadmin** (whatever marks a
platform member today), **customers** (`backend/modules/customers` + `customer_security` 2FA/passkeys), **guests**.

---------------------------------------------------------------------------------------------------------------------------
## 1. Progressive lockout after repeated wrong passwords
- Stored in the control database (survives restarts): `login_failures(key PK, failures, window_start, locked_until,
  level, last_ip, updated_at)`. Key = `staff:<normalised email>` / `customer:<normalised email>` — **by the email typed,
  whether or not an account exists**, so answers never reveal which emails are registered.
- **Shared sign-in page** (`/login`): `POST /api/sign-in {email, password}` (public, `login` rate limit) checks the staff and
  the customer account of the email in one request, key `signin:<normalised email>`. Both password hashes always run
  (dummy hash for a missing account). Neither matches → one failure + one `login_failed` (actor of the existing account,
  staff first, else `anonymous`); the lock mail goes to the owners of the accounts that exist. Staff wins when both match.
  Answer: `{ok, kind:'staff'}` + staff session cookie, or `{ok, kind:'customer', signed_in}` + customer cookie, or
  `{ok, kind:'customer', two_factor, methods}` + second-step cookie (whose failures count on `customer:` as before).
  A lock on any of `signin:` / `staff:` / `customer:` of one email refuses all three (no extra guesses by switching
  endpoints); a customer password reset and a Superadmin unlock clear all three.
- Counts: wrong password, wrong 2FA / recovery code (customer), and any other sign-in secret check the actor has.
  Existing per-IP in-memory limits stay as they are.
- Rule: 5 failures inside 15 minutes → locked. Lock length by `level`: 1 → 5 min, 2 → 15 min, 3 → 1 h, 4+ → 24 h.
  `level` drops by one for every 24 h without a new lock. A successful sign-in clears `failures` (not `level`).
- While locked every attempt (right or wrong password) answers **429** `{"error":"ลงชื่อเข้าใช้ผิดหลายครั้ง กรุณาลองใหม่ในอีก N นาที","retry_after":seconds}`
  with a `Retry-After` header — identical for unknown emails. Attempts during a lock don't extend it.
- Unlock: the lock ends by itself; a completed password reset for that email clears it; a Superadmin can unlock.
- On a new lock: security event (section 3) and, when the platform mailbox is ready, one email to the account owner
  ("มีการพยายามเข้าสู่ระบบบัญชีของคุณ…" with time, masked IP, how to reset) — at most one per 24 h per account.

## 2. Session limits (idle + absolute)
- Platform security settings (control DB, Superadmin-editable), defaults:
  | actor | idle timeout | absolute lifetime |
  |---|---|---|
  | staff | 60 min | 12 h (today's value) |
  | platform admin session | 30 min | 8 h |
  | customer | 7 days | 30 days (today's value) |
  Bounds: idle 5 min – 30 days, absolute 1 h – 90 days, idle ≤ absolute.
- Add `created_at` and `last_active_at` to staff and customer sessions (additive; existing rows get "now" on upgrade).
  A session is valid only if `now < created_at + absolute` and `now < last_active_at + idle`.
- **Background traffic must not keep a session alive**: polling GETs and realtime sockets do not refresh
  `last_active_at`. Activity = any non-GET request, or `POST /api/session/activity` (staff) /
  `POST /api/customer/activity` (customer) which the page sends at most once a minute while the user is actually using
  it (keyboard, pointer, focus). Both answer `{idle_expires_at, absolute_expires_at}`; `GET /api/session` and
  `GET /api/customer/account` (existing) include the same two fields.
- Expired session → 401 `{"error":"หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบอีกครั้ง","reason":"idle"|"absolute"}`; the row is deleted;
  realtime sockets for it close 4401 at their next re-check.
- Guest browser cookies are not sessions and are unchanged.
- Superadmin can end all sessions of one staff user or customer account from the dashboard.

## 3. Security events + Superadmin dashboard
### Events
Control DB `security_events(id, at, kind, severity CHECK IN ('info','warning','critical'), actor CHECK IN
('staff','platform','customer','guest','anonymous'), subject, tenant_id, ip, user_agent, count, detail JSON)`, index on
`(at)`, `(kind, at)`, `(ip, at)`. Kept 90 days (worker cleanup). `subject` = the email/user typed (Superadmin needs it to
unlock); never store passwords, codes, tokens or message text. Flood control: identical (kind, ip, subject) within the
same minute increments `count` instead of inserting a row; at most 1000 new rows per minute overall (then only counts).

Recorded kinds (hook them where the check already happens):
`login_failed`, `login_locked` (warning), `login_after_lock` (successful sign-in right after a lock, info),
`twofa_failed`, `password_reset_requested`, `password_reset_completed`, `session_expired` (idle/absolute, info),
`sessions_revoked`, `rate_limited` (area), `csrf_rejected`, `origin_rejected` (HTTP Host/Origin and WebSocket 4403),
`cross_tenant_denied` (a member touching another organization's data / support access refused), `support_access`
(platform admin entering an organization, info), `webhook_signature_failed` (LINE/Facebook), `guest_link_invalid`,
`ip_blocked_request`, `admin_unlock`, `admin_ip_block`, `security_settings_changed` (critical).

### Alerts
Rules checked by the worker every minute (thresholds editable in security settings):
- ≥ 30 `login_failed` from one IP in 10 min → **warning**; ≥ 100 across the platform in 10 min → **critical**.
- ≥ 10 accounts locked in 1 h → critical. ≥ 200 `rate_limited` from one IP in 10 min → warning.
- Any `webhook_signature_failed` burst ≥ 20 in 10 min → warning.
An alert = row in `security_alerts(id, rule, severity, started_at, last_seen_at, count, ip, detail, acknowledged_by,
acknowledged_at)` (one open alert per rule+ip, updated while it continues). New critical alert → email to platform admins
when the mailbox is ready (max one per rule per hour).

### IP block list
`ip_blocks(ip PK, reason, created_by, created_at, expires_at)`; Superadmin adds 1 h / 24 h / 7 d / permanent, removes any.
Checked first in dispatch (and WebSocket handshake) → 403 `{"error":"ไม่สามารถเข้าถึงระบบได้จากเครือข่ายนี้"}` +
`ip_blocked_request` event (flood-controlled). Uses the same trusted client-IP logic as rate limiting (never a raw
`X-Forwarded-For` from the internet). A Superadmin cannot block the IP of their own current request.

### API (scope 'platform', platform admins only; every change audited + `security_settings_changed`/`admin_*` event)
| method path | answer |
|---|---|
| GET `/api/platform/security/overview?range=24h\|7d` | `{cards:{failed_logins, locked_now, rate_limited, origin_csrf_rejected, cross_tenant_denied, open_alerts}, series:[{at, failed_logins, rate_limited, rejected}], top_ips:[{ip, events, failed_logins, blocked}], top_subjects:[{subject, actor, failures}]}` (hourly buckets for 24h, 6-hourly for 7d) |
| GET `/api/platform/security/events?kind=&severity=&actor=&ip=&tenant=&q=&before=&limit=50` | `{events:[{id, at, kind, severity, actor, subject, tenant_name, ip, user_agent, count, detail}], next_before}` |
| GET `/api/platform/security/locks` / POST `/api/platform/security/locks/unlock {key}` | `{locks:[{key, actor, subject, failures, level, locked_until, last_ip}]}` / `{ok}` |
| GET `/api/platform/security/alerts?open=1` / POST `/api/platform/security/alerts/<id>/ack` | `{alerts:[…]}` / `{ok}` |
| GET/POST/DELETE `/api/platform/security/ip-blocks` | `{blocks:[{ip, reason, created_by, created_at, expires_at}]}`; POST `{ip, reason, duration:'1h'\|'24h'\|'7d'\|'permanent'}`; DELETE `{ip}` |
| POST `/api/platform/security/revoke-sessions` | `{actor:'staff'\|'customer', subject:<email>}` → `{revoked:n}` |
| GET/POST `/api/platform/security/settings` | `{sessions:{staff:{idle_minutes, absolute_hours}, platform:{…}, customer:{idle_days, absolute_days}}, alerts:{ip_failed_logins_10m, platform_failed_logins_10m, locks_1h, ip_rate_limited_10m, webhook_failures_10m}}` |

Tests `tests/test_security_round.py`: lockout progression + levels + decay; identical 429 for unknown email; lock not
extended by attempts; success clears failures; reset clears lock; admin unlock; customer 2FA failures count; idle expiry
not refreshed by GET polling or realtime but refreshed by activity/non-GET; absolute expiry; platform shorter limits;
settings bounds; events recorded for each hooked kind; flood aggregation; alert opening/updating/ack; IP block (HTTP and
WebSocket), expiry, can't block own IP; every endpoint platform-only (staff admin gets 403); revoke sessions.

---------------------------------------------------------------------------------------------------------------------------
## 3b. Round 2: data trust (support access, sealed secrets, staff 2FA, proven emails)

### Support access with the organization's consent (`backend/modules/support_access`)
- `POST /api/platform/tenants/{id}/support-access {reason, hours ∈ 1,4,8,24,72}` creates a **pending** request; nothing
  can be read yet. The organization's admins get an email (platform mailbox) and a banner on every staff screen.
- Admins (`role=admin`, permanent membership) decide at `GET /api/support-access`, `POST …/{id}/approve {hours ≤ asked, note}`,
  `…/deny`, `…/end`. The platform admin can `DELETE /api/platform/support-access/{id}` (withdraw, or leave early).
- Approval makes/reactivates the membership as manager with `memberships.expires_at`. **Every membership query ignores a
  row past `expires_at`**, so access ends on the minute; the automation worker then marks it `expired`, sets `active=0`
  and unassigns cases. Undecided requests lapse after 24 h. A permanent membership is never touched.
- Audit: `tenant.support_requested|access|denied|ended|cancelled|expired` in both the platform and the organization log;
  security event `support_access` on approval.

### Sealed secrets (`backend/utils/secret_box.py`, dependency `cryptography`)
- AES-256-GCM, format `bdsec1.<key id>.<base64url(nonce+ciphertext+tag)>`, associated data = the file name
  (`<tenant>.line.json` …) or `customer_totp:<id>` / `staff_totp:<id>`, so a value moved elsewhere does not open.
- Key: `BOOKDOSE_SECRET_KEY` (base64 32 bytes; `python -m backend.utils.secret_box new-key`), else `data/keys/secret.key`
  (0600, outside `data/secrets`, never in backups). `BOOKDOSE_SECRET_KEY_OLD` (comma list) still opens old values, which
  are re-sealed on read. Plain files and TOTP rows from before are sealed at start (`D.init`). A value that does not open
  reads as "not configured" (logged) rather than crashing every request.

### Staff two-factor sign-in and passkeys (`backend/modules/staff_security`)
- Tables `staff_totp` (sealed), `staff_recovery_codes`, `staff_passkeys`, `staff_challenges`, `staff_login_challenges`.
- `/api/sign-in` and `/api/login`: a right password on an account with TOTP answers `{two_factor, methods}` plus the
  `bookdose_staff_2fa` cookie (5 min, 5 tries); `POST /api/login/verify {code|recovery_code}` gives the session. Wrong codes
  count on `staff:<email>` (which also locks `signin:<email>`).
- Settings at `/api/account/security` (state, totp setup/confirm/disable, recovery codes, passkeys options/add/rename/remove);
  adding or removing a way in costs the password. Page: `/account/security` (link in จัดการบัญชี).
- One passkey button on the sign-in page: `POST /api/sign-in/passkey/options` stores the challenge for both kinds,
  `POST /api/sign-in/passkey` answers `{kind:'staff'|'customer'}` with that kind's session.
- The platform overview warns a platform admin whose account has neither TOTP nor a passkey, and when the key is a file.
- Lost phone and codes: `python -m backend.modules.staff_security reset <email>` on the server.

### Emails only to proven addresses
- Reply notices: re-checked at send time (`customer_accounts.email_verified`), not only when queued.
- Lock notices: skipped for a customer account whose email was never proven. Guest emails already required proof.

## 4. Frontend
- **Sign-in screens** (staff login, customer login, customer 2FA step): show the 429 lock message with a live countdown
  from `retry_after`, disable the submit button meanwhile, link to "ลืมรหัสผ่าน".
- **Idle handling** (staff shell, platform, customer shell): an activity tracker (keydown/pointerdown/focus, passive,
  throttled) posts the activity endpoint at most once a minute while the user is active. Two minutes before
  `idle_expires_at` show an accessible dialog "คุณยังใช้งานอยู่ไหม" with a countdown and "ใช้งานต่อ" (posts activity) /
  "ออกจากระบบ". On 401 with `reason` go to the login page with a notice ("หมดเวลาเนื่องจากไม่ได้ใช้งาน" /
  "ครบเวลาการเข้าสู่ระบบ กรุณาเข้าสู่ระบบใหม่") and keep the return URL. Polling/realtime must never post activity.
- **Platform → ความปลอดภัย** (`/platform/security`, new nav item for platform admins):
  - Open alerts banner at top (severity colour, acknowledge).
  - Range switch 24 ชม. / 7 วัน; stat cards; a time-series chart (reuse the app's `ChartColumn` or existing chart
    component, stacked or grouped: เข้าสู่ระบบล้มเหลว / ถูกจำกัดคำขอ / ถูกปฏิเสธ).
  - Top IPs table with "บล็อก" action; top targeted accounts.
  - Locked accounts table with "ปลดล็อก" (confirm).
  - Events log with filters (ประเภท, ระดับ, ผู้ใช้กลุ่ม, IP, องค์กร, คำค้น), Thai labels for every kind, "โหลดเพิ่ม" paging,
    row detail drawer.
  - IP block list management (add with duration + reason, remove).
  - "ยุติเซสชันทั้งหมดของบัญชี" form (actor + email, confirm).
  - Settings form: session limits per actor and alert thresholds, with bounds validation, toggles/switches style as elsewhere.
- Thai labels in one `labels.ts`; responsive to 360 px; tables in `overflow-x:auto` wrappers; CSS in
  `src/styles/pages/security.css`.

## File ownership
| files | owner |
|---|---|
| backend/**, tests/**, README.md (backend), docs/SCOPE.md security rows | backend agent |
| frontend/** (incl. frontend/README.md) | frontend agent |

Checks: backend full suite on FastAPI and with `BOOKDOSE_SERVER=legacy` (only the 3 known Windows '438 != 384' failures);
frontend `npm run typecheck && npm run lint`. Report: what you built, files, tests, deviations from this design (exact
paths/shapes), open issues.
