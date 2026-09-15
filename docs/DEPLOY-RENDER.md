# นำ Bookdose Customer Service ขึ้น Render

ไฟล์ `render.yaml` เตรียม 2 บริการในสิงคโปร์ การมีไฟล์นี้ใน GitHub ยังไม่ได้สร้างบริการหรือเปิดเว็บไซต์ ต้องเชื่อมบัญชีและยืนยันสร้างบริการตามขั้นตอนด้านล่าง

| บริการ | ชนิด | หน้าที่ |
|---|---|---|
| `bookdose-customer-service` | Web Service (Node.js, โฟลเดอร์ `frontend/`) | หน้าเว็บ Next.js ที่ผู้ใช้เปิด ส่งต่อ `/api/*` ไปยัง API |
| `bookdose-api` | Private Service (Python, `app.py`) | API และข้อมูล พร้อมดิสก์ถาวร 1 GB เข้าถึงจากอินเทอร์เน็ตโดยตรงไม่ได้ |

ทั้งสองบริการใช้ `BOOKDOSE_PROXY_SECRET` ค่าเดียวกัน (Render สุ่มให้ใน Environment Group `bookdose-proxy`) API จึงเชื่อโดเมนและ IP ของผู้ใช้เฉพาะคำขอที่มาจากหน้าเว็บของเราเท่านั้น

## เชื่อมบัญชีและสร้างบริการ

