# Bookdose Frontend (Next.js)

หน้าจอของ Bookdose Customer Service เขียนด้วย **Next.js 16 (App Router) + React 19 + TypeScript** ข้อมูลทั้งหมดมาจาก API ของ Python (`python app.py`) เบราว์เซอร์คุยกับแอปนี้เพียงที่เดียว ส่วน `/api/*` แอปส่งต่อให้ Python เอง cookie, CSRF และ `X-Tenant-ID` จึงยังเป็น same-origin เหมือนเดิม

```text
เบราว์เซอร์ ──► Next.js (frontend/, :3000) ──/api/*──► Python (app.py, :8787)
                 หน้าจอ + CSP nonce              routes → controller → service → repository → SQLite
```

## เปิดใช้งานระหว่างพัฒนา

```sh
python app.py                 # API ที่ http://127.0.0.1:8787 (ตอบเฉพาะ /api/*)
cd frontend
npm install
npm run dev                   # เปิด http://localhost:3000
```

คำสั่งอื่น: `npm run typecheck`, `npm run lint`, `npm run build && npm start` (production)

Production แบบ standalone (สิ่งที่ `next build` สร้างใน `.next/standalone`): คัดลอก `.next/static` ไปที่ `.next/standalone/.next/static` และ `public` ไปที่ `.next/standalone/public` แล้วเริ่มด้วย

```sh
cd .next/standalone
PORT=3000 HOSTNAME=0.0.0.0 node server.js
```

ไม่ต้องมีตัวห่อ server เพิ่ม: rewrite `/api/*` ของ Next ส่งต่อ WebSocket upgrade ของการอัปเดตสด (`/api/realtime/*`, `/api/public/<org>/guest/realtime`) ไปที่ Python ด้วย และ `src/proxy.ts` ยังทำงานกับคำขอ upgrade (ลบ `X-Bookdose-Proxy` ที่เบราว์เซอร์ส่งมา ใส่ค่าจริงเมื่อตั้ง `BOOKDOSE_PROXY_SECRET`) ส่วน `X-Forwarded-Host` Next ใส่ให้เอง ข้อควรระวัง: ปลายทางของ rewrite ถูกเขียนลงไฟล์ตอน `next build` จึงต้องตั้ง `BOOKDOSE_API_URL` ตอน build (ค่าตอนเริ่ม `node server.js` ใช้เฉพาะใน `proxy.ts`) และ reverse proxy / load balancer ที่อยู่หน้า Next ต้องส่งต่อ header `Upgrade` / `Connection` ของ WebSocket

ตัวแปรแวดล้อม (ดู `.env.example`, ทุกตัวไม่บังคับเมื่อใช้งานบนเครื่องเดียวกัน)

| ตัวแปร | ความหมาย |
|---|---|
| `BOOKDOSE_API_URL` | ที่อยู่ของ Python API (ค่าเริ่มต้น `http://127.0.0.1:8787`) |
| `BOOKDOSE_PROXY_SECRET` | ตั้งค่าเดียวกันทั้งสองฝั่งเมื่อแอปนี้อยู่คนละเครื่องกับ Python หรือเปิดสู่สาธารณะ ถ้าไม่ตั้ง Python จะเชื่อคำขอที่ส่งต่อมาจากเครื่องเดียวกันเท่านั้น |
| `BOOKDOSE_TRUST_FORWARDED_FOR` | `1` เมื่อมี load balancer / reverse proxy ที่ใส่ `X-Forwarded-For` ด้านหน้า (เช่น Render) เพื่อให้การจำกัดความถี่คำขอนับแยกตามผู้ใช้ |

## สถาปัตยกรรม: ชั้นเดียวกับ backend

Backend แบ่งเป็น `routes → controller → service → repository` ต่อ feature ใน `backend/modules/<feature>/` ฝั่งหน้าจอแบ่งตาม feature ชื่อเดียวกัน และแยกหน้าที่เป็นชั้นเช่นกัน

