# แผนย้ายเซิร์ฟเวอร์ไปใช้ FastAPI

สถานะ: **เตรียมการ** ยังไม่ได้แก้โค้ดหรือติดตั้งแพ็กเกจใด ๆ · สำรวจจากโค้ดจริง ณ 16 กันยายน 2026

---

## 1. เป้าหมาย

ย้ายฝั่งเซิร์ฟเวอร์จาก `http.server` ที่เขียนเองไปเป็น **FastAPI บน uvicorn** เพื่อให้ได้ web server ระดับ production
โดย **ไม่เปลี่ยนพฤติกรรมของ API ที่หน้าเว็บและลูกค้าใช้อยู่แม้แต่จุดเดียว** (URL, ข้อความ error, cookie, header,
ลำดับการตรวจสิทธิ์ต้องเหมือนเดิมทุกอย่าง)

**นอกขอบเขตของรอบนี้** (ทำทีหลัง แยกเป็นงานของตัวเอง)
- เปลี่ยนโค้ดเข้ารหัสที่เขียนเองไปใช้ไลบรารีมาตรฐาน (`cryptography`, `webauthn`, `pyotp`)
- ย้าย SQLite ไป PostgreSQL
- รันหลาย worker หรือหลายเครื่อง

---

## 2. สิ่งที่พบจากการสำรวจ

| หัวข้อ | ที่พบ | ผลต่อการย้าย |
|---|---|---|
| จำนวน API | 241 route ใน 11 ระดับสิทธิ์ (workspace 108, customer 52, customer-account 33, platform 19, customer-public 11, public 7, account 5, page 2, webhook 2, session 1, portal 1) | ต้องทำงานเหมือนเดิมครบทั้ง 241 |
| โค้ดที่ผูกกับ web server | `backend/server.py` 218 บรรทัด + `backend/middleware/` 159 บรรทัด | ส่วนที่ต้องเขียนใหม่มีขนาดเล็ก |
| สิ่งที่ controller ใช้จาก `req` | 14 อย่าง: `send` (207 จุด), `db` (174), `cd` (128), `ctx` (127), `body` (110), `customer` (92), `org` (34), `ip` (26), `session` (18), `headers` (9), `send_download` (8), `server` (3), `query` (3), `rfile` (1) | **สร้าง object ที่หน้าตาเหมือนเดิมได้ แล้ว controller ทั้งหมดใช้ต่อได้โดยไม่ต้องแก้** |
| service / repository | ไม่รู้จัก HTTP เลย | ย้ายไปได้โดยไม่ต้องแตะ |
| งานเบื้องหลัง | 4 thread: AI, automation, channels, email (เริ่มใน `app.py`) | ย้ายไปเริ่มใน lifespan ของ FastAPI |
| การจำกัดคำขอ | เก็บในหน่วยความจำของ process (`rate_limit.py`) | ต้องรันแค่ 1 worker จนกว่าจะย้ายไปเก็บที่อื่น |
| ชุดทดสอบ | 266 รายการ ยิงผ่าน HTTP จริงไปยัง server ที่เปิดในเทสต์ (`tests/test_app.py` สร้าง `ThreadingHTTPServer`) | เทสต์ระดับ HTTP ใช้ตรวจความเหมือนเดิมได้ทันที ต้องเปลี่ยนแค่ส่วนที่เปิด server |
| Python | 3.10.11 | รองรับ FastAPI รุ่นปัจจุบัน |

---

## 3. แนวทาง: ย้ายเป็น 3 ระยะ ไม่รื้อทีเดียว

### ระยะที่ 1 — เปลี่ยนตัว server แต่ controller เดิมทั้งหมด (งานหลักของรอบนี้)

```text
ก่อน:  http.server ──► Handler.route_request() ──► controller(req)
หลัง:  uvicorn ──► FastAPI (route เดียวรับทุก /api/*) ──► dispatch() ──► controller(req เดิมหน้าตาเหมือนเดิม)
```

1. **แยกตรรกะการ route ออกจาก `Handler`** ไปไว้ใน `backend/http/dispatch.py` ที่ไม่ขึ้นกับ server ตัวไหน
   (ลำดับ page → webhook → portal → customer → public → session → account → platform → workspace เหมือนเดิมทุกขั้น)
2. **สร้าง `RequestAdapter`** ที่มีครบ 14 อย่างที่ controller ใช้ โดย `send()` และ `send_download()` เก็บคำตอบไว้
   แทนการเขียนลง socket แล้ว FastAPI ส่งออกเป็น `Response`
