# แผนย้ายเซิร์ฟเวอร์ไปใช้ FastAPI

สถานะ: **ระยะที่ 1 เสร็จแล้ว** (16 กันยายน 2026) · เซิร์ฟเวอร์หลักคือ FastAPI บน uvicorn ·
`http.server` เดิมยังเปิดได้ด้วย `BOOKDOSE_SERVER=legacy` · **ระยะที่ 2a (Realtime ผ่าน WebSocket) ฝั่ง backend เสร็จแล้ว** ·
ส่วนที่เหลือของระยะที่ 2 และระยะที่ 3 ยังไม่เริ่ม

---

## 1. เป้าหมาย

ย้ายฝั่งเซิร์ฟเวอร์จาก `http.server` ที่เขียนเองไปเป็น **FastAPI บน uvicorn** เพื่อให้ได้ web server ระดับ production
โดย **ไม่เปลี่ยนพฤติกรรมของ API ที่หน้าเว็บและลูกค้าใช้อยู่แม้แต่จุดเดียว** (URL, ข้อความ error, cookie, header,
ลำดับการตรวจสิทธิ์ต้องเหมือนเดิมทุกอย่าง)

**นอกขอบเขต** (ทำทีหลัง แยกเป็นงานของตัวเอง)
- เปลี่ยนโค้ดเข้ารหัสที่เขียนเองไปใช้ไลบรารีมาตรฐาน (`cryptography`, `webauthn`, `pyotp`)
- ย้าย SQLite ไป PostgreSQL
- รันหลาย worker หรือหลายเครื่อง

---

## 2. สิ่งที่พบจากการสำรวจ (นับใหม่หลังตัดขอบเขตและเพิ่มแชทผู้เยี่ยมชม)

| หัวข้อ | ที่พบ | ผลต่อการย้าย |
|---|---|---|
| จำนวน API | **166 route** ใน 13 ระดับสิทธิ์ (workspace 68, customer-account 29, platform 16, guest 12, customer-public 11, customer 10, public 5, account 5, guest-open 3, portal 2, page 2, webhook 2, session 1) · GET 54, POST 86, PATCH 14, DELETE 12 | ต้องทำงานเหมือนเดิมครบทุก route |
| สิ่งที่ controller ใช้จาก `req` | `send`, `send_download`, `db`, `cd`, `ctx`, `body`, `customer`, `org`, `guest`, `guest_stale`, `session`, `ip`, `query`, `headers` (`get` และ `in`), `command`, `client_address`, `server.secure_cookies`, `server.server_address`, `response_headers`, `rfile.read` (webhook) | สร้าง object หน้าตาเดียวกันได้ controller ไม่ต้องแก้ |
| service / repository | ไม่รู้จัก HTTP เลย | ไม่ได้แตะ |
| งานเบื้องหลัง | 3 worker, 4 thread: `bookdose-ai`, `bookdose-channels` + `bookdose-email`, `bookdose-automation` (SLA เตือน ประกาศ ล้างข้อมูล) | เริ่มใน lifespan ของ FastAPI ครั้งเดียวต่อ process |
| การจำกัดคำขอ | เก็บในหน่วยความจำของ process (`rate_limit.py`) | รันได้แค่ 1 worker |
| ชุดทดสอบ | **168 รายการ** ยิงผ่าน HTTP จริง | ใช้ตรวจความเหมือนเดิมได้ทันที |
| Python | 3.10.11 | รองรับ FastAPI 0.141 |

---

## 3. แนวทาง: ย้ายเป็น 3 ระยะ ไม่รื้อทีเดียว

### ระยะที่ 1 — เปลี่ยนตัว server แต่ controller เดิมทั้งหมด ✅ เสร็จแล้ว

```text
ก่อน:  http.server ──► Handler.route_request() ──► controller(req)
หลัง:  uvicorn ──► FastAPI (route เดียว /{path}) ──► dispatch(RequestAdapter) ──► controller(req)
       http.server ──► Handler (Exchange) ─────────────┘   (BOOKDOSE_SERVER=legacy)
```

**โครงสร้างที่ได้**

