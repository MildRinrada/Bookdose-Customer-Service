# หน้าเว็บ Bookdose Customer Service

หน้าเว็บของระบบ เขียนด้วย Next.js 16 (App Router), React 19 และ TypeScript ข้อมูลทั้งหมดมาจาก API ของ Python เบราว์เซอร์คุยกับแอปนี้ที่เดียว ส่วนคำขอ `/api/*` แอปส่งต่อให้ API เอง

## คำสั่ง

```sh
npm install         # ติดตั้งแพ็กเกจ
npm run dev         # โหมดพัฒนา ที่ http://localhost:3000
npm run typecheck   # ตรวจ type
npm run lint        # ตรวจ lint
npm run build       # build สำหรับใช้งานจริง
npm start           # เปิดผลการ build
```

ต้องเปิด API (`python app.py`) ที่โฟลเดอร์หลักของโปรเจกต์ด้วย

## เอกสาร

| เรื่อง | เอกสาร |
|---|---|
| วิธีรัน และตัวแปรแวดล้อม | [docs/getting-started.md](../docs/getting-started.md) |
| build สำหรับใช้งานจริง | [docs/deployment.md](../docs/deployment.md) |
| โครงสร้างโค้ดและกติกาการเขียน | [docs/code-structure.md](../docs/code-structure.md) |
| หลักการออกแบบหน้าจอ | [docs/ui-ux.md](../docs/ui-ux.md) |
| การอัปเดตสด | [docs/realtime.md](../docs/realtime.md) |
| CSP และการป้องกันคำขอ | [docs/security/request-protection.md](../docs/security/request-protection.md) |
