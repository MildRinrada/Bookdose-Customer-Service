# Case lifecycle (tickets): the six statuses, who moves them, and what each move sets off

Repo `C:\Customer Service Github`. Scope: `docs/SCOPE.md`. A **case** (`tickets`) is the unit of work; the
**conversations** linked to it (`ticket_conversations`) are where the work is talked about. One conversation belongs to
at most one case; a case may hold several.

A status answers one question: **whose move is it, and is it over?** Everything else about a case — who owns it, how
urgent it is, which team holds it, whether it is paused — lives in its own column and is not a status. Keeping that
line clear is why the list below is short.

## 1. The six statuses

`backend/modules/tickets/model.py` `STATUSES`, Thai in `frontend/src/lib/labels.ts` `statusLabels` (staff) and
`customerStates` (the customer's own words — staff words are not customer words).

| stored | staff see | the customer sees | whose move | in the working queue |
|---|---|---|---|---|
| `new` | ใหม่ | ทีมงานได้รับเรื่องแล้ว | ours, nobody has started | yes |
| `open` | กำลังดำเนินการ | กำลังดำเนินการ | ours, somebody has started | yes |
| `pending_customer` | รอลูกค้า | รอข้อมูลจากคุณ | the customer's | **no** |
| `pending_internal` | รอทีมภายใน | กำลังดำเนินการ | ours, waiting on someone else inside | yes |
| `resolved` | แก้ไขแล้ว | ดำเนินการเรียบร้อยแล้ว | over | no |
| `closed` | ปิดเคสแล้ว | ดำเนินการเรียบร้อยแล้ว | over | no |

The working queue is `repository.WORKING = ('new','open','pending_internal')`: what `รับงานถัดไป` hands out and what
the member's own lists count. A case waiting for the customer is not the member's move, so it is not in it.

`resolved` and `closed` are one state to the system (`DONE = ('resolved','closed')` in
`backend/modules/automation/service.py`): the same survey, the same `resolved_at`, the same exclusion everywhere. They
differ only in the word shown and in the report's split. Nothing reads one and not the other.

## 2. The flow

```
                     ┌──────────────── a customer's reply ─────────────────┐
                     │                                                     │
                     │                  ┌─► รอลูกค้า ──┐                     │
   [ใหม่] ──────────► กำลังดำเนินการ ──┤              ├──► แก้ไขแล้ว ──► ปิดเคสแล้ว
     the team's        ▲                └─► รอทีมภายใน ┘         │             │
     first reply       │                        │                │             │
     (automatic)       └────────────────────────┴────────────────┴─────────────┘
                                        staff, by hand or by Macro
```

Nothing enforces this order. Staff may set any status from any status; the arrows are the path cases take, not a rule
the API applies. Only the two automatic moves are guaranteed.

## 3. Who may change a status

**Staff** — `PATCH /api/tickets/{id}` (`backend/modules/tickets/routes.py`, access `workspace`, so any signed-in member
of the organization). `get_scoped` limits an `agent` to their own team; an `admin` (เจ้าขององค์กร) reaches every team
(`backend/middleware/access.py`). Every change is written to the activity log with before and after
(`audit.record(...,'ticket.updated',...)`).

**The customer** — never directly. There is no customer-facing route that writes a status. What a customer *can* do is
write in the conversation, which reopens the case (§4).

**The system** — the two automatic moves in §4, and Macros, which are a member pressing one button
(`automation/service.py` `run_macro` → `set_ticket_status`; a Macro's `set_status` is any status but `new`,
`MACRO_STATUSES` in `automation/model.py`).

## 4. The automatic moves

These are the only places a status changes without somebody choosing it.

| move | when | where |
|---|---|---|
| `new` → `open` | the team's first reply reaches the customer | `tickets/repository.py` `STARTED`, applied by `set_first_response`, `record_first_response`, `record_first_response_for_message` |
| `pending_customer`, `resolved`, `closed` → `open` | the customer writes in the conversation | `tickets/repository.py` `reopen_for_conversation` ← `conversations/service.py` `store_message` |
| `pending_customer`, `resolved`, `closed` → `open` | the chatbot hands its chat to a person | `tickets/repository.py` `reopen` ← `ai/service.py` |

**`new` → `open`.** A case somebody has answered is a case somebody has started. Only `new` moves: every other status
is one a person chose, and a reply is no reason to undo the choice. What counts as the team's first reply is exactly
what `first_response_at` counts, so the chatbot and system messages (the CSAT survey, handoff notices) never move it —
they are written straight through `conversations.insert_message` and never reach these functions. On LINE, Email and
Facebook the move waits for the provider to accept the message, like `first_response_at` itself; on the support page
and for cases recorded by staff it is immediate. An internal note is not an answer and moves nothing.

A case opened on a conversation the team has already replied in starts as `open` for the same reason — the work began
before the case existed (`tickets/service.py` `open_ticket`).

**The reopen.** `new` is not in the list: a case that was never started cannot be restarted. Every reopen is counted in
`ticket_reopens` with its cause — `customer`, `staff` or `handoff` — which is the report's reopen rate. The rows
outlive a deleted case, so a case restored from the bin keeps its history.

## 5. What a move sets off

- **Into `resolved` / `closed` from anywhere else**: `resolved_at` is stamped (kept if it already had one), and the
  satisfaction survey is posted in the case's conversation once — `after_status_change` → `send_survey`
  (`automation/service.py`). A channel that cannot take a message right now still lets the case close, without a survey.
- **Out of `resolved` / `closed`**: `resolved_at` is cleared and the reopen is counted.
- **Any change**: the activity log, and a realtime event to the staff who may see the case; a *status* change also
  reaches the customer (priority, team and assignee do not — `realtime.ticket(..., public=status changed)`).
- **Nothing touches the SLA.** `first_response_due_at` and `resolution_due_at` are set once when the case is opened,
  from the organization's settings, and no status ever moves them. Lateness is measured against `first_response_at`
  and `resolved_at`, not against the status.

## 6. What is not a status

| | what it is | where |
|---|---|---|
| ผู้รับผิดชอบ (`assignee_id`) | who holds the case, or nobody. Any status can be owned or unowned | `tickets` column |
| พักเคส (`snoozed_until`) | hidden from the working lists until a moment, then handed back. **Status unchanged, SLA clock still running** | `tickets/service.py` snooze |
| ความเร่งด่วน (`priority`) | low / normal / high / urgent | `tickets` column |
| ทีม (`team_id`) | which team sees it; its conversations follow it | `tickets` column |
| ยกระดับ (escalation) | an unanswered case moved to a team lead after N minutes. **Changes the owner, never the status** | `automation/service.py` `escalate_due` |
| ติดตามผล (followups) | a reminder on a date; does not gate anything | `followups` table |
| conversation `status` | open/closed *of the chat*, separate from the case | `conversations` table |

## 7. Deliberate non-rules

- **No ordering is enforced.** A case can go from `closed` straight to `new` if a member picks it. The API validates
  that the value is one of the six and nothing else. Teams work differently and a state machine that refuses a move
  just teaches people to work around it.
- **Taking a case does not start it.** Assignment moves `assignee_id`, not the status: an owner who has not written yet
  is still an unanswered case, which is exactly what the SLA escalation is watching for. The first reply is the event
  that means work happened, so it is the only one that moves the status.
- **Nothing ever puts a case back to `new`** except a member choosing it. `new` means "nobody has started", and once
  somebody has, that is not true again.