| ไฟล์ | หน้าที่ |
|---|---|
| `backend/http/dispatch.py` | ตาราง route (`ROUTES`), ลำดับ middleware ตามระดับสิทธิ์ (page → webhook → portal/guest/customer → public → session → account → platform → workspace), `Exchange` (`send`, `send_download`, `json_body` ขนาด 8 MB และ 415) และ `dispatch(req)` ที่จับ error เป็น `{error}` ภาษาไทย บันทึก `monitor` และ log |
| `backend/http/adapter.py` | `RequestAdapter`: `req` ของคำขอ ASGI · อ่าน body จาก event loop เฉพาะตอน controller ขอ (ตรวจ Content-Type/ขนาดก่อนเหมือนเดิม, webhook ได้ byte ดิบ) · รอ body ไม่เกิน 30 วินาที · header อ่านแบบไม่สนตัวพิมพ์ ค่าแรกชนะ ถอดรหัส ISO-8859-1 เหมือน `http.server` · ลด `//` ต้น path เหมือน `http.server` |
| `backend/asgi.py` | `create_app()` ของ FastAPI: route เดียวรับทุก path, ปิด `/docs` `/redoc` `/openapi.json`, แทนหน้า 404/405/422/500 ของ FastAPI ด้วยคำตอบรูปแบบเดิมพร้อม security header, lifespan เริ่ม/หยุด worker, thread pool 100 คำขอพร้อมกัน · `uvicorn_config()`: 1 worker, `proxy_headers=False`, ไม่มี access log ของ uvicorn, ไม่มี header `Server`, h11, header รวมไม่เกิน 64 KB |
| `backend/server.py` | `Handler` ของ `http.server` เหลือแค่เขียนคำตอบลง socket แล้วเรียก `dispatch()` ตัวเดียวกัน |
| `backend/workers.py` | `start_workers()` / `stop_workers()` ใช้ร่วมกันทั้งสองเซิร์ฟเวอร์ กันเริ่มซ้ำใน process เดียว |
| `app.py` | ตัวเลือกเดิมครบ (`--host`, `--port`, `--secure-cookies`, `--backup`, `--restore`) · เลือกเซิร์ฟเวอร์จาก `BOOKDOSE_SERVER` (`fastapi` ค่าเริ่มต้น, `legacy`) |
| `config/settings.py` | `SERVER` จาก `BOOKDOSE_SERVER` |

**แพ็กเกจ** (`requirements.txt` ล็อกตรงตัว): `fastapi==0.141.1`, `uvicorn==0.53.0`, `starlette==1.6.0`, `anyio==4.15.1`,
`h11==0.16.0` (pydantic 2.13.5 ติดมากับ FastAPI) · `render.yaml`, `Start Bookdose.bat` และ `Start Bookdose.command`
เพิ่มขั้น `pip install -r requirements.txt`

**วิธีเปิด**

```sh
python -m pip install -r requirements.txt
python app.py --port 8787                       # FastAPI บน uvicorn
BOOKDOSE_SERVER=legacy python app.py --port 8787  # ย้อนกลับไป http.server เดิม
```

**ผลทดสอบ**

| ชุด | FastAPI (ค่าเริ่มต้น) | http.server (`BOOKDOSE_SERVER=legacy`) |
|---|---|---|
| `python -m unittest discover -s tests` (168 รายการ) | ผ่าน 165 · ไม่ผ่าน 3 รายการสิทธิ์ไฟล์บน Windows (`438 != 384`) | ผ่าน 165 · ไม่ผ่าน 3 รายการเดียวกัน |

3 รายการที่ไม่ผ่านบน Windows ทั้งสองเซิร์ฟเวอร์ (เป็นมาก่อนการย้าย): `test_ai.AITests.test_migration_idempotent_defaults_and_key_protection`,
`test_app.IntegrationTests.test_verification_settings_permissions_missing_config_and_secret_redaction`,
`test_channels.ChannelTests.test_secrets_permissions_and_backup`

ชุดทดสอบเปิดเซิร์ฟเวอร์ตาม `BOOKDOSE_SERVER` เหมือน `app.py` (`tests/test_app.py` → `start_server()`; FastAPI รันบน uvicorn จริงใน thread)