| ชั้น (web) | ไฟล์ | หน้าที่ | คู่กับ backend |
|---|---|---|---|
| Route | `src/app/**/page.tsx`, `layout.tsx` | URL ของหน้าจอ อ่าน params แล้วเรียก screen ของ feature (ไม่มี logic) | `routes.py` |
| Screen | `src/features/<feature>/*Screen.tsx` | ประกอบหน้าจอหนึ่งหน้า: อ่านข้อมูล จัดการ state ของหน้า และเรียก action | `controller.py` |
| Component | `src/features/<feature>/components/` | ชิ้นส่วนแสดงผลของ feature | – |
| API | `src/features/<feature>/api.ts` | ฟังก์ชันเรียก endpoint ของ feature นั้น (path ตรงกับ `routes.py`) | `routes.py` + `schema.py` |
| Types | `src/features/<feature>/types.ts` | รูปข้อมูลที่ API ส่งกลับ (ชื่อฟิลด์ snake_case ตาม server) | `schema.py` |
| Shared | `src/lib/`, `src/components/` | client, session, format, labels, UI กลาง, กรอบหน้าจอ | `utils/`, `middleware/` |

```text
src/
  proxy.ts               ก่อนทุกคำขอ: CSP nonce ต่อหน้า และ header ให้ Python เชื่อ host/IP ที่ส่งต่อ
  app/                   URL ทั้งหมด (ดูตารางด้านล่าง)
    (auth)/              เข้าสู่ระบบ สมัคร ตั้งค่าครั้งแรก ยืนยันอีเมล
    (staff)/             หน้าของทีมและคอนโซลแพลตฟอร์ม: layout ตรวจเซสชันและวางกรอบ StaffShell
    customer/(portal)/   หน้าของลูกค้าที่เข้าสู่ระบบแล้ว: layout วางกรอบ CustomerShell
    customer/(link)/     หน้าลูกค้าจากลิงก์อีเมล (ยืนยันอีเมล ตั้งรหัสผ่านใหม่) ไม่ต้องเข้าสู่ระบบ
    chat/[org]/          แชทโดยไม่ต้องเข้าสู่ระบบ (+ resume/ ลิงก์ติดตามแชท, embed/ แชทในกรอบเว็บไซต์ขององค์กร)
    page.tsx             หน้าแรก: แปลงลิงก์ #hash แบบเดิมเป็น path ใหม่ แล้วพาไปหน้าที่ถูกต้อง
  features/<feature>/    หนึ่งโฟลเดอร์ต่อ feature (tickets, inbox, customer, org-links, …)
    customer/settings/   แท็บของ ตั้งค่าบัญชี: Profile / Security / Organizations / Notifications และ tabs.ts
    staff-account/       ตั้งค่าบัญชีของทีมงานทุกบทบาทและผู้ดูแลแพลตฟอร์ม (/account): Profile / Status / Notifications / Replies / Security / Organizations,
                         StatusSwitch (แถบบน) และ useWorkAlerts (แจ้งเตือนบนหน้าจอและเสียง)
    account-security/    การ์ดความปลอดภัยที่ลูกค้าและทีมงานใช้ร่วมกัน: รหัสผ่าน 2FA Passkey อุปกรณ์ และประวัติ
  components/
    Icon.tsx             ไอคอนทั้งหมดของแอป
    ui/                  Form, fields (TextField, NumberField …), Combobox, FileInput, PhotoPicker, Pager, Dialogs, Toast,
                         display (EmptyState, StatCard, ChartColumn, CustomerNone …), filters,
                         actions (useRunAction, useCopyText), pickers (TeamOptions, MemberPicker)
    shell/               StaffShell, CustomerShell, TextSize
  lib/
    api/client.ts        api(path, body?, method?), download() และ fetchBlob(): ใส่ CSRF / X-Tenant-ID / X-Customer-CSRF ให้เอง
    query.ts             useApi(path) อ่านข้อมูล และ useInvalidate() ให้หน้าจอโหลดใหม่หลังแก้ไข
    session.ts           เซสชันฝั่งทีม: useBoot, useWork, useStaffTickets, useStaffAlerts, useSwitchTenant
    customer-session.ts  เซสชันฝั่งลูกค้า: useCustomer, useCustomerOrgs, useCustomerOverview
    realtime.ts          การเชื่อมต่อ WebSocket ของการอัปเดตสด (ต่อใหม่แบบ backoff 1→30 วินาที หยุดเมื่อซ่อนแท็บเกิน 5 นาที)
    realtime-provider.tsx RealtimeProvider (ใน StaffShell, CustomerShell, GuestChatScreen): แปลงเหตุการณ์เป็นการโหลด query ใหม่
                         useRealtimeInterval, useTyping, useReadAt, useTypingNotifier
    routes.ts            URL ของทุกหน้าจอ เมนู และตัวแปลงลิงก์แบบเดิม
    format.ts, labels.ts วันที่ ตัวเลข และคำภาษาไทยของค่าจาก API
    ui-state.ts          useUiState: ตัวกรองและตัวเลือกบนหน้าจอที่คงอยู่ระหว่างเปลี่ยนหน้า
    files.ts             กติกาไฟล์แนบ (ชนิด ขนาด จำนวน) เหมือนฝั่ง server
  styles/                CSS ชุดเดิมทั้งหมด (โหลดตามลำดับใน app/layout.tsx)
```