3. **สร้าง `backend/asgi.py`** มี route เดียวรับทุก method ของ `/api/{path:path}` แล้วเรียก `dispatch()`
   - endpoint เป็นแบบ sync เพราะ controller และ SQLite เป็น sync อยู่แล้ว FastAPI จะรันใน threadpool ให้เอง
   - เริ่มและหยุดงานเบื้องหลังทั้ง 4 ตัวใน lifespan
4. **ใส่ security header ชุดเดิม** (`SECURITY_HEADERS`) ให้ทุกคำตอบ รวมถึงคำตอบ error
5. **เก็บ `http.server` เดิมไว้ใช้คู่กันชั่วคราว** เลือกด้วยตัวแปรสภาพแวดล้อม เพื่อย้อนกลับได้ทันทีถ้าเจอปัญหา

### ระยะที่ 2 — ค่อย ๆ เปลี่ยนเป็น router ของ FastAPI จริง ทีละโมดูล (ทำหลังระยะ 1 นิ่งแล้ว)
- ใช้ `Depends` แทนระดับสิทธิ์ (workspace, customer ฯลฯ)
- ใช้ pydantic แทนการตรวจข้อมูลเข้าที่เขียนเองใน `schema.py`
- เอกสาร API อัตโนมัติ (`/docs`) **ปิดใน production** หรือเปิดเฉพาะผู้ดูแลแพลตฟอร์ม

### ระยะที่ 3 — งานที่ต่อยอดได้เมื่อมี FastAPI แล้ว
- เปลี่ยนโค้ดเข้ารหัสไปใช้ไลบรารีมาตรฐาน
- ย้ายการจำกัดคำขอและ session ไปเก็บนอก process เพื่อรันหลาย worker ได้
- ย้ายไป PostgreSQL

---

## 4. จุดที่ต้องระวังเป็นพิเศษ

| จุด | ของเดิมทำอะไร | ต้องทำใน FastAPI |
|---|---|---|
| ขนาดข้อมูลเข้า | จำกัด JSON ที่ 8 MB (`MAX_JSON_BYTES`) และ 415 ถ้าไม่ใช่ JSON | uvicorn ไม่จำกัดให้ ต้องตรวจเองก่อนอ่าน body ให้ได้ status และข้อความภาษาไทยชุดเดิม |
| Webhook (LINE, Facebook) | อ่าน body ดิบเพื่อตรวจลายเซ็น (`req.rfile`) | ให้ adapter คืน body ดิบแบบเดียวกัน ห้ามแปลง JSON ก่อนตรวจลายเซ็น |
| IP และ Host ของผู้ใช้ | `security.py` เชื่อ header จาก Next.js เฉพาะเมื่อมาจากเครื่องเดียวกันหรือมีรหัสลับตรงกัน | **ปิด `--proxy-headers` ของ uvicorn** ไม่อย่างนั้น uvicorn จะเชื่อ `X-Forwarded-For` เองก่อนถึงโค้ดเรา ซึ่งเปิดช่องให้ปลอม IP หลบการจำกัดคำขอได้ |
| Cookie | ใส่ `Secure` ตาม `server.secure_cookies` | adapter ต้องมี `req.server.secure_cookies` ที่อ่านจากการตั้งค่าเดิม |
| คำตอบที่ไม่ใช่ JSON | route ระดับ `page` และไฟล์ดาวน์โหลด ส่ง content-type อื่นพร้อม `Content-Disposition` | ส่งเป็น `Response` ดิบ ห้ามให้ FastAPI แปลงเป็น JSON |
| Error | `APIError` เป็น JSON `{error: "ข้อความไทย"}` และ error อื่นเป็น 500 ข้อความกลาง | ใช้ `error_response()` ตัวเดิม ห้ามให้ FastAPI คืนหน้า error ของตัวเอง (เช่น 422 ของ pydantic, 404/405 ภาษาอังกฤษ) |
| การบันทึกสถิติ | `monitor.record()` เวลาตอบสนองรายส่วนของ API | เรียกจุดเดียวกันหลังได้คำตอบ |
| Log | ตั้งใจไม่พิมพ์ query string เพราะอาจมีคำค้นของผู้ใช้ | ปิด access log ของ uvicorn หรือทำ formatter ที่ตัด query ออก |
| Timeout | ตั้ง socket timeout 30 วินาที | ตั้ง `timeout_keep_alive` ของ uvicorn และยังมี Next.js คั่นหน้าอยู่แล้ว |
| Worker | 1 process หลาย thread | uvicorn 1 worker เท่านั้นในระยะนี้ (การจำกัดคำขอ, SQLite และงานเบื้องหลังอยู่ใน process เดียว) |

