/* The privacy notice a customer agrees to when signing up (template pages/customer/privacy-notice.html). Also shown
   on the customer's account page. */

export function PrivacyNotice({ organization }: { organization?: string | null }) {
  const name = organization || 'องค์กร';
  return (
    <>
      <p>{name} เก็บชื่อ อีเมล และเบอร์โทรศัพท์ (ถ้าให้ไว้) เพื่อยืนยันตัวตน ติดต่อกลับ และแจ้งความคืบหน้าเรื่องที่คุณส่ง</p>
      <p>
        ข้อความและไฟล์ที่คุณส่งเก็บในระบบบริการลูกค้าขององค์กร เข้าถึงได้เฉพาะทีมงานที่ดูแลเรื่องของคุณ ขอดู แก้ไข หรือลบข้อมูลได้โดยติดต่อ {name}
      </p>
    </>
  );
}
