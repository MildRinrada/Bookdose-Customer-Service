'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';

/* "ลืมรหัสผ่าน?" on the sign-in page (pages/auth/forgot-password.html). With the platform's email set up, customers
   and staff alike get a link to choose a new password themselves (which also lifts a lock from wrong passwords);
   without it, the only way back is the person who opened the account. */

export function ForgotPasswordHelp({ customerReset, forgotHref }: { customerReset: boolean; forgotHref: string }) {
  const { closeModal } = useDialogs();
  return (
    <>
      {customerReset ? (
        <>
          <p className="notice">
            <Icon name="mail" />
            ลูกค้าที่สมัครสมาชิกไว้: <Link href={forgotHref}>รับลิงก์ตั้งรหัสผ่านใหม่ทางอีเมล</Link>
          </p>
          <p className="notice">
            <Icon name="users" />
            ทีมงานขององค์กรและผู้ดูแลแพลตฟอร์ม: <Link href="/forgot-password">รับลิงก์ตั้งรหัสผ่านใหม่ทางอีเมล</Link>
          </p>
          <p className="small muted">การตั้งรหัสผ่านใหม่จะปลดล็อกบัญชีที่ถูกล็อกจากการกรอกรหัสผิดด้วย ไม่ต้องรอหรือติดต่อผู้ดูแล</p>
        </>
      ) : (
        <>
          <p>กรุณาติดต่อผู้ดูแลองค์กรหรือผู้ดูแลระบบ Bookdose ที่เปิดบัญชีให้คุณ พร้อมแจ้งอีเมลที่ใช้เข้าสู่ระบบ เพื่อให้ตรวจสอบและช่วยกู้คืนการเข้าใช้งาน</p>
          <p className="notice">ไม่ต้องส่งรหัสผ่านเดิมให้เจ้าหน้าที่ หากเป็นผู้ดูแลแพลตฟอร์ม ให้ติดต่อผู้รับผิดชอบติดตั้งระบบขององค์กร</p>
        </>
      )}
      <button type="button" className="btn" onClick={() => closeModal()}>
        ปิด
      </button>
    </>
  );
}
