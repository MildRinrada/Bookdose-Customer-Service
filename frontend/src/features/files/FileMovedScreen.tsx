import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { SinglePage } from '@/features/auth/components/Frames';

/* /files/<token>: the page a shared-file link shows once the file is gone. The same for every token, so nothing
   here tells one link from another. Markup: the single-page frame with the centred card of the customer link pages. */

export function FileMovedScreen() {
  return (
    <SinglePage>
      <section className="card mt customer-center">
        <div className="card-body">
          <span className="customer-center-icon">
            <Icon name="file" />
          </span>
          <h1>ไฟล์นี้ถูกย้ายหรือหมดอายุ</h1>
          <p>ลิงก์แชร์ไฟล์นี้ใช้งานไม่ได้แล้ว เจ้าของไฟล์อาจย้าย ลบ หรือยกเลิกการแชร์ หรือลิงก์หมดอายุตามเวลาที่กำหนดไว้</p>
          <p className="small muted">หากยังต้องการไฟล์นี้ กรุณาขอลิงก์ใหม่จากผู้ที่ส่งให้คุณ</p>
          <Link className="btn" href="/">
            <Icon name="back" />
            กลับหน้าหลัก
          </Link>
        </div>
      </section>
    </SinglePage>
  );
}