### กติกาที่ทุก feature ใช้

1. **อ่านข้อมูล** ด้วย `useApi<T>(path)` เท่านั้น (key ของ cache คือ path) หน้าจอที่ต้องอัปเดตเองใช้ `{ refetchInterval: useRealtimeInterval(ms) }` (ช่วงเดิมเมื่อไม่มีการอัปเดตสด และทุก 60 วินาทีเมื่อเชื่อมต่ออยู่) แล้วเพิ่ม key ของหน้านั้นใน `eventTargets` ของ `lib/realtime-provider.tsx`
2. **แก้ไขข้อมูล** เรียกฟังก์ชันใน `features/<feature>/api.ts` แล้ว `await refresh('/api/tickets')` จาก `useInvalidate()` ห้ามเรียก `fetch` ตรง
3. **ฟอร์ม** ใช้ `<Form onSubmit>` + `TextField` / `TextArea` / `SelectField` / `Combobox` / `FileInput` ข้อผิดพลาดที่ throw จะแสดงเป็น `.error-message` บนฟอร์มเอง ปุ่ม submit ถูกปิดระหว่างส่ง
4. **กล่องโต้ตอบ** ใช้ `useDialogs()` (`openModal`, `openSheet`, `confirm`, `confirmDelete`) และข้อความสั้นด้วย `useToast()` ไม่ใช้ `alert` / `confirm` / `prompt` ของเบราว์เซอร์
5. **หน้าตา** ใช้ class ที่มีใน `src/styles` และ markup แบบเดียวกับหน้าจออื่นของแอป ห้ามใช้ `style={...}` เพราะ CSP ของ production ไม่อนุญาต inline style ให้ใช้ class, `<progress>`, หรือ `data-*`
6. **HTML จากผู้ใช้** ห้าม `dangerouslySetInnerHTML` ยกเว้นผลของตัวแปลง Markdown กลาง (escape ทุกอย่างก่อน แล้วสร้างเฉพาะ tag ที่อนุญาต)
7. **คำบนหน้าจอเป็นภาษาไทย** ชื่อฟิลด์ตาม API (snake_case) คอมเมนต์ในโค้ดเป็นภาษาอังกฤษ คอมเมนต์ที่อ้าง `old-frontend/…` หมายถึงหน้าจอรุ่นก่อน Next.js (JavaScript + HTML template) ที่ถูกนำออกแล้ว ดูได้ในประวัติ git
8. **สิทธิ์ตามบทบาท** กำหนดใน `lib/routes.ts` (`roles`) กรอบหน้าจอพาคนที่ไม่มีสิทธิ์กลับหน้าภาพรวมเอง ส่วนปุ่มที่เฉพาะบางบทบาทให้ซ่อนด้วย `useWork().role` server ยังตรวจสิทธิ์ทุกคำขอเหมือนเดิม

