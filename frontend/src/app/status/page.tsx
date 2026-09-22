import type { Metadata } from 'next';
import { StatusScreen } from '@/features/status/StatusScreen';

export const metadata: Metadata = { title: 'สถานะระบบ' };

/** /status: open to anyone, signed in or not. */
export default function Page() {
  return <StatusScreen />;
}