**สคริปต์เทียบคำตอบ** (ยิงลำดับคำขอเดียวกันไปทั้งสองเซิร์ฟเวอร์ แต่ละคู่ใช้สำเนาข้อมูลชุดเดียวกัน): ทุก 166 route
× 4 ตัวตน (ไม่เข้าสู่ระบบ, เจ้าหน้าที่ผู้ดูแล, ลูกค้าที่เข้าสู่ระบบ, ผู้เยี่ยมชม) = 664 คู่ status, header และ body
(ตัด id/token/เวลา) ตรงกันทั้งหมด ต่างเฉพาะค่าสุ่มในข้อมูล (token ยืนยัน Facebook, ลิงก์เชิญ, ตัวนับ uptime)
ไฟล์ดาวน์โหลด (ไฟล์แนบฝั่งทีมและลูกค้า ชื่อไฟล์ภาษาไทย, CSV, ZIP สำรององค์กร) ได้ `Content-Type`,
`Content-Disposition`, `Content-Length` ตรงกัน กรณีขอบ 27 กรณีตรงกันทั้งหมด ยกเว้นที่อยู่ในตารางความต่างด้านล่าง เช่น path ที่ไม่ใช่ `/api`, Content-Type ผิด (415),
JSON ผิด/เป็น array/ไม่ใช่ UTF-8 (400), ขนาดเกิน 8 MB, body ว่าง และ chunked (413), Host ปลอม (403), Host มี `/`
และไม่มี Host (400), Origin อื่น (403), `//api/...`, path เข้ารหัส %, URL เต็มใน request line, webhook LINE ไม่มี body /
ใหญ่เกิน / ลายเซ็นผิด, Facebook verify, ลิงก์ไฟล์ชั่วคราว และ `X-Forwarded-For` ปลอมไม่ช่วยหลบการจำกัดการเข้าสู่ระบบ

**ความต่างที่เหลือ (ตั้งใจหรือเลี่ยงไม่ได้)**

| กรณี | http.server | FastAPI |
|---|---|---|
| method อื่น (PUT, HEAD, OPTIONS, TRACE) | 501 หน้า HTML ภาษาอังกฤษ ไม่มี security header | 501 `{"error": "ไม่รองรับคำขอแบบนี้"}` พร้อม security header |
| `Content-Length` ไม่ใช่ตัวเลข | 400 `ข้อมูลไม่ถูกต้อง` | 400 ข้อความ `Invalid HTTP request received.` จาก uvicorn (h11 ปฏิเสธก่อนถึงแอป) หน้าเว็บ Next.js ไม่ส่งแบบนี้ |
| ส่ง body ไม่ครบเกิน 30 วินาที | ปิดการเชื่อมต่อโดยไม่ตอบ | 500 ข้อความกลาง + `Connection: close` (ไม่นับใน monitor) |
| ชื่อ header ในคำตอบ | ตัวพิมพ์ตามโค้ด (`Content-Type`) | ตัวเล็กทั้งหมด (h11) ความหมายเหมือนเดิม |
| header `Server` | `Bookdose/1.0 Python/3.10.11` | ไม่ส่ง |
| การเชื่อมต่อ | HTTP/1.0 ปิดหลังตอบ | HTTP/1.1 keep-alive 5 วินาที |
| เวลาที่ตอบ | ตอบก่อน commit ฐานข้อมูล | ตอบหลัง commit (ถ้า commit ล้มเหลวหลัง `send()` ลูกค้ายังได้คำตอบแรก เหมือนเดิม) |
| คำขอพร้อมกัน | thread ไม่จำกัด | 100 thread (`REQUEST_THREADS`) เกินนั้นรอคิว |

### ระยะที่ 2a — Realtime ผ่าน WebSocket ✅ ฝั่ง backend เสร็จแล้ว (สัญญาใน `docs/REALTIME-DESIGN.md`)

หลักการ: **socket ส่งแค่ "มีอะไรเปลี่ยน" ส่วนข้อมูลยังมาจาก REST API เดิม** สิทธิ์ทั้งหมดยังตรวจที่ REST เหตุการณ์ไม่มีข้อความแชท
ชื่อไฟล์แนบ บันทึกภายใน อีเมล หรือเบอร์โทร ยกเว้นกำลังพิมพ์ (ชื่อที่ลูกค้าเห็นอยู่แล้ว) และอ่านแล้ว (เวลา)