### URL ของหน้าจอ

| กลุ่ม | URL |
|---|---|
| ทั่วไป | `/login` (`?tab=signup`, `?org=`, `?next=`), `/register`, `/verify-email?token=`, `/check-email`, `/resend-email`, `/oauth/email/callback`, `/join/<token>` (ลิงก์/QR เข้าร่วมองค์กร) |
| ทีม | `/dashboard`, `/inbox[/id]`, `/tickets[/id]`, `/contacts`, `/knowledge[/id]`, `/reports`, `/guides[/id]`, `/automation`, `/audit`, `/trash`, `/settings`, `/notifications` |
| คอนโซลแพลตฟอร์ม | `/platform/system`, `/platform/organizations`, `/platform/faq`, `/platform/team`, `/platform/security` (ความปลอดภัย + กับดัก) |
| ลูกค้า | `/customer` (= `/customer/dashboard` ภาพรวมระดับการให้บริการ), `/customer/chats[/new \| /<org>/<id>]`, `/customer/cases[/<org>/<id>]`, `/customer/faq[/<id>]`, `/customer/alerts`, `/customer/account` (`?tab=profile \| security \| organizations \| notifications`) |
| ลูกค้าจากลิงก์อีเมล | `/customer/verify?token=`, `/customer/reset?token=`, `/customer/forgot` |
| ลิงก์ไฟล์ (กับดัก) | `/files/<token>` หน้า "ไฟล์นี้ถูกย้ายหรือหมดอายุ" เหมือนกันทุก token |
| ผู้เยี่ยมชม (ไม่ต้องเข้าสู่ระบบ) | `/chat/<org>` (`?c=<id>`), `/chat/<org>/resume#t=<token>`, `/chat/<org>/embed` (หน้าเดียวที่เว็บอื่นใส่ในกรอบได้), `/widget.js` |

ลิงก์แบบเดิมที่ส่งไปทางอีเมลแล้ว (`/#tickets/…`, `/#verify=…`) ยังใช้ได้ หน้าแรกแปลงเป็น URL ใหม่ให้ (`lib/routes.ts` → `legacyPath`)

### หน้าลูกค้า: ภาพรวม องค์กรที่ติดต่อ และการแจ้งเตือน

| feature (โฟลเดอร์) | หน้าจอ | backend |
|---|---|---|
| ภาพรวม (`features/dashboard/CustomerDashboardScreen.tsx`) | ระดับการให้บริการของแต่ละองค์กรจากเคสของลูกค้า: เวลาตอบกลับครั้งแรกและเวลาแก้ไขเฉลี่ย สัดส่วนที่ตรงเวลา และคะแนนความพึงพอใจ (`GET /api/customer/dashboard` → `sla.orgs`) กรองตามองค์กรด้วยตัวกรองเดียวกับหน้าอื่น | `customers/dashboard.py` |
| ลิงก์และ QR ขององค์กร (`features/org-links/`) | ตั้งค่าองค์กร → **ลิงก์และ QR สำหรับลูกค้า** (`features/settings/components/JoinLinksPanel.tsx`): ลิงก์ถาวร `…/?org=<รหัส>` และลิงก์เชิญพร้อม QR กำหนดอายุ/จำนวนคน และยกเลิกได้ · `/join/<token>` หน้าที่ QR เปิด (เข้าสู่ระบบแล้วกดเข้าร่วม) · ตั้งค่าบัญชี → **องค์กรที่ติดต่อได้** (`features/customer/settings/OrganizationsSettings.tsx`): รายการองค์กรจาก `GET /api/customer/organizations` และการเพิ่มองค์กรด้วยรหัส ลิงก์ หรือสแกน QR (`BarcodeDetector`) | `org_links/` |
| การแจ้งเตือน (`features/customer/AlertsScreen.tsx`, `components/NotifySettings.tsx`) | แชทที่ทีมงานตอบ แบบประเมินความพึงพอใจ เคสที่รอข้อมูล เคสที่เสร็จ และนัดติดตาม ทุกรายการมีปุ่มไปยังหน้าที่ทำต่อ (`action_label`) ตั้งค่าบัญชีมีตารางเหตุการณ์ × อีเมล/LINE และเชื่อม LINE ด้วยรหัส 6 หลักต่อองค์กร | `customers/notify.py`, `customers/line.py` |