1. เปิด [Deploy to Render](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FA10U%2Fbookdose-customer-service) และเข้าสู่ระบบ Render ด้วยบัญชีของคุณ
2. เชื่อม GitHub บัญชี **A10U** และให้ Render เข้าถึง repository **bookdose-customer-service** หากเป็น private repository ต้องอนุญาตผ่าน Render GitHub App ด้วย
3. ตรวจรายการบริการและค่าใช้จ่ายก่อนกดยืนยัน deploy: มี **2 บริการ** แบบ 0.5 CPU / 512 MB และ persistent disk 1 GB ที่บริการ API ไม่ใช้ Free เพราะฐานข้อมูล SQLite และไฟล์แนบต้องคงอยู่หลัง restart/deploy ดู [ราคา Render](https://render.com/pricing), [Private Services](https://render.com/docs/private-services) และ [ข้อกำหนดดิสก์ถาวร](https://render.com/docs/disks)
4. หากลิงก์ไม่เลือก repo ให้อัตโนมัติ ให้เปิด Render Dashboard → **New → Blueprint** แล้วเลือก repo และ branch `main` ใช้ไฟล์ `render.yaml`
5. รอจนทั้งสองบริการแสดง **Live** แล้วเปิด URL HTTPS ของ `bookdose-customer-service` ใช้ URL นั้นเป็นที่อยู่จริงของระบบ

## สร้างผู้ดูแลครั้งแรก

1. ในหน้าบริการ `bookdose-api` เปิด **Environment** และดูค่า `BOOKDOSE_SETUP_TOKEN` ที่ Render สุ่มสร้างให้ ค่านี้เป็นความลับ ใช้เฉพาะตอนตั้งค่าครั้งแรก ไม่ต้องส่งในแชตหรือบันทึกใน Git
2. เปิดเว็บไซต์ กรอกชื่อผู้ดูแล อีเมล รหัสผ่าน ชื่อองค์กร และรหัสองค์กร แล้ววางค่าดังกล่าวในช่อง **รหัสตั้งค่าระบบจากผู้ดูแลโฮสต์**
3. ถ้าจะเริ่มด้วยข้อมูลจริง ให้เอาเครื่องหมายเพิ่มเคสตัวอย่างออก แล้วกด **สร้างพื้นที่ทำงาน** ผู้ใช้รายอื่นจะสร้างผู้ดูแลแพลตฟอร์มก่อนคุณไม่ได้หากไม่มีรหัสตั้งค่า และหลังสร้างบัญชีแรกแล้ว API ตั้งค่าจะปิดโดยอัตโนมัติ
4. ตั้งทีม สมาชิก และช่องทางในระบบ บัญชีและเคสในเครื่องเดิมไม่ได้ย้ายขึ้นออนไลน์อัตโนมัติ การ deploy นี้เริ่มด้วยฐานข้อมูลใหม่
5. หากเปิดรับสมัครองค์กรใหม่ ให้ตั้งค่า SMTP ของแพลตฟอร์มและ Base URL เป็น URL HTTPS ของหน้าเว็บ (`bookdose-customer-service`) แล้วทดสอบส่งอีเมลยืนยันไปยังอีเมลของคุณ ส่วน LINE/OAuth ต้องใช้ callback/webhook URL ที่อ้างอิงโดเมนเดียวกันตาม [คู่มือช่องทาง](../CHANNELS.md)

บน Render ระบบปฏิเสธการตั้งค่าครั้งแรกหาก `BOOKDOSE_SETUP_TOKEN` ไม่มีค่าหรือสั้นกว่า 32 ตัวอักษร การรันในเครื่องโดยไม่กำหนดตัวแปรนี้ยังใช้ขั้นตอนเดิมได้

## ตรวจหลัง deploy

- เปิดเว็บไซต์และเข้าสู่ระบบผ่าน HTTPS แล้วสร้างเคสทดสอบ ตรวจว่ารับเรื่องและตอบกลับจากหน้าลูกค้าได้
- สั่ง restart บริการ `bookdose-api` แล้วตรวจว่าบัญชีและเคสทดสอบยังอยู่ `BOOKDOSE_DATA` ต้องเป็น `/var/data/bookdose` และดิสก์ต้อง mount ที่ `/var/data`
- Health check ของหน้าเว็บใช้ `/api/bootstrap` ซึ่งผ่านทั้ง Next.js และ API จึงตรวจได้ทั้งการส่งต่อคำขอและการอ่านฐานข้อมูล โดยไม่เปิดเผยรหัสตั้งค่า
- ทดสอบ AI, LINE และ Email ด้วยบัญชีจริงเมื่อกำหนดค่าบริการเหล่านั้นแล้ว ผลทดสอบใน repo ใช้บริการจำลอง

## อัปเดตและเก็บข้อมูล

Blueprint ปิด auto-deploy ไว้ หลัง push โค้ดรุ่นใหม่และทดสอบแล้ว ให้เลือก **Manual Deploy → Deploy latest commit** ทั้งสองบริการ (ถ้าแก้เฉพาะหน้าเว็บหรือเฉพาะ API ก็ deploy เฉพาะบริการนั้นได้) ดิสก์คงข้อมูลเดิมไว้ แต่อาจมีช่วงหยุดบริการสั้น ๆ ระหว่าง deploy บริการ API ใช้เพียง 1 instance เพราะมี SQLite และ worker ในโปรเซสเดียว

ข้อมูลเคส ไฟล์แนบ และคีย์บริการอยู่ใต้ดิสก์ถาวร ไม่อยู่ใน GitHub การลบบริการหรือดิสก์มีผลต่อข้อมูล ต้องสำรองก่อน การสำรองทั้งระบบและกู้คืนใช้ขั้นตอนใน [README](../README.md#สำรองและกู้คืน) โดยหยุดการเขียนข้อมูลก่อนสร้าง snapshot และเก็บคีย์บริการแยกต่างหากตามคู่มือ

การย้ายข้อมูลจากเครื่องเดิมต้องดำเนินการเป็นงานย้ายฐานข้อมูลพร้อมสำรองและตรวจสิทธิ์ ไม่ให้นำโฟลเดอร์ `data/`, `secrets/` หรือไฟล์สำรองเข้า Git

อ้างอิงการตั้งค่า: [Render Blueprint](https://render.com/docs/blueprint-spec), [Deploy button](https://render.com/docs/deploy-to-render), [Python version](https://render.com/docs/python-version), [Node version](https://render.com/docs/node-version)
