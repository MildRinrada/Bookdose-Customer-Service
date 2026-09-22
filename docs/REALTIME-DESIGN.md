# Realtime chat (FastAPI phase 2a): shared design — backend and frontend agents read this first

Repo `C:\Customer Service Github`. Scope: `docs/SCOPE.md` (customer service only). The API runs on FastAPI/uvicorn
(`backend/asgi.py`, one dispatch layer in `backend/http/dispatch.py`; plan in `docs/FASTAPI-MIGRATION.md`). The legacy
`http.server` (`BOOKDOSE_SERVER=legacy`) has no WebSocket — the frontend must keep working there by polling.
Rules as before: never commit/push/change git state, never touch `data/`, never stop/restart the user's servers on :8787
and :3000 (use your own ports + temporary data), additive migrations, Thai user-facing text, frontend CSP rules
(no `style={}`, no `dangerouslySetInnerHTML`).

## Principle: the socket carries hints, the REST API carries data
Events say *what changed*; the page refetches it through the existing endpoints (TanStack Query invalidation). All
permission and ownership rules stay in the REST layer. Events never contain message text, attachment names, internal
notes, emails or phone numbers. Only `typing` and `read` are shown straight from the event.

## 1. Endpoints (WebSocket, same origin through Next.js :3000)
| path | who | auth at handshake |
|---|---|---|
| `/api/realtime/staff` | staff member in their current workspace | staff session cookie, same workspace resolution as HTTP |
| `/api/realtime/customer` | signed-in customer (all joined organizations) | customer session cookie |
| `/api/public/<org>/guest/realtime` | guest of one organization | guest cookie `g_<org>`; org must have guest chat on |

- Check `Host` like HTTP and **`Origin` must equal our own origin** (cross-site WebSocket hijacking); else close 4403.
- No/invalid session → close **4401**. Session re-checked every 60 s (signed out / revoked / member removed → 4401).
- A cookie is the only credential; nothing secret in the URL.
- Limits: 5 sockets per session/device, incoming frames ≤ 2 KB, ≤ 20 frames per 10 s (else close 4429).
- Server pings `{"type":"ping"}` every 25 s; idle socket without any frame for 70 s is closed.
- uvicorn: turn WebSocket on (`ws` implementation pinned in requirements.txt, e.g. `websockets`), keep one worker.

## 2. Messages
Server → client (JSON text frames):
```
{"type":"hello","poll_ms":60000}
{"type":"changed","scope":"conversation","id":"<conversation id>","org":"<slug>"}   # new public message, status, CSAT, AI state
{"type":"changed","scope":"conversations","org":"<slug>"}                           # staff list: new / assigned / closed; customer & guest: their list
{"type":"changed","scope":"ticket","id":"<ticket id>","org":"<slug>"}               # staff + the case's customer
{"type":"changed","scope":"tickets","org":"<slug>"}                                 # staff
{"type":"changed","scope":"alerts"}                                                 # customer overview / bell
{"type":"typing","conversation_id":"<id>","org":"<slug>","who":"staff"|"customer","name":"<display name>","ttl_ms":6000}
{"type":"here","conversation_id":"<id>","org":"<slug>","user_id":"<member id>","name":"<name>","typing":false,"ttl_ms":25000,"typing_ms":6000}
{"type":"read","conversation_id":"<id>","org":"<slug>","by":"staff"|"customer","at":"<ISO time>"}
{"type":"ping"}
```
Client → server: `{"type":"typing","conversation_id":"<id>"}` (client throttles to one per 3 s while the composer has
text), `{"type":"viewing","conversation_id":"<id>"}` (staff pages only, every 15 s while the conversation is open and
the tab is in front) and `{"type":"pong"}`. The server ignores either unless the sender may reply in that conversation,
and passes at most one of each per conversation per 2.5 s.

## 3. Who receives what (backend)
- Staff events go to members of that tenant who may see the conversation/ticket under the existing visibility rules.
- Customer/guest events go only to the accounts/visitors that own that conversation (customer contacts, `guest_conversations`).
- **Internal notes, staff-only status fields and staff typing in the note box never produce customer/guest events.**
  Staff typing name shown to customers = the name the customer already sees on staff replies.