| แชทบนเว็บไซต์ (`features/guest/`) | `/chat/<org>`: เริ่มแชทโดยไม่มีบัญชี (ข้อความ ไฟล์ ชื่อ "เครื่องสาธารณะ" honeypot และเวลาเริ่มกรอก) แล้วคุยต่อด้วย `MessageThread` / `Composer` / แบบประเมินในแชท ชุดเดียวกับแชทของลูกค้า (ส่ง `publicSlug="<org>/guest"` จึงเรียก `/api/public/<org>/guest/…`) · การ์ด **ติดตามแชทนี้**: จำในเบราว์เซอร์ ลิงก์ทางอีเมล / SMS รหัส LINE สมัครสมาชิก และลืมแชท · `public/widget.js`: ปุ่มแชทบนเว็บองค์กร เปิด iframe `/chat/<org>/embed` คุยกันด้วย `postMessage` `{type:'bd-chat'}` เฉพาะ origin ที่อนุญาต · ตั้งค่าองค์กร → **แชทบนเว็บไซต์** (`features/settings/components/GuestChatPanel.tsx`) · ป้าย **ผู้เยี่ยมชม** ในกล่องข้อความ (`features/inbox/components/GuestBadge.tsx`) · แบนเนอร์ย้ายแชทเข้าบัญชี (`GuestClaimBanners`) · คอนโซลระบบ → SMS (`features/platform/components/SmsSettingsCard.tsx`) | `docs/GUEST-CHAT-DESIGN.md` |

## การอัปเดตสด (WebSocket)

ตามสัญญาใน `docs/REALTIME-DESIGN.md`: socket ส่งเพียง "อะไรเปลี่ยน" หน้าจอไปอ่านข้อมูลใหม่ผ่าน REST เหมือนเดิม (สิทธิ์ทั้งหมดยังตรวจที่ REST) ยกเว้น `typing` และ `read` ที่แสดงจากเหตุการณ์โดยตรง

| เหตุการณ์ | staff (`/api/realtime/staff`) | ลูกค้า (`/api/realtime/customer`) | ผู้เยี่ยมชม (`/api/public/<org>/guest/realtime`) |
|---|---|---|---|
| `changed conversation <id>` | `/api/conversations/<id>`, `/api/conversations`, เคสที่มีบทสนทนานั้น (`/api/tickets/<ticket>`), `/api/automation/alerts` | `…/session?conversation=<id>`, `/api/customer/overview` | `/api/public/<org>/guest/session?conversation=<id>`, `/api/public/<org>/guest` |
| `changed conversations` | `/api/conversations`, `/api/automation/overview*`, `/api/automation/alerts` | `/api/customer/overview` | `/api/public/<org>/guest` |
| `changed ticket <id>` | `/api/tickets/<id>`, `/api/tickets`, overview, alerts | `…/cases/<id>`, overview, `/api/customer/dashboard` | `/api/public/<org>/guest` |
| `changed tickets` | `/api/tickets`, overview, alerts | overview, `/api/customer/dashboard` | `/api/public/<org>/guest` |
| `changed alerts` | `/api/automation/alerts`, overview | `/api/customer/overview` | `/api/public/<org>/guest` |

