# การป้องกันระดับคำขอ

ส่วนหนึ่งของ [ความปลอดภัย](README.md)

## Security header

มี 2 ชุด เพราะคำตอบของ API กับของหน้าเว็บมาจากคนละ process

### คำตอบของ API ทุกคำตอบ

`backend/middleware/security.py`

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self';
  img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self';
  frame-ancestors 'none'; base-uri 'none'; form-action 'self'
Cache-Control: no-store
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
```

### หน้าเว็บทุกหน้า

`frontend/src/proxy.ts` สร้าง nonce ใหม่ทุกคำขอ แล้วประกอบนโยบาย

```text
default-src 'self'; script-src 'self' 'nonce-<สุ่มใหม่>' 'strict-dynamic' <Turnstile>;
style-src 'self' 'nonce-<สุ่มใหม่>'; img-src 'self' data: blob: https:; media-src 'self' blob:;
connect-src 'self' ws://<host> wss://<host>; object-src 'none'; frame-src 'self' <Turnstile>;
frame-ancestors 'none'; base-uri 'none'; form-action 'self'
```

### การใส่ในกรอบ

`frame-ancestors 'none'` ใช้กับทุกหน้า ยกเว้นหน้าแชทแบบฝัง `/support/<org>/embed` (และที่อยู่เก่า `/chat/<org>/embed`) ซึ่งอนุญาตเฉพาะเว็บไซต์ที่องค์กรนั้นระบุไว้เอง และเป็น `'none'` เมื่อปิดปุ่มแชทบนเว็บไซต์

### ผลต่อการเขียนหน้าเว็บ

- `style-src` ไม่มี `'unsafe-inline'` จึง **ห้ามมี inline style** โค้ดหน้าเว็บไม่มี `style={{...}}` เลย ตำแหน่งที่ต้องคำนวณตอนรันตั้งผ่าน `element.style.setProperty`
- `dangerouslySetInnerHTML` ใช้เพียง 2 จุดและตั้งใจทั้งคู่
  - สคริปต์ตั้งค่าเริ่มต้นใน `frontend/src/app/layout.tsx` เป็นข้อความคงที่ในโค้ดและถือ nonce ของคำขอนั้น
  - `frontend/src/features/rich/Markdown.tsx` escape ทุกอย่างก่อน แล้วจึงสร้างเฉพาะแท็กในรายการที่อนุญาต
- อีเมลที่ส่งออกใช้ตัวแปลง Markdown ชุดเดียวกัน (`backend/utils/markdown.py`) ข้อความตอบกลับจึงพา markup ของตัวเองเข้าไปในโปรแกรมอ่านอีเมลไม่ได้

## Host และ Origin

- โฮสต์ที่ไม่คาดหมายถูกปฏิเสธ กัน DNS rebinding
- คำขอที่เปลี่ยนข้อมูลซึ่งส่งมาจากเว็บไซต์อื่นถูกปฏิเสธ
- WebSocket ต้องมี Origin เป็นเว็บไซต์ของเราเอง
- ทุกครั้งที่ปฏิเสธบันทึกเป็นเหตุการณ์ `origin_rejected`

## ขนาดและชนิดของคำขอ

- body แบบ JSON ไม่เกิน 8 MB ชนิดอื่นตอบ 415
- header รวมไม่เกิน 64 KB
- รอ body ไม่เกิน 30 วินาที

## การจำกัดคำขอ

`backend/middleware/rate_limit.py` ตัวอย่างค่าที่ใช้จริง

| การกระทำ | เพดาน |
|---|---|
| อ่าน และเขียน ของฝั่งสาธารณะ | 180 และ 30 ครั้งต่อนาที |
| เข้าสู่ระบบ | 15 ครั้งต่อ 15 นาที ต่อ IP |
| สมัครและลืมรหัสผ่าน | 5 ครั้งต่อ 15 นาที ต่อ IP |
| การยืนยันสองขั้นตอนของลูกค้า | 20 ครั้งต่อ 15 นาที ต่อ IP |
| เริ่มแชทผู้เยี่ยมชม | 5 เรื่องต่อชั่วโมงต่อ IP และ 10 เรื่องต่อวันต่อผู้เยี่ยมชม |
| ขอลิงก์ติดตามแชท | 3 ครั้งต่อชั่วโมงต่อผู้เยี่ยมชมและต่อปลายทาง 10 ครั้งต่อชั่วโมงต่อ IP |
| ขอร่างคำตอบจาก AI | 10 ครั้งต่อ 60 วินาทีต่อคน |
| ถามผู้ช่วย AI | 30 ครั้งต่อชั่วโมงต่อคน |
| รายงานปัญหาถึงผู้ดูแลแพลตฟอร์ม | 5 ครั้งต่อ 10 นาทีต่อคน |

เมื่อชนเพดานตอบ 429 พร้อม `Retry-After` หน้าเว็บจึงบอกผู้ใช้ได้ว่าต้องรออีกนานเท่าไร

IP ที่ใช้นับคือที่อยู่ของ socket หรือ `X-Bookdose-Client-IP` จากหน้าเว็บที่เชื่อถือได้ ไม่เชื่อ `X-Forwarded-For` ที่มาจากอินเทอร์เน็ตโดยตรง

## Webhook

LINE และ Meta ตรวจลายเซ็นบน **ไบต์ดิบที่ส่งมาจริง** ไม่ใช่ JSON ที่แปลงแล้ว เทียบด้วย `hmac.compare_digest` (`backend/modules/channels/controller.py`)

- LINE ใช้ `X-Line-Signature` และ Meta ใช้ `X-Hub-Signature-256`
- body ไม่เกิน 2 MB
- ลายเซ็นไม่ตรงตอบ 403 และบันทึกเป็น `webhook_signature_failed` โดยไม่เก็บเนื้อหา

## ไฟล์อัปโหลด

`backend/utils/files.py` ตรวจ **ลายเซ็นในตัวไฟล์** ไม่ใช่นามสกุลหรือ Content-Type

- ชนิดที่รับ: PNG, JPEG, GIF, WebP, PDF, MP4, WebM และข้อความ UTF-8 ที่ไม่มีไบต์ศูนย์
- ไฟล์ที่ตั้งชื่อว่า `.png` แต่ข้างในเป็นอย่างอื่นจึงผ่านไม่ได้
- ไม่เกิน 3 ไฟล์ต่อข้อความ รวมไม่เกิน 5 MB
- ไฟล์แนบในบันทึกภายในเปิดได้เฉพาะทีมงานที่มีสิทธิ์ในบทสนทนานั้น

## ไฟล์ CSV ที่ส่งออก

เซลล์ที่โปรแกรมตารางคำนวณจะรันเป็นสูตรได้รับเครื่องหมาย `'` นำหน้า (`frontend/src/features/tickets/csv.ts`)