```text
service (request thread / worker thread) ──► realtime/events.py ──► db.after_commit(...) ── commit ──► hub.send()
                                                                     rollback / ไม่ commit = ไม่ส่ง       │ loop.call_soon_threadsafe
uvicorn event loop ◄───────────────────────────────────────────────────────────────────────────────────────┘
   └─► socket ที่มีสิทธิ์ (ทีมงานตามทีม, บัญชีลูกค้าเจ้าของ, ผู้เยี่ยมชมเจ้าของ) ──► หน้าเว็บ invalidate แล้วดึง API ใหม่
```

| ไฟล์ | หน้าที่ |
|---|---|
| `backend/realtime/hub.py` | ศูนย์กลางใน process: รายการ socket, `send()` จาก thread ใดก็ได้ส่งเข้า event loop ด้วย `call_soon_threadsafe` · ไม่ import อะไรของ asyncio ตอนโหลด เซิร์ฟเวอร์เดิมจึงเรียกได้และไม่มีผล (ไม่มี loop) |
| `backend/realtime/events.py` | ที่ service เรียก: หาผู้รับภายใน transaction แล้วฝากเหตุการณ์ไว้กับ connection ส่งหลัง commit เท่านั้น · ไม่ทำอะไรเลยเมื่อไม่มี socket เปิดอยู่ |
| `backend/realtime/socket.py` | 3 endpoint, handshake, ตรวจเซสชันซ้ำทุก 60 วินาที, ขีดจำกัด, ping, รับเฟรม typing |
| `backend/database/db.py` | `Connection` (factory ของ `sqlite3.connect`): `after_commit(key, callback)` ทำงานหลัง `commit()` สำเร็จ ตามลำดับ ซ้ำ key เดียวกันส่งครั้งเดียว `rollback()` หรือปิดโดยไม่ commit = ทิ้ง |
| `backend/asgi.py` | lifespan ผูก event loop กับ hub, เพิ่ม route WebSocket, `uvicorn_config()` เปิด `ws='websockets-sansio'`, `ws_max_size` 16 KB, ไม่บีบอัด, protocol ping 20 วินาที, ยัง 1 worker |

**Endpoint** (ผ่าน Next.js :3000 ที่ origin เดียวกัน)

| path | ใคร | คุกกี้ |
|---|---|---|
| `/api/realtime/staff` | ทีมงานในองค์กรที่เซสชันเลือกอยู่ (`sessions.tenant_id`) | `bookdose_session` |
| `/api/realtime/customer` | ลูกค้าที่เข้าสู่ระบบ ทุกองค์กรที่เชื่อมไว้ | `bookdose_account` |
| `/api/public/<org>/guest/realtime` | ผู้เยี่ยมชมขององค์กรนั้น (องค์กรต้องเปิดแชทผู้เยี่ยมชม) | `g_<org>` |

- รับการเชื่อมต่อก่อนแล้วจึงตรวจ (ปิดด้วยรหัสได้): Host เหมือน HTTP และ **ต้องมี `Origin` ตรงกับ host ของเราเอง** (ผ่าน Next.js ใช้ `X-Forwarded-Host`) ไม่ผ่าน → **4403** ·
  ไม่มี/เซสชันไม่ถูกต้อง → **4401** · ไม่พบองค์กรหรือปิดแชทผู้เยี่ยมชม → 4403 · ผ่านแล้วส่ง `{"type":"hello","poll_ms":60000}`
- ตรวจซ้ำทุก 60 วินาที: ออกจากระบบ, อุปกรณ์ถูกออกจากระบบ, สมาชิกถูกปิด, สลับองค์กรในเซสชัน, องค์กรถูกระงับ → 4401 (ผู้เยี่ยมชม: ลืมเบราว์เซอร์/ย้ายเข้าบัญชี → 4401, ปิดแชทผู้เยี่ยมชม → 4403)
- ขีดจำกัด: 5 socket ต่อเซสชัน (ผู้เยี่ยมชม: ต่อเบราว์เซอร์) เกิน → 4429 · เฟรมไม่เกิน 2 KB และ 20 เฟรมต่อ 10 วินาที เกิน → 4429 ·
  ส่ง `{"type":"ping"}` ทุก 25 วินาที · ไม่มีเฟรมจาก client 70 วินาที → ปิด **4408** · คิวส่งของ socket ล้น (256) → ปิด 1013
