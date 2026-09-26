# ใช้ n8n เป็น AI ขององค์กร

`Customer Service AI.json` คือ workflow ของ n8n ที่ให้ AI Agent ทำงาน AI ทุกอย่างของ Bookdose แทนการที่ Bookdose เรียกผู้ให้บริการ AI เอง ค่าเริ่มต้นของ workflow ใช้โหนด Google Gemini Chat Model รุ่น `gemini-3.1-flash-lite` เปลี่ยนเป็นโมเดลอื่นได้ใน n8n เช่น OpenAI หรือโมเดลที่รันบนเครื่อง

```text
Bookdose ส่งงาน AI (Webhook) → แยกตามงาน → เตรียมคำขอ → AI Agent ← โมเดล → ตรวจและจัดรูปคำตอบ → ตอบกลับ Bookdose
```

## งานที่ส่งมา

| งานใน Bookdose | mode |
|---|---|
| ร่างคำตอบให้ทีมงาน และปุ่มทดสอบการเชื่อมต่อ | `draft`, `test` |
| ผู้ช่วย AI มุมขวาล่างของหน้าทีมงาน | `ask` |
| Chatbot ตอบลูกค้าในแชทบนเว็บ ปุ่มแชทบนเว็บไซต์ LINE และอีเมล | `bot` |
| ร่างบทความจากคำถามที่ยังไม่มีคำตอบ และสรุปประจำวัน | `article`, `brief` |
| อ่านอารมณ์ลูกค้า สรุปบทสนทนา และแปลภาษา | `mood`, `summary`, `translate` |

workflow แยกงานเป็น 3 กลุ่มตาม `feature` คือ ผู้ช่วยตอบ (`assist`), Chatbot (`chatbot`) และคำแนะนำ (`insights`) งานอ่านอารมณ์ สรุป และแปลภาษา เข้ากลุ่มผู้ช่วยตอบ

Bookdose ส่งกติกา (instructions) และรูปแบบคำตอบ (JSON Schema) ของแต่ละงานมาเอง จึงไม่ต้องเขียน prompt ใน AI Agent

## ติดตั้ง

1. ใน n8n เลือก **Workflows → Import from File** แล้วเลือก `Customer Service AI.json` ถ้ามี workflow นี้อยู่แล้ว ให้ลบของเดิมก่อน หรือนำเข้าแล้วปิดตัวเก่า
2. ใน Bookdose ไปที่ **ตั้งค่าองค์กร → AI Assistant** กด **สร้างรหัสลับ** แล้วคัดลอกไว้
3. เปิดโหนด **Bookdose ส่งงาน AI** ตั้ง Credential แบบ Header Auth โดย Name คือ `X-Bookdose-Secret` และ Value คือรหัสลับจากข้อ 2
4. เปิดโหนด **Google Gemini Chat Model** เลือก credential และโมเดล หรือแทนด้วยโหนดโมเดลของผู้ให้บริการอื่น
5. กด **Active** แล้วคัดลอก **Production URL** ของโหนด Webhook
6. ใน Bookdose ใส่ Webhook URL และรหัสลับ เปิดงานที่ต้องการ แล้วกดบันทึก
7. กด **ทดสอบการเชื่อมต่อ**

อย่าใช้ Test URL (`/webhook-test/...`) เพราะใช้ได้เฉพาะตอนกด "Listen for test event" ใน n8n

## ข้อห้ามและข้อควรรู้

- **อย่าต่อ Memory เข้า AI Agent** Bookdose ส่งประวัติแชทที่เกี่ยวข้องมาให้ทุกครั้งอยู่แล้ว memory จะจำข้ามงาน ข้อมูลของลูกค้าหรือองค์กรหนึ่งอาจไปโผล่ในคำตอบของอีกคน
- **Chatbot ตอบลูกค้าได้เฉพาะเมื่ออ้างข้อความจากบทความที่เผยแพร่จริง** Bookdose ตรวจทุกคำตอบอีกชั้น ถ้าอ้างอิงไม่ตรง จะส่งเรื่องให้เจ้าหน้าที่แทน
- **จำนวน token** AI Agent ไม่บอกจำนวน token ที่ใช้ หน้า AI ของ Bookdose จึงแสดง 0 tokens และนับเป็นจำนวนงาน ดูค่าใช้จ่ายจริงในบัญชีของผู้ให้บริการโมเดล
- **เวลารอ** Bookdose รอคำตอบจาก workflow นานสุด 5 นาทีต่องาน และทำทีละงานต่อองค์กร
- **URL ที่ใช้ได้** n8n บนเครื่องเดียวกัน (`http://localhost:5678/...`) ใช้ได้เมื่อ Bookdose ติดตั้งไว้ใช้บนเครื่องเดียว นอกนั้นต้องเป็น `https://` สาธารณะ เช่น n8n Cloud
- **ข้อมูลที่ส่งไป** ไม่มีชื่อ อีเมล หรือเบอร์โทรของลูกค้า และ Chatbot ไม่เห็นบันทึกภายใน ผู้ช่วย AI เห็นเลขเคส หัวเรื่อง ชื่อทีมงาน ทีม และป้ายเคสที่ทีมงานคนนั้นมีสิทธิ์เห็น
- **ผู้ช่วย AI สั่งงาน** คำตอบของ `ask` มีรายการ `actions` ที่ผู้ช่วยเสนอ workflow ส่งต่อตามที่ได้รับ ไม่ต้องแก้อะไร Bookdose ตรวจทุกรายการกับข้อมูลที่ส่งไปและสิทธิ์ของทีมงาน และทำเมื่อทีมงานกดยืนยันเท่านั้น
- **กลับไปใช้ผู้ให้บริการเดิม** ในหน้า AI ติ๊ก "เลิกใช้ n8n Webhook" แล้วบันทึก

## รูปแบบคำขอและคำตอบ

Bookdose ส่ง `POST` พร้อม header `X-Bookdose-Secret` และ JSON

```json
{
  "mode": "draft | test | ask | bot | article | brief | mood | summary | translate",
  "feature": "assist | chatbot | insights",
  "instructions": "กติกาของงาน",
  "schema": { "JSON Schema ของคำตอบ": "..." },
  "input": "ข้อมูลของงาน (ข้อความ JSON)",
  "max_output_tokens": 1000
}
```

และรอรับ JSON (หรือ list ที่มีรายการเดียวแบบนี้)

```json
{ "result": { "คำตอบตาม schema": "..." }, "usage": { "input_tokens": 0, "output_tokens": 0 } }
```

รายละเอียดของงาน AI ทั้งหมดอยู่ใน [docs/features/ai.md](../../docs/features/ai.md)