---

## 5. เกณฑ์ว่าย้ายสำเร็จ

1. **เทสต์ครบ:** ชุดทดสอบ 266 รายการผ่านบน uvicorn เท่ากับบน server เดิม (ยกเว้น 3 รายการสิทธิ์ไฟล์บน Windows)
2. **API ครบ:** ทั้ง 241 route ตอบได้ ตรวจด้วยสคริปต์ไล่ทุก route เทียบกับ server เดิม
3. **คำตอบเหมือนเดิม:** status, header ความปลอดภัย, cookie และข้อความ error ตรงกันทั้งกรณีปกติและกรณี error
   (ไม่ได้เข้าสู่ระบบ, ไม่มีสิทธิ์, JSON ผิด, ข้อมูลใหญ่เกิน, ยิงถี่เกิน)
4. **ใช้งานจริงผ่านหน้าเว็บ:** ทดสอบผ่าน Next.js ทั้งฝั่งทีมงาน ฝั่งลูกค้า และ webhook ของ LINE
5. **ความเร็ว:** เวลาตอบสนองไม่แย่กว่าเดิม
6. **ย้อนกลับได้:** สลับกลับไป server เดิมได้ด้วยตัวแปรสภาพแวดล้อมตัวเดียว

---

## 6. เรื่องที่ต้องตัดสินใจก่อนเริ่ม

| เรื่อง | ข้อเสนอ |
|---|---|
| **นโยบาย "Python standard library เท่านั้น"** | ต้องเปลี่ยนนโยบาย เพราะ FastAPI เป็นไลบรารีภายนอก แก้ `requirements.txt`, README และหัวข้อสถาปัตยกรรมใน `docs/SCOPE.md` |
| **แพ็กเกจและเวอร์ชัน** | `fastapi` (ล่าสุด 0.141.1) และ `uvicorn` (ล่าสุด 0.53.0) ซึ่งดึง `starlette` และ `pydantic` มาเอง **ล็อกเวอร์ชันตรงตัว**ใน `requirements.txt` ตอนติดตั้งจริง |
| **การ deploy** | แก้คำสั่งเริ่มของบริการ Python ใน `render.yaml` และสคริปต์ `Start Bookdose.bat` / `.command` ให้ใช้ uvicorn และเพิ่มขั้น `pip install` |
| **ช่วงเวลาที่เก็บ server เดิมไว้** | เก็บไว้ 1 รอบการใช้งานจริง แล้วค่อยลบ |
| **ลำดับเทียบกับงานอื่น** | เริ่มหลังรอบภาพรวมองค์กรที่กำลังทำอยู่จบ เพราะแตะไฟล์ร่วมกัน (`server.py`, controller) |

---

## 7. วิธีทำงาน

ใช้ workflow หลาย agent แบบรอบก่อน ๆ:

| ขั้น | งาน |
|---|---|
| 1 | แยก `dispatch.py` ออกจาก `Handler` แล้วยืนยันว่าเทสต์ทั้งชุดยังผ่านบน server เดิม (ยังไม่ติดตั้งอะไร) |
| 2 | ติดตั้ง FastAPI/uvicorn แบบล็อกเวอร์ชัน, สร้าง `RequestAdapter` และ `asgi.py`, ย้ายงานเบื้องหลังไป lifespan |
| 3 | ให้ชุดทดสอบเลือก server ได้ แล้วรันครบบนทั้งสองแบบ + สคริปต์เทียบคำตอบครบ 241 route |
| 4 | ตรวจความปลอดภัยเฉพาะจุดเสี่ยงในหัวข้อ 4 (IP/proxy header, ขนาดข้อมูล, error, webhook) |
| 5 | แก้ตามผลตรวจ, อัปเดต `render.yaml`, สคริปต์เปิดโปรแกรม และเอกสาร |

**ขั้นที่ 1 ปลอดภัยที่สุดและทำได้ก่อนตัดสินใจเรื่องนโยบาย** เพราะยังไม่เพิ่ม dependency และถ้าหยุดแค่นั้น
โค้ดก็เป็นระเบียบขึ้นอยู่แล้ว