- เฟรมจาก client: `{"type":"pong"}` และ `{"type":"typing","conversation_id"}` ส่งต่อเฉพาะเมื่อผู้ส่งตอบในบทสนทนานั้นได้
  (ทีมงาน: เห็นบทสนทนาตามทีมและช่องทาง web/LINE/Email/Facebook · ลูกค้า/ผู้เยี่ยมชม: เป็นเจ้าของ) ไม่เกิน 1 ครั้งต่อ 2.5 วินาทีต่อบทสนทนาต่อ socket
  ส่งไปอีกฝั่งเท่านั้น (ทีมงาน → เจ้าของบทสนทนา web, ลูกค้า → ทีมงานที่เห็นบทสนทนา) `ttl_ms` 6000

**จุดที่ส่งเหตุการณ์** (หลัง commit ทั้งหมด)

| ที่ | ทีมงาน | ลูกค้า/ผู้เยี่ยมชมเจ้าของ |
|---|---|---|
| `conversations.service.store_message` (ทุกช่องทาง: ทีมงาน, หน้าลูกค้า, ผู้เยี่ยมชม, LINE/Email/Facebook ใน worker, macro) | conversation, conversations, ticket/tickets ถ้าเชื่อมเคส | conversation, conversations, ticket, alerts — **ไม่ส่งถ้าเป็นบันทึกภายใน** |
| `ai.service.system_message` (คำตอบ AI, ข้อความระบบ), `ai.handoff`, งาน AI เสร็จ (`process_one`) | conversation | เฉพาะ chatbot (ร่างคำตอบเป็นของทีมงาน) |
| เปลี่ยนสถานะบทสนทนา, `set_ai_mode`, `request_ai_draft` (ลูกค้ารู้เฉพาะเมื่อ bot หยุด), เชื่อมเคส | conversation (+list) | ✓ |
| `tickets.service.open_ticket` (รวมกฎ routing), `update_ticket`, `delete_ticket`, กู้คืนเคสจากถังขยะ | ticket, tickets, conversations (ทีมเดิมและทีมใหม่) | เฉพาะเมื่อสถานะเปลี่ยน / เปิด / ลบ / กู้คืน (priority, ทีม, ผู้รับผิดชอบเป็นของทีมงาน) |
| `automation`: escalation (ทีมงานเท่านั้น), สถานะจาก macro, นัดติดตาม, ส่งและรับแบบประเมิน CSAT | ✓ | ยกเว้น escalation |
| `channels.finish` / `facebook.finish` / ส่งซ้ำ (สถานะการส่ง), LINE กลุ่มเปลี่ยนสมาชิก | conversation | ไม่ส่ง |
| `customers.service.mark_seen`, `guest.service.mark_seen` (เปิดบทสนทนา) | `read` by customer เมื่ออ่านคำตอบทีมที่ยังไม่อ่าน | — |
| `conversations.service.mark_read` (ทีมงานเปิดบทสนทนา web หลังข้อความลูกค้าล่าสุด) | — | `read` by staff |

**ข้อมูลที่เพิ่ม (additive):** ตาราง `conversation_staff_reads(conversation_id, user_id, read_at)` ในฐานข้อมูลองค์กร ·
`GET /api/conversations/<id>` เพิ่ม `customer_read_at` · `GET /api/public/<org>/session` และ `/guest/session` เพิ่ม `staff_read_at`
(ให้หน้าเว็บแสดง "อ่านแล้ว" ได้ทั้งตอนเปิดหน้าใหม่และบนเซิร์ฟเวอร์เดิมที่ไม่มี WebSocket)

**แพ็กเกจ:** `websockets==16.1.1` (uvicorn ใช้ implementation `websockets-sansio`; ชุดทดสอบใช้ sync client ของแพ็กเกจเดียวกัน)

**ข้อจำกัด:** hub อยู่ในหน่วยความจำของ process เดียว — ถ้ารันหลาย worker หรือหลายเครื่อง ต้องมี broker (เช่น Redis pub/sub)
ระหว่าง process และย้าย session/rate limit ออกนอก process (ระยะที่ 3) · เซิร์ฟเวอร์เดิม (`legacy`) ไม่มี WebSocket (คำขอ upgrade ได้คำตอบ HTTP ธรรมดา เช่น 404/401 JSON) หน้าเว็บใช้การดึงเป็นระยะ