## ฟอร์มสาธารณะ

- **ช่องซ่อน** ในฟอร์มเข้าสู่ระบบ สมัคร ลืมรหัสผ่าน และเริ่มแชทผู้เยี่ยมชม ถ้าถูกกรอก คำขอถูกปฏิเสธด้วยคำตอบแบบความล้มเหลวปกติ ดู [การเฝ้าระวังและกับดัก](monitoring-and-traps.md)
- **ฟอร์มเริ่มแชทที่ส่งเร็วกว่า 2 วินาที** หลังเปิด ถือว่าเป็นบอต
- **Cloudflare Turnstile** ใช้กับฟอร์มเริ่มแชทผู้เยี่ยมชมเมื่อแพลตฟอร์มเปิดไว้ token ของผู้เยี่ยมชมที่ขาด ผิด หมดอายุ หรือใช้ซ้ำ ถูกปฏิเสธ (`captcha_failed`) ส่วนความล้มเหลวของ Cloudflare เอง ไม่กันลูกค้าจริงออก คำขอไปต่อและบันทึก `captcha_unavailable`

## คำขอออกไปยังบริการภายนอก

คำขอที่มีความลับ เช่น ถึง OpenAI, LINE, Meta, ผู้ให้บริการ SMS และ Cloudflare ไม่ตาม redirect ความลับจึงไปถึงเฉพาะ URL ของผู้ให้บริการเอง และไม่ถูกเขียนลง log
