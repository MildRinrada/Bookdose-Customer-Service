'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { takeNextTask } from '../api';
import type { NextTask } from '../types';

/* รับงานถัดไป: one click opens the case to work on now - the member's own past its SLA, then their own due within two
   hours, then the case of their team that has waited longest for anyone (it becomes theirs). The server picks, so
   two members never take the same case. */

const why: Record<NextTask['reason'], string> = {
  overdue: 'เกิน SLA แล้ว',
  due_soon: 'ใกล้ครบ SLA',
  unassigned: 'รับเป็นผู้รับผิดชอบแล้ว',
  mine: 'เคสของคุณที่ครบกำหนดก่อน',
  none: '',
};

export function NextTaskButton() {
  const router = useRouter();
  const toast = useToast();
  const refresh = useInvalidate();
  const [busy, setBusy] = useState(false);

  const take = async () => {
    setBusy(true);
    try {
      const next = await takeNextTask();
      if (!next.ticket) {
        toast('ไม่มีงานค้างสำหรับคุณตอนนี้ 🎉');
        return;
      }
      if (next.taken) await refresh('/api/tickets', '/api/conversations', '/api/automation/overview');
      toast(`BD-${next.ticket.number} · ${why[next.reason]}`);
      router.push(`/tickets/${next.ticket.id}`);
    } catch (error) {
      toast((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="btn primary next-task"
      onClick={() => void take()}
      disabled={busy}
      title="เปิดเคสที่ควรทำก่อน: เคสของคุณที่เกินหรือใกล้ครบ SLA แล้วจึงรับเคสในทีมที่รอนานที่สุด"
    >
      <Icon name="bolt" />
      {busy ? 'กำลังหางาน…' : 'รับงานถัดไป'}
    </button>
  );
}