**ผลทดสอบ** (`tests/test_realtime.py` 15 รายการ: handshake ทั้ง 3 แบบ, Origin ผิด 4403, ไม่มีคุกกี้ 4401, เซสชันถูกยกเลิก,
ลูกค้าได้ยินคำตอบแต่ไม่ได้ยินบันทึกภายใน, ลูกค้า/องค์กร/ทีมอื่นไม่ได้ยิน, ผู้เยี่ยมชมได้ยินเฉพาะของตัวเอง, สิทธิ์และความถี่ของ typing,
อ่านแล้วทั้งสองทาง, ส่งหลัง commit เท่านั้น, LINE จาก worker thread, ขนาด/จำนวนเฟรม, จำนวน socket, idle; 12 รายการข้ามบน `legacy`)

| ชุด | FastAPI (ค่าเริ่มต้น) | http.server (`BOOKDOSE_SERVER=legacy`) |
|---|---|---|
| `python -m unittest discover -s tests` (183 รายการ) | ผ่าน 180 · ไม่ผ่าน 3 รายการสิทธิ์ไฟล์บน Windows (`438 != 384`) | ผ่าน 168 · ข้าม 12 · ไม่ผ่าน 3 รายการเดียวกัน |

**ยังไม่ส่งเหตุการณ์ (ยังเห็นผ่านการดึงเป็นระยะ 60 วินาที):** รวมรายชื่อลูกค้า (contact merge) และการย้ายแชทผู้เยี่ยมชมเข้าบัญชี,
การ @mention / กระดิ่งแจ้งเตือนของทีมงาน (สัญญาไม่มี scope นี้), สถานะ `sending` ระหว่างส่ง, การตั้งค่าองค์กร/ทีม

**ส่งต่อผ่าน Next.js:** งานของฝั่ง frontend (`frontend/`) — proxy ต้องส่งต่อคำขอ upgrade ไป :8787 พร้อม `X-Forwarded-Host`
(host ที่เบราว์เซอร์ใช้) เพื่อให้ Origin ตรง และ `X-Bookdose-Proxy` เมื่อตั้ง `BOOKDOSE_PROXY_SECRET`

### ระยะที่ 2 (ส่วนที่เหลือ) — ค่อย ๆ เปลี่ยนเป็น router ของ FastAPI จริง ทีละโมดูล ⬜
- ย้ายทีละโมดูลจาก `ROUTES` ไปเป็น `APIRouter` โดย route ที่ยังไม่ย้ายยังผ่าน `dispatch()` (catch-all อยู่ท้ายสุด)
- ใช้ `Depends` แทนระดับสิทธิ์ (workspace, customer, guest ฯลฯ) โดยคงลำดับการตรวจและข้อความเดิม
- ใช้ pydantic แทนการตรวจข้อมูลเข้าที่เขียนเองใน `schema.py` ต้องแปลง 422 ให้เป็น 400 `{error}` ภาษาไทย
- ~~Realtime ผ่าน WebSocket~~ ✅ ระยะที่ 2a (ด้านบน) · ที่เหลือ: ทดสอบผ่าน Next.js production build จริง และส่งเหตุการณ์ในจุดที่ยังไม่ส่ง
- เอกสาร API อัตโนมัติ (`/docs`) **ปิดใน production** หรือเปิดเฉพาะผู้ดูแลแพลตฟอร์ม
- ลบ `backend/server.py` และ `BOOKDOSE_SERVER=legacy` หลังใช้งานจริงผ่านไป 1 รอบโดยไม่ต้องย้อนกลับ

### ระยะที่ 3 — งานที่ต่อยอดได้เมื่อมี FastAPI แล้ว ⬜
- เปลี่ยนโค้ดเข้ารหัสไปใช้ไลบรารีมาตรฐาน
- ย้ายการจำกัดคำขอและ session ไปเก็บนอก process เพื่อรันหลาย worker ได้
- ย้ายไป PostgreSQL

---

## 4. จุดที่ต้องระวังเป็นพิเศษ (ผลในระยะที่ 1)

