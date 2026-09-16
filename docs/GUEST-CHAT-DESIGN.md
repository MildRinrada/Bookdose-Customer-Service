# Guest web chat (round 5): shared design — backend and frontend agents both read this first

Repo `C:\Customer Service Github`. Product scope: `docs/SCOPE.md` (customer service only: chat, cases, Q&A — NOTHING about
money, contracts, invoices, schedules). Backend = Python **standard library only** (a FastAPI move comes after this round;
keep services free of HTTP details so it ports cleanly). Match the surrounding style (compact Python, docstrings stating the
rule, Thai user-facing text, English comments, `require(cond,'ข้อความ',status)`). Frontend rules: `frontend/README.md`
(CSP nonce, no `style={}`, no `dangerouslySetInnerHTML`). Never commit/push, never touch `data/`, never stop/restart the
user's servers on :8787 and :3000, no `next build` (the main session builds). Additive migrations only.

## Goal
A customer can chat with an organization on the web **without an account**, and keep following the chat by any of:
1. **This browser, forever (one device only)** — a persistent cookie, refreshed on use (default); can be switched off
   ("เครื่องสาธารณะ ไม่ต้องจำ" → session cookie).
2. **A follow link by email** — for people who have email.
3. **A follow link by SMS** — for people without email. No SMS vendor yet: a pluggable sender with an `off` and a `log`
   (test) provider; the phone option is hidden until the platform turns a provider on.
4. **LINE notifications** — when the organization's LINE OA is connected: the guest sends a 6-digit code to the OA.
Then: **merge the history into an account** on sign-up/sign-in, and an **embed code** so the chat runs on the
organization's own website.

---------------------------------------------------------------------------------------------------------------------------
## 1. Data (tenant database — a guest belongs to one organization)
```
guest_visitors(id PK, contact_id NOT NULL, name, email, email_verified_at, phone, phone_verified_at,
               account_id (set once merged), created_at, last_seen_at)
guest_devices(token_hash PK, visitor_id, csrf, remember INTEGER, user_agent, ip, created_at, last_seen_at)
guest_links(token_hash PK, visitor_id, via CHECK IN ('email','sms'), target, created_at, expires_at, uses, revoked_at)
guest_line_codes(code_hash PK, visitor_id, expires_at, attempts, created_at)
guest_line_links(visitor_id PK, line_user_id UNIQUE, linked_at)
guest_notifications(id PK, visitor_id, conversation_id, channel CHECK IN ('email','sms','line'), created_at, sent_at,
                    attempts, error)                                   -- or extend the existing outbox if cleaner; say which
settings keys: 'guest_chat' {enabled:true}, 'widget' {enabled:false, origins:[], position:'right', theme:'purple', title:''}
control database: platform setting 'sms' {provider:'off'|'log'}
```
The contact made for a guest has source `'guest'`. All tokens: 32 random bytes (urlsafe), stored as SHA-256 only.

## 2. Cookies and CSRF
- Cookie **`g_<org slug>`**, `HttpOnly`, `Path=/api/`. Persistent (`Max-Age` 400 days, the browser cap; re-sent when older
  than a day so it never lapses while used) when `remember`, else a session cookie.
  Same-site page: `SameSite=Lax`. When `server.secure_cookies` is on also `Secure`; the embed iframe on another site needs
  `SameSite=None; Secure; Partitioned` — send that form when the request carries `X-Embed: 1` and secure cookies are on.