- `here`: to the rest of the team only, never to the customer or a guest. It answers "somebody is already on this one"
  so two members do not reply to the same customer at once; it locks nothing and only lives in the open sockets, so a
  closed tab stops saying it within `ttl_ms`. A member's own `here` comes back to them and their page ignores it,
  which is also how one member with two browsers counts as one person.
- `read`: to staff when the customer/guest opens the conversation (existing `mark_seen` / `guest_seen`); to the customer/
  guest when a staff member opens the conversation after the customer's last message (add an additive staff-read record
  if none exists).
- Publish from the service layer at the points that already change data (store_message for every channel incl. AI,
  LINE/Facebook/email inbound in workers, status/assignee/team changes, ticket create/update, CSAT, mark_seen), and only
  **after the transaction commits** (e.g. an after-commit hook on the connection); a rolled-back change sends nothing.
- A thread-safe in-process hub (`backend/realtime/`) bridges worker threads/request threads to the asyncio loop
  (`loop.call_soon_threadsafe`). Single worker process — document that multi-worker would need a broker.
- The legacy server imports nothing that needs asyncio; publishing is a no-op there.
- Tests `tests/test_realtime.py` (skip cleanly under `BOOKDOSE_SERVER=legacy`): handshake auth for all three kinds,
  bad Origin 4403, no cookie 4401, revoked session closes, customer receives `changed` for a staff public reply but not
  for an internal note, another organization's / another customer's events never arrive, guest only its own
  conversations, typing permission and rate limit, read events both ways, event only after commit, LINE inbound from a
  worker thread reaches staff, frame size / count limits.

## 4. Frontend
- `src/lib/realtime.ts` + a `RealtimeProvider` mounted in the staff shell, the customer shell, and the guest chat
  (full page and embed): connect `ws(s)://<same host>/…`, exponential backoff 1 s → 30 s with jitter, pause while the tab
  is hidden for > 5 min, resume on focus. Expose `connected`.
- Map `changed` events to query invalidation of the matching keys (conversation detail/session, lists, ticket detail,
  customer overview/alerts, guest `/guest`). Debounce bursts (~150 ms per key).
- While `connected`: slow the existing `refetchInterval`s to 60 s (safety net). Disconnected or legacy server: keep the
  current intervals. No behaviour change when WebSocket is unavailable.
- **Typing indicator** in `MessageThread`: "กำลังพิมพ์…" bubble (animated dots via CSS classes) on the other side for
  `ttl_ms`; composer sends throttled `typing` frames only for public replies (never from the staff internal-note mode).
- **Who else is here** (`features/inbox/components/ColleaguesHere`): a strip between the thread and the composer on the
  staff inbox and case screens — "ณัฐ เปิดแชทนี้อยู่", or amber "ณัฐ กำลังพิมพ์ตอบอยู่" — and nothing at all when the
  member is alone or the connection is down.
- **Read receipt**: small "อ่านแล้ว" under the sender's latest message once the other side has read it (customer/guest
  see staff read; staff see customer read). Accessible text, no layout jump.
- **Widget unread** keeps working through the embed page (update the badge from events instead of polling).
- **Next.js proxy:** WebSockets must work through :3000 → :8787 with the production standalone build. Verify with a real
  `next build` output started on a spare port against your own FastAPI on a spare port (this agent MAY build into a copy
  or a temp dist dir, but must not replace the user's `scratchpad/web3000`). If Next's rewrite does not forward upgrades,
  add the smallest robust solution (e.g. a tiny `frontend/server.mjs` wrapper around the standalone server that proxies
  `/api/realtime` and `/api/public/*/guest/realtime` upgrades) and document the new start command. `proxy.ts` CSP
  `connect-src` must allow the same-origin `ws:`/`wss:` URL.

## File ownership
| files | owner |
|---|---|
| backend/**, tests/**, requirements.txt, README.md (backend), docs/FASTAPI-MIGRATION.md | backend agent |
| frontend/** (incl. any server wrapper, proxy.ts, frontend/README.md) | frontend agent |

Checks: backend full suite on FastAPI **and** `BOOKDOSE_SERVER=legacy` (only the 3 known Windows '438 != 384' failures);
frontend `npm run typecheck && npm run lint`. Report: what you built, files, test results, deviations from this design
(especially any change to endpoint paths or event shapes), exact start commands, open issues.
