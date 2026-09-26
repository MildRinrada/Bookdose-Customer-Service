# Facebook และ Instagram

รับและตอบข้อความจากเพจ Facebook ขององค์กร (Messenger) และ DM ของบัญชี Instagram ที่ผูกกับเพจนั้น ทั้งสองใช้การเชื่อมต่อเดียวกัน ส่วนหนึ่งของ [ช่องทาง](README.md)

## เชื่อม Facebook Messenger

1. สร้างแอปใน [Meta for Developers](https://developers.facebook.com/) เพิ่มผลิตภัณฑ์ **Messenger** แล้วเชื่อมเพจขององค์กร สร้าง **Page Access Token** ที่มีสิทธิ์ `pages_messaging` และคัดลอก **App Secret** จาก App settings → Basic
2. ในระบบไปที่ **ตั้งค่าองค์กร → LINE / อีเมล / Facebook / Instagram → Facebook และ Instagram** เลือกทีมรับเรื่องใหม่ แล้วกด **บันทึก Facebook และ Instagram** โดยยังไม่ติ๊กเปิดใช้ ระบบสร้าง **Callback URL** และ **Verify Token** ให้
3. ใน Messenger → Webhooks ของแอป ใส่ Callback URL และ Verify Token กด Verify and Save แล้ว Subscribe เหตุการณ์ `messages` ของเพจ
4. กลับมาใส่ Page Access Token และ App Secret ติ๊ก **เปิดรับและส่ง Facebook Messenger** แล้วบันทึก ระบบตรวจ token กับ Graph API และผูกเพจกับองค์กร
5. ทักเพจจากบัญชี Facebook อื่น แล้วดูในกล่องข้อความ

Callback URL ต้องเป็น HTTPS สาธารณะ เช่น `https://support.example.com/api/webhooks/facebook/<route-id>`

เพจหนึ่งผูกได้องค์กรเดียว และเปลี่ยนเป็นเพจอื่นในช่องทางเดิมไม่ได้

## เปิด DM ของ Instagram

ใช้ Meta App, Page Access Token, App Secret, Callback URL และ Verify Token ชุดเดียวกับเพจ

1. บัญชี Instagram ต้องเป็นแบบธุรกิจหรือครีเอเตอร์ และผูกกับเพจ Facebook นี้
2. Page Access Token ต้องมีสิทธิ์ `instagram_manage_messages` เพิ่ม
3. ใน Meta App → Webhooks เลือก **Instagram** ใส่ Callback URL และ Verify Token เดิม แล้วติ๊ก `messages`
4. ในแอป Instagram เปิด การตั้งค่า → ความเป็นส่วนตัว → ข้อความ → **อนุญาตให้เข้าถึงข้อความ**
5. ในระบบเปิดสวิตช์ **รับและตอบ DM Instagram ของบัญชีที่ผูกกับเพจนี้** แล้วบันทึก ระบบถาม Meta ว่าเพจผูกกับบัญชี Instagram ไหน แล้วแสดง @ชื่อบัญชี

- ถ้าเพจยังไม่ผูกบัญชี Instagram ระบบไม่ยอมบันทึก และบอกว่าต้องผูกก่อน
- เปิดสวิตช์แล้วมีขั้นตอนรับ DM Instagram แบบติ๊กทีละข้อ
- ปิดสวิตช์แล้วระบบไม่รับและไม่ตอบ DM แต่ Messenger ยังทำงานต่อ

**สำหรับลูกค้าทั่วไป:** ขณะที่ Meta App อยู่ในโหมดพัฒนา รับได้เฉพาะข้อความจากคนที่มีสิทธิ์ในแอป ถ้าจะรับจากลูกค้าทั่วไป ต้องผ่าน App Review และยืนยันธุรกิจกับ Meta

## การรับข้อความ

- ตรวจลายเซ็น `X-Hub-Signature-256` จาก body ดิบด้วย App Secret ก่อนอ่าน JSON
- รับเฉพาะเหตุการณ์ของเพจและบัญชี Instagram ที่ผูกไว้
- ข้ามข้อความ echo ที่เพจหรือบัญชีส่งเอง ข้ามข้อความที่ลูกค้ากดยกเลิกส่ง และกันข้อความซ้ำด้วยรหัสข้อความ
- รับข้อความตัวอักษร ถ้าลูกค้าส่งไฟล์ ระบบบันทึกว่าให้ไปเปิดดูในกล่องข้อความของเพจหรือในแอป Instagram
- ชื่อลูกค้าเริ่มต้นแสดงท้ายรหัสผู้ใช้ ไม่เรียกข้อมูลโปรไฟล์เพิ่ม
- บทสนทนาและคิวส่งเก็บชนิดแยก (`facebook` หรือ `instagram`) กล่องข้อความ ตัวกรอง รายงาน และกฎรับเรื่องจึงแยก Instagram ออกจาก Facebook ได้
- คนเดียวกันที่ทักทั้ง Messenger และ Instagram แยกเป็นคนละบทสนทนา

## การตอบ

| | Facebook Messenger | Instagram |
|---|---|---|
| ส่งได้ | เฉพาะข้อความ | เฉพาะข้อความ |
| ความยาวสูงสุด | 2,000 ตัวอักษร | 1,000 ตัวอักษร |
| ช่วงที่ตอบได้ | ภายใน 24 ชั่วโมงหลังข้อความล่าสุดของลูกค้า | ภายใน 24 ชั่วโมงหลังข้อความล่าสุดของลูกค้า |

- ใช้ Send API แบบ `messaging_type: RESPONSE`
- หลัง 24 ชั่วโมง Meta ปฏิเสธ และแสดงเป็นส่งไม่สำเร็จ
- Send API ไม่มีกุญแจกันส่งซ้ำ ถ้าเครือข่ายขาดระหว่างส่ง สถานะเป็น **ไม่ทราบผลการส่ง** และไม่ส่งซ้ำเอง
- ข้อผิดพลาดชั่วคราว (5xx หรือ 429) ลองใหม่สูงสุด 3 ครั้ง
- Chatbot ไม่ตอบบน Messenger และ Instagram ส่วนแบบประเมิน CSAT ข้อความนอกเวลาทำการ และ Macro ส่งได้เหมือนข้อความของทีม

## หน้าลูกค้า

เมื่อเปิด Instagram แล้ว หน้าช่วยเหลือขององค์กรแสดง @ชื่อบัญชี Instagram เป็นอีกช่องทางติดต่อ

## อ้างอิง

- [Messenger Platform Webhooks](https://developers.facebook.com/docs/messenger-platform/webhooks)
- [Send API](https://developers.facebook.com/docs/messenger-platform/reference/send-api/)
- [Instagram Messaging](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/messaging-api)