| จุด | ของเดิมทำอะไร | ทำใน FastAPI แล้ว |
|---|---|---|
| ขนาดข้อมูลเข้า | จำกัด JSON ที่ 8 MB และ 415 ถ้าไม่ใช่ JSON | ✅ ตรวจใน `Exchange.json_body()` ตัวเดิมก่อนอ่าน body · uvicorn หยุดรับข้อมูลเมื่อค้างเกิน 64 KB จึงไม่กินหน่วยความจำ |
| Webhook (LINE, Facebook) | อ่าน body ดิบเพื่อตรวจลายเซ็น | ✅ `req.rfile.read(n)` คืน byte ดิบจาก ASGI ไม่ผ่าน JSON |
| IP และ Host ของผู้ใช้ | เชื่อ header จาก Next.js เฉพาะเครื่องเดียวกันหรือมีรหัสลับ | ✅ `proxy_headers=False` · `client_address` มาจาก socket · `server.server_address` คือ host ที่สั่งเปิด (ไม่ใช่ที่อยู่ของการเชื่อมต่อ) การตรวจ localhost จึงเหมือนเดิมเมื่อเปิดที่ `0.0.0.0` |
| Cookie | ใส่ `Secure` ตาม `server.secure_cookies` | ✅ `ServerInfo.secure_cookies` จาก `--secure-cookies` |
| คำตอบที่ไม่ใช่ JSON | ไฟล์ดาวน์โหลด, Facebook verify | ✅ ส่ง byte และ header ตามที่ controller สร้าง ไม่ผ่านตัวแปลงของ FastAPI |
| Error | `{error: "ข้อความไทย"}` และ 500 ข้อความกลาง | ✅ ใช้ `error_response()` ตัวเดิม · หน้า error ของ FastAPI ถูกแทนทั้งหมด |
| การบันทึกสถิติ | `monitor.record()` | ✅ จุดเดียวกันใน `dispatch()` |
| Log | ไม่พิมพ์ path/query | ✅ ปิด access log ของ uvicorn · พิมพ์ `[เวลา] METHOD STATUS` แบบเดิม |
| Timeout | socket timeout 30 วินาที | ✅ รอ body ไม่เกิน 30 วินาที · keep-alive 5 วินาที · ⚠ uvicorn ไม่มี timeout ระหว่างรับ header (มี Next.js คั่นหน้า) |
| Worker | 1 process หลาย thread | ✅ uvicorn 1 worker · worker เบื้องหลังเริ่มใน lifespan ครั้งเดียว และหยุดตอนปิด |

---

## 5. เกณฑ์ว่าย้ายสำเร็จ

1. ✅ **เทสต์ครบ:** 168 รายการผ่านบน uvicorn เท่ากับบน server เดิม (ยกเว้น 3 รายการสิทธิ์ไฟล์บน Windows)
2. ✅ **API ครบ:** ทั้ง 166 route ตอบตรงกับ server เดิม ตรวจด้วยสคริปต์เทียบคำตอบ
3. ✅ **คำตอบเหมือนเดิม:** status, security header, cookie และข้อความ error ตรงกัน ทั้งกรณีปกติและกรณี error
4. ⬜ **ใช้งานจริงผ่านหน้าเว็บ:** ทดสอบผ่าน Next.js ทั้งฝั่งทีมงาน ฝั่งลูกค้า แชทผู้เยี่ยมชม และ webhook ของ LINE
5. ⬜ **ความเร็ว:** ชุดทดสอบบน FastAPI ใช้เวลาใกล้เคียงหรือเร็วกว่าเดิม ยังไม่ได้วัดภายใต้โหลด
6. ✅ **ย้อนกลับได้:** `BOOKDOSE_SERVER=legacy`

---

## 6. เรื่องที่ตัดสินใจแล้ว

| เรื่อง | ผล |
|---|---|
| นโยบาย "Python standard library เท่านั้น" | ยกเว้นชั้น web server (FastAPI, uvicorn) ส่วนอื่นยังใช้ standard library |
| แพ็กเกจและเวอร์ชัน | ล็อกตรงตัวใน `requirements.txt` (ดูระยะที่ 1) |
| การ deploy | `render.yaml` ติดตั้งแพ็กเกจตอน build · คำสั่งเริ่มเดิม `python app.py --host 0.0.0.0 --port $PORT --secure-cookies` · 1 instance, 1 worker |
| ช่วงเวลาที่เก็บ server เดิมไว้ | 1 รอบการใช้งานจริง แล้วลบในระยะที่ 2 |
