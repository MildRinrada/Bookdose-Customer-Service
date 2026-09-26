import type { Metadata } from 'next';
import { FileMovedScreen } from '@/features/files/FileMovedScreen';

/* /files/<token>: looks like a shared file whose link has run out. Every token gets the same page; src/proxy.ts
   reports the visit to the API, which knows whether the token is a honeytoken (docs/security/monitoring-and-traps.md). */

export const metadata: Metadata = {
  title: 'ไฟล์ไม่พร้อมใช้งาน · Bookdose',
  robots: { index: false, follow: false },
};

export default function FilePage() {
  return <FileMovedScreen />;
}
