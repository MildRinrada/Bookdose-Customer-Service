import Link from 'next/link';
import { EmptyState } from '@/components/ui/display';

export default function NotFound() {
  return (
    <main className="single-page">
      <EmptyState title="ไม่พบหน้านี้" description="ลิงก์อาจไม่ถูกต้อง หรือหน้านี้ถูกย้ายไปแล้ว" icon="search">
        <Link className="btn primary" href="/">
          กลับหน้าหลัก
        </Link>
      </EmptyState>
    </main>
  );
}