- เหตุการณ์ที่มาติดกันภายใน 150 ms รวมเป็นการโหลดใหม่รอบเดียว ระหว่างแท็บถูกซ่อนจะเก็บไว้โหลดเมื่อกลับมา (แชทที่ซ่อนอยู่จึงไม่ถูกนับว่าอ่านแล้ว) และเมื่อต่อใหม่หลังหลุดจะโหลดทุก key ข้างบนหนึ่งรอบ
- ขณะเชื่อมต่อ การ poll เดิมช้าลงเหลือทุก 60 วินาที (`poll_ms` จาก `hello`) ไม่มี WebSocket (server legacy, ถูกบล็อก) ทุกอย่างทำงานเหมือนเดิมด้วยการ poll
- close 4401: ไม่ลองใหม่จนกว่าเซสชันจะเปลี่ยน (เปลี่ยนองค์กร เข้าสู่ระบบใหม่ หรือกลับมาที่แท็บหลังซ่อนเกิน 5 นาที) และถามเซสชันใหม่ · 4403 / 4429: ลองใหม่ทุก ~30 วินาที · อื่น ๆ: backoff 1→30 วินาที · ไม่มีข้อมูลใดจาก server 70 วินาที: ต่อใหม่
- **กำลังพิมพ์…** แสดงใน `MessageThread` ฝั่งตรงข้าม (`ttl_ms`) · `Composer` ส่ง `typing` ไม่เกิน 1 ครั้ง / 3 วินาที เฉพาะตอบกลับลูกค้าในแชทเว็บ ไม่ส่งจากโหมดบันทึกภายใน
- **อ่านแล้ว** ใต้ข้อความล่าสุดของผู้อ่านเมื่ออีกฝั่งอ่านแล้ว จาก `customer_read_at` / `staff_read_at` ของ REST และเหตุการณ์ `read` บรรทัดนี้จองที่ไว้ขณะเชื่อมต่อ จึงไม่ดันหน้าจอเมื่อขึ้น
- **ป้ายข้อความใหม่ของวิดเจ็ต** (`public/widget.js`) นับจาก `/api/public/<org>/guest` ในหน้า embed ซึ่งโหลดใหม่ตามเหตุการณ์
- CSP `connect-src` ของทุกหน้าใส่ `ws://<host> wss://<host>` ของ host ที่ขอมา (`src/proxy.ts`)

## ความปลอดภัย

