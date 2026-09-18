# ใช้ n8n (AI Agent) เป็น AI ขององค์กร

`Customer Service AI.json` คือ workflow ของ n8n ที่ตอบงาน AI ทุกอย่างของ Bookdose ด้วย **AI Agent**
(ค่าเริ่มต้นคือ OpenAI Chat Model `gpt-5-mini`) แทนการที่ Bookdose เรียก OpenAI เอง

```
Bookdose ส่งงาน AI (Webhook) → เตรียมคำขอ → AI Agent ← OpenAI Chat Model → ตรวจและจัดรูปคำตอบ → ตอบกลับ Bookdose
```

| งานใน Bookdose | mode ที่ส่งมา |
|---|---|
| **ผู้ช่วยตอบ (AI tool):** ร่างคำตอบให้เจ้าหน้าที่ / ปุ่มทดสอบการเชื่อมต่อ | `draft` / `test` |
| **ผู้ช่วย AI:** คำถามจากปุ่มผู้ช่วย AI มุมขวาล่างในหน้าทีมงาน (ตอบจากคลังความรู้ขององค์กร) | `ask` |
| **Chatbot:** ตอบลูกค้าในแชทบนเว็บ, chat widget บนเว็บไซต์ขององค์กร, LINE และอีเมล | `bot` |
| **คำแนะนำ:** ร่างบทความจากคำถามที่ยังไม่มีคำตอบ / สรุปประจำวันในหน้าภาพรวม | `article` / `brief` |

Bookdose ส่งกติกา (instructions) และรูปแบบคำตอบ (JSON Schema) ของแต่ละงานมาเอง จึงไม่ต้องเขียน prompt ใน AI Agent

Chat widget คือ `widget.js` ของ Bookdose ตั้งค่าที่ ตั้งค่าองค์กร → แชทบนเว็บ → โค้ดติดตั้งบนเว็บไซต์
- เมื่อเปิด Chatbot แล้ว widget จะตอบลูกค้าผ่าน workflow นี้
- ถ้า Chatbot ตอบไม่ได้ จะส่งเรื่องต่อให้เจ้าหน้าที่

## ติดตั้ง

1. ใน n8n เลือก Workflows → Import from File → เลือก `bookdose-ai.workflow.json`
   - ถ้ามี workflow นี้อยู่แล้ว ให้ลบของเดิมก่อน หรือนำเข้าแล้วปิดตัวเก่า
2. ในหน้า ตั้งค่าองค์กร → AI ของ Bookdose กด **สร้างรหัสลับ** แล้วคัดลอกไว้
3. เปิดโหนด **Bookdose ส่งงาน AI** แล้วตั้ง Credential แบบ Header Auth
   - Name: `X-Bookdose-Secret`
   - Value: รหัสลับจากข้อ 2
4. เปิดโหนด **OpenAI Chat Model** แล้วเลือก credential ของ OpenAI และโมเดล
5. กด **Active** แล้วคัดลอก **Production URL** ของโหนด Webhook
6. ในหน้า AI ของ Bookdose ใส่ Webhook URL และรหัสลับ เปิดโหมดที่ต้องการ แล้วกด **บันทึก**
7. กด **ทดสอบการเชื่อมต่อ**

อย่าใช้ Test URL (`/webhook-test/...`) เพราะใช้ได้เฉพาะตอนกด "Listen for test event" ใน n8n

## ข้อห้ามและข้อควรรู้

- **อย่าต่อ Memory เข้า AI Agent**
  - Bookdose ส่งประวัติแชทที่เกี่ยวข้องมาให้ทุกครั้งอยู่แล้ว
  - memory จะจำข้ามงาน ข้อมูลของลูกค้าหรือองค์กรหนึ่งอาจไปโผล่ในคำตอบของอีกคน
- **Chatbot ตอบลูกค้าได้เฉพาะเมื่ออ้างข้อความจากบทความที่เผยแพร่จริง**
  - Bookdose ตรวจทุกคำตอบอีกชั้น ถ้าอ้างอิงไม่ตรง จะส่งเรื่องให้เจ้าหน้าที่แทน
- **จำนวน token:** AI Agent ไม่บอกจำนวน token ที่ใช้
  - หน้า AI ของ Bookdose จึงแสดง 0 tokens และนับเป็นจำนวนงาน
  - ดูค่าใช้จ่ายจริงในบัญชี OpenAI
- **เวลารอ:** ระบบรอคำตอบจาก workflow นานสุด 5 นาทีต่องาน และทำทีละงาน
- **URL ที่ใช้ได้:**
  - n8n บนเครื่องเดียวกัน (`http://localhost:5678/...`) ใช้ได้เมื่อ Bookdose ติดตั้งไว้ใช้บนเครื่องเดียว
  - นอกนั้นต้องเป็น `https://` สาธารณะ เช่น n8n Cloud
- **ข้อมูลที่ส่งไป:** ไม่มีชื่อ อีเมล หรือเบอร์โทรของลูกค้า และ Chatbot ไม่เห็นบันทึกภายใน
- **กลับไปให้ Bookdose เรียก OpenAI เอง:** หน้า AI → ติ๊ก "เลิกใช้ n8n Webhook" แล้วบันทึก

## สิ่งที่ Bookdose ส่งและรอรับ

ส่ง `POST` พร้อม header `X-Bookdose-Secret` และ JSON:

```json
{
  "mode": "draft | test | ask | bot | article | brief",
  "feature": "assist | chatbot | insights",
  "instructions": "กติกาของงาน",
  "schema": { "JSON Schema ของคำตอบ": "..." },
  "input": "ข้อมูลของงาน (ข้อความ JSON)",
  "max_output_tokens": 1000
}
```

รอรับ JSON (หรือ list ที่มีรายการเดียวแบบนี้):

```json
{ "result": { "คำตอบตาม schema": "..." }, "usage": { "input_tokens": 0, "output_tokens": 0 } }
```