- Every changing guest request carries `X-Guest-CSRF` (the device's csrf, returned by GET /guest). Existing Host/Origin
  checks stay.
- Unknown/expired cookie → treated as no guest (the page starts fresh), and the response clears the cookie.

## 3. API (`/api/public/<org>/…`; add `guest|widget` to PORTAL_PATH)
New route scopes in backend/server.py: **`guest`** (req.guest = {visitor, device}, 401 'ไม่พบแชทของคุณในเบราว์เซอร์นี้' when
absent) and **`guest-open`** (no cookie needed; req.guest set when one is present). Both require the organization's
`guest_chat.enabled` (403 'องค์กรนี้ให้เริ่มแชทได้เฉพาะสมาชิกที่เข้าสู่ระบบ').

| method path | scope | body → answer |
|---|---|---|
| GET `/guest` | guest-open | → `{guest: null \| {name, email_masked, email_verified, phone_masked, phone_verified, line_linked, remember, csrf}, conversations:[{id, subject, status, updated_at, unread, survey_pending}], follow:{email_ready, sms_ready, line_ready, line_oa_name, line_add_url}, categories:[...], organization:{name, slug}}` |
| POST `/guest/conversations` | guest-open | `{body, subject?, category?, name?, remember:true, website:''(honeypot), started_ms}` (+ attachments like the portal) → 201 `{id, csrf}` + cookie (reuses the visitor when a cookie is present) |
| GET `/guest/session` | guest | header X-Conversation-ID → same shape as the signed-in portal `/session` |
| POST `/guest/messages`, `/guest/handoff`, `/guest/csat`; GET `/guest/attachments/{id}`, `/guest/cases/{id}` | guest | same bodies/answers as the portal routes, limited to this visitor's conversations |
| POST `/guest/name` | guest | `{name}` |
| POST `/guest/remember` | guest | `{remember:bool}` → re-sets the cookie |
| POST `/guest/link` | guest | `{via:'email'\|'sms', to}` → 202 `{sent:true, to_masked}`; a new link revokes older ones of that via |
| POST `/guest/resume` | guest-open | `{token}` → `{ok:true, conversation_id}` + cookie (new device, remember:true); marks email/phone verified |
| POST `/guest/line-code` / DELETE `/guest/line` | guest | → `{code, expires_at, oa_name, add_url}` / `{ok}` |
| POST `/guest/forget` | guest | forget this browser (device row deleted, cookie cleared) |
| GET `/widget` | portal | → `{enabled, guest_chat, position, theme, title, origins}` (public; the Next proxy reads origins) |
| GET/POST `/api/settings/guest-chat` | workspace, admin | `{guest_chat:{enabled}, widget:{enabled, origins, position, theme, title}}`; origins = up to 10 `https://host[:port]` (plus `http://localhost…` allowed) |
| GET `/api/customer/guest-claims` | customer-account | → `{claims:[{org_slug, org_name, conversations:n}]}` from the `g_*` cookies this browser sends |
| POST `/api/customer/guest-claims` | customer-account | `{org}` → `{moved:n}`: link the guest's contact to the account (`link_contact`), set visitor.account_id, delete its devices, links, clear the cookie |
| GET/POST `/api/platform/sms` | platform | `{provider:'off'\|'log'}` |

Rules:
- **Follow links** open `/chat/<org>/resume#t=<token>` (token in the fragment, never in a query string / server log).
  Valid 30 days, reusable up to 20 times, revoked by a newer link or by a merge. Link requests: 3 per hour per visitor
  and per target, 10 per hour per IP. Email goes through the platform mailbox (`customers.email_ready`); SMS through
  `backend/extensions/sms.py` (`send(cd, phone, text)`; provider `log` writes the text to the server log). Thai phone
  numbers normalised to E.164 (+66…). Email/SMS text: organization name + link, never message content.
- **Notices of replies:** when the team replies in a guest's web conversation and it is unread after the same delay the
  account notices use, send ONE notice per conversation per unread spell on each channel the guest has *proven*
  (email_verified, phone_verified, LINE linked) — the email/SMS carries a fresh follow link, LINE the same. Never notify
  an unproven address. Runs in the existing automation worker loop.
- **LINE:** `take_code` in customers/line.py also accepts guest codes (same attempt limits); a linked LINE user gets the
  notices. `line_add_url` from the OA's basic id when known, else ''.
- **Automatic merge:** when an account's email becomes verified (register/verify) or it signs in, guest visitors of that
  organization with the same **verified** email are merged (same effect as a claim). Device claims need the explicit
  POST (a shared computer must not hand chats to whoever signs in next).
- **Spam:** honeypot `website` must be empty and `started_ms` ≥ 2 s before submit (else 400 with a generic message);
  new conversations: 5 per hour per IP and 10 per day per visitor; messages use the portal's existing limits.
- **Cleanup:** devices unused for 400 days and expired links/codes are deleted by the worker.
- Staff side: the conversation/contact carry `guest:{follow:['browser','email','sms','line']}` so the inbox shows a
  "ผู้เยี่ยมชม" badge and how they can be reached. Existing contact merge keeps working.
- Audit: `guest.started`, `guest.link_sent`, `guest.resumed`, `guest.line_linked`, `guest.claimed` (no tokens, masked targets).
- Tests `tests/test_guest_chat.py`: start without an account; cookie reuse and forget; remember on/off cookie form;
  CSRF required; another visitor's conversation 404; honeypot/timing/rate limits; email link send→resume on a second
  "device"→verified; SMS hidden when off, `log` provider works; link revoked by a newer one and after 20 uses/30 days;
  LINE code links a guest; notices only to proven channels, once per unread spell; claim moves conversations and kills
  old cookies/links; automatic merge by verified email; guest_chat disabled → 403; widget settings admin-only and origin
  validation; another organization's guest never visible.

---------------------------------------------------------------------------------------------------------------------------
## 4. Frontend
- **`/chat/[org]`** (public, no sign-in, both server and client components as the app does elsewhere): organization header,
  welcome, category chips, start form (message, optional name, attach files, "เครื่องสาธารณะ ไม่ต้องจำแชทในเบราว์เซอร์นี้"
  checkbox, hidden honeypot, started time), then the thread — reuse `MessageThread`, the survey-in-thread pattern of
  `ChatView`, AI chatbot / "คุยกับเจ้าหน้าที่". A guest with several conversations sees a compact list to switch.
  A signed-in customer is offered "ไปที่แชทของฉัน" (and the claim banner if this org has a guest cookie).
- **"ติดตามแชทนี้" card** (after the first message, collapsible, also reachable from a menu): four options, each with a
  status line — ✓ จำในเบราว์เซอร์นี้ (switch; off = forget when the browser closes), ส่งลิงก์ทางอีเมล (input + send,
  "ส่งแล้วไปที่ a***@gmail.com"), ส่งลิงก์ทาง SMS (only when `sms_ready`), แจ้งเตือนทาง LINE (only when `line_ready`: the
  code big, "เพิ่มเพื่อน" button when `line_add_url`, countdown). Plus "สมัครสมาชิกเพื่อเก็บประวัติถาวร" link to register with
  `?org=`. And "ลืมแชทในเบราว์เซอร์นี้" (confirm).
- **`/chat/[org]/resume`**: reads `#t=`, POSTs `/guest/resume`, `history.replaceState` to drop the fragment, goes to the
  conversation; clear Thai error when expired ("ลิงก์หมดอายุ ขอลิงก์ใหม่จากแชทเดิม หรือเริ่มแชทใหม่").
- **`/chat/[org]/embed`**: the same chat, compact layout for an iframe (no site header), sends `X-Embed: 1`, talks to the
  parent with `postMessage` (`{type:'bd-chat', unread, open}`) — only to the origins from `/widget`.
- **`public/widget.js`** (plain ES2017, no framework, no inline `<style>` — set `element.style` from JS so it works under
  the host site's CSP): `<script src="https://<host>/widget.js" data-org="<slug>" async></script>` adds a floating button
  (position/theme from `/api/public/<org>/widget`), opens an iframe panel to `/chat/<slug>/embed`, unread badge from
  postMessage (check `event.origin` === our origin), Esc/close button, mobile full-screen, "เปิดในหน้าต่างใหม่" fallback link.
- **Framing:** `/chat/[org]/embed` is the only framable page: `proxy.ts` sets `frame-ancestors` to the org's widget origins
  (fetched from `/api/public/<org>/widget`, cached ~60 s) or `'none'` when disabled; `next.config.ts` must not add
  `X-Frame-Options: DENY` to that path. Every other page stays `frame-ancestors 'none'`.
- **Staff settings → new tab "แชทบนเว็บไซต์"** (admin): switch "ให้ลูกค้าเริ่มแชทได้โดยไม่ต้องเข้าสู่ระบบ", public chat link
  + copy + QR (reuse the QR helper used by join links), widget switch, allowed website origins (chips input), position,
  theme (preset choices, no free colour → no inline styles), title, the embed snippet with a copy button, and a
  "ทดลองดู" link to `/chat/<slug>`.
- **Platform → ระบบ:** SMS provider select (ปิด / ทดสอบ: แสดงข้อความใน log ของเซิร์ฟเวอร์).
- **Customer side:** after sign-in/verify and on `/customer/chats`, when `/api/customer/guest-claims` has rows, a banner
  per organization: "พบแชท N เรื่องที่คุยไว้ก่อนเข้าสู่ระบบกับ <org> — ย้ายเข้าบัญชีนี้" (confirm) → POST.
- **Inbox (staff):** "ผู้เยี่ยมชม" badge on the conversation row/header and contact card, with how they can be reached.
- New CSS: `src/styles/pages/guest-chat.css` (+ import in app/layout.tsx). All text Thai.
- The support-page entry (`/?org=` home / customer login page) gets "แชทโดยไม่ต้องเข้าสู่ระบบ" → `/chat/<org>` when enabled.

## File ownership
| files | owner |
|---|---|
| backend/**, tests/**, README.md (backend sections) | backend agent |
| frontend/** (incl. public/widget.js, proxy.ts, next.config.ts, frontend/README.md) | frontend agent |
The frontend agent codes against the API table above; where a detail is missing, pick the obvious shape and list it in
the report so the main session can reconcile. The backend agent must not change an answer shape from this table without
listing it in its report.

Checks: backend `PYTHONIOENCODING=utf-8 python -m unittest discover -s tests` (only the 3 known Windows '438 != 384'
failures allowed); frontend `npm run typecheck && npm run lint`. Report: what you built, files, test results, deviations
from this design, open issues.