- **CSP ต่อคำขอ:** `src/proxy.ts` สร้าง nonce ใหม่ทุกหน้า script ที่ไม่มี nonce ของ Next จะไม่ทำงาน (production ไม่อนุญาต inline style)
- **การใส่ในกรอบ (iframe):** ทุกหน้า `frame-ancestors 'none'` และ `X-Frame-Options: DENY` ยกเว้น `/chat/<org>/embed` ที่ `proxy.ts` ตั้ง `frame-ancestors` เป็นเว็บไซต์ที่องค์กรอนุญาต (อ่านจาก `GET /api/public/<org>/widget` จำไว้ 60 วินาที หรือ `'none'` เมื่อปิด) และ `next.config.ts` ไม่ใส่ `X-Frame-Options` ให้ path นี้
- **ผู้เยี่ยมชม:** cookie `g_<org>` เป็น HttpOnly หน้าจออ่าน csrf จาก `GET /api/public/<org>/guest` แล้วส่งเป็น `X-Guest-CSRF` (`setGuestCredentials`) ในกรอบเว็บไซต์ส่ง `X-Embed: 1` เพิ่ม (`setEmbedded`) โทเค็นลิงก์ติดตามอยู่หลัง `#` ไม่เคยถึง server log
- **Python ยังตรวจ Host / Origin / CSRF ทุกคำขอ:** คำขอที่มาผ่านแอปนี้ Python ใช้ `X-Forwarded-Host` แทน Host เฉพาะเมื่อมาจากเครื่องเดียวกัน หรือมี `BOOKDOSE_PROXY_SECRET` ตรงกัน (`backend/middleware/security.py`)
- **Cookie:** เป็น HttpOnly และ SameSite=Strict ทั้งเซสชันทีมและลูกค้า หน้าจออ่าน cookie ไม่ได้ ใช้ CSRF token จาก `/api/bootstrap` และ `/api/customer/account` แทน
- **ความปลอดภัยบัญชีลูกค้า** (`features/customer/settings/SecuritySettings.tsx` + `features/auth/`, backend `customer_security/`): การยืนยันสองขั้นตอนด้วยแอป (TOTP) พร้อมรหัสสำรอง 10 รหัส, Passkey (WebAuthn ผ่าน `features/auth/passkeys.ts`), รายการอุปกรณ์ที่เข้าสู่ระบบ และประวัติการใช้งานบัญชี การเปิดการยืนยันสองขั้นตอนและการเพิ่ม/ลบ Passkey ต้องกรอกรหัสผ่านของบัญชีก่อนเสมอ และการตั้งรหัสผ่านใหม่จากลิงก์อีเมลจะลบ Passkey ทั้งหมดทิ้ง เมื่อบัญชีเปิดการยืนยันสองขั้นตอน `/api/customer/login` (และลิงก์ตั้งรหัสผ่านใหม่) จะตอบ `{two_factor: true}` แล้วให้กรอกรหัสที่ `/api/customer/login/verify` ก่อน จึงจะได้เซสชัน
- **ตั้งค่าบัญชีของทีมงาน** (`/account?tab=`, `features/staff-account/`, backend `auth/` + `staff_security/`): หน้าตาเดียวกับตั้งค่าบัญชีของลูกค้า ใช้ได้ทุกบทบาท (เจ้าหน้าที่ หัวหน้าทีม ผู้ดูแลองค์กร ผู้ดูแลแพลตฟอร์ม) แท็บ **ข้อมูลส่วนตัว** (รูป ชื่อ อีเมล ออกจากระบบ) **ความปลอดภัย** (รหัสผ่าน 2FA Passkey อุปกรณ์ที่เข้าสู่ระบบ `/api/account/security/sessions` และประวัติ `/api/account/security/activity`) และ **องค์กรของฉัน** (บทบาทในแต่ละองค์กรและสลับองค์กร) การ์ดความปลอดภัยใช้ชุดเดียวกับของลูกค้า (`features/account-security/cards.tsx`) · `/account/security` เดิมพาไปแท็บความปลอดภัย
- **กับดัก (honeypot / honeytoken, `docs/HONEYPOT-DESIGN.md`):** `src/lib/traps.ts` คือรายการ path ล่อของหน้าเว็บ (`/.env`, `/wp-admin`, `/vendor/phpunit/…` ฯลฯ) `src/proxy.ts` ตอบ path เหล่านี้และ `/files/<token>` ตามปกติ (หน้า 404 เดียวกับ URL ที่ไม่มีอยู่ / หน้าไฟล์หมดอายุ) แล้วส่ง `POST /api/trap {path, method, user_agent}` ถึง Python หลังตอบ (`event.waitUntil`) พร้อม `X-Bookdose-Trap: 1`, secret และ IP ที่เชื่อถือได้แบบเดียวกับคำขอ `/api/*` และลบ `X-Bookdose-Trap` ที่เบราว์เซอร์ส่งมาทิ้งเสมอ · ช่องซ่อน `website` (`components/ui/HoneypotField.tsx`: class `.form-extra`, `inert`, `aria-hidden`, `tabIndex=-1`, `autocomplete=off`) อยู่ในหน้าเข้าสู่ระบบ สมัครองค์กร สมัครสมาชิกลูกค้า ลืมรหัสผ่านลูกค้า และเริ่มแชทผู้เยี่ยมชม · คอนโซล → ความปลอดภัย → **กับดัก**: รายการ honeytoken (เปิด/ปิด ทดสอบ แก้ไข ลบ) สร้างกับดักพร้อมแสดงค่าลับครั้งเดียว เหตุการณ์กับดักล่าสุด และตั้งค่ากับดัก (`features/security/components/Honeytokens.tsx`, `TrapEvents.tsx`, `HoneypotSettingsCard.tsx`)
