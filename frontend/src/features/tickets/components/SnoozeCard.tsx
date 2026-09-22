'use client';

import { useCallback, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { snoozeTicket, TICKET_PREFIXES, wakeTicket } from '../api';
import { isSnoozed, snoozeChoices, snoozeUntilText } from '../labels';
import type { Ticket } from '../types';

/* พักเคสไว้ก่อน (the case screen's aside, and the wake button the list uses).

   The case that is waiting for the customer's slip, for a supplier, for tomorrow morning, is not work anybody can do
   now - but it sits in the queue anyway and everything beside it has to be read past it. Putting it down takes it out
   of the working lists until the moment it is worth looking at again, and then the server hands it back on its own.

   Two things the card says out loud, because a pause that hides either of them is a pause nobody should trust:
   the SLA clock keeps running while the case sleeps (the promise is the customer's, not something stepping away can
   move), and a customer who writes in the meantime wakes it at once - the reason it was put down has arrived.

   Markup: pages/tickets/snooze-card, snooze-chip. */

/** Back into the queue now: toasts and refreshes the case, the list and the overview. Resolves true when it worked. */
export function useWakeTicket() {
  const toast = useToast();
  const refresh = useInvalidate();
  return useCallback(
    async (id: string, number: number) => {
      try {
        await wakeTicket(id);
        toast(`BD-${number} กลับเข้าคิวแล้ว`);
        await refresh(...TICKET_PREFIXES);
        return true;
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), true);
        return false;
      }
    },
    [toast, refresh],
  );
}

/** "พักไว้ถึง พรุ่งนี้ 09:00" beside a case in a list. */
export function SnoozeChip({ until, note }: { until: string; note?: string }) {
  return (
    <span className="snooze-chip" title={note ? `พักไว้: ${note}` : 'พักไว้'}>
      <Icon name="clock" />
      พักถึง {snoozeUntilText(until)}
    </span>
  );
}

export function SnoozeCard({ ticket }: { ticket: Ticket }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const wake = useWakeTicket();
  const [note, setNote] = useState('');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const paused = isSnoozed(ticket);
  const done = ['resolved', 'closed'].includes(ticket.status);

  const put = async (when: Date) => {
    setBusy(true);
    try {
      await snoozeTicket(ticket.id, when.toISOString(), note);
      toast(`พัก BD-${ticket.number} ไว้ถึง ${snoozeUntilText(when.toISOString())}`);
      setNote('');
      setCustom('');
      await refresh(...TICKET_PREFIXES);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy(false);
    }
  };

  if (done) return null;

  if (paused)
    return (
      <section className="card info-block snooze-card paused">
        <h3>พักไว้อยู่</h3>
        <p className="snooze-until">
          <Icon name="clock" />
          กลับมา {snoozeUntilText(ticket.snoozed_until)}
        </p>
        {ticket.snooze_note && <p className="snooze-note">{ticket.snooze_note}</p>}
        <p className="tiny muted">พักโดย {ticket.snoozed_by || 'ทีมงาน'} · ลูกค้าตอบเมื่อไร กลับเข้าคิวทันที · SLA ยังเดินอยู่</p>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            if (!(await wake(ticket.id, ticket.number))) setBusy(false);
          }}
        >
          <Icon name="restore" />
          เอากลับเข้าคิวเลย
        </button>
      </section>
    );

  return (
    <section className="card info-block snooze-card">
      <h3>พักเคสไว้ก่อน</h3>
      <p className="tiny muted">เคสจะหายจากคิวงาน แล้วเด้งกลับมาเองตามเวลาที่เลือก</p>
      <label className="sr-only" htmlFor="snooze-note">
        รอเรื่องอะไร
      </label>
      <input
        id="snooze-note"
        value={note}
        maxLength={200}
        disabled={busy}
        placeholder="รอเรื่องอะไร เช่น รอลูกค้าส่งสลิป"
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="snooze-choices">
        {snoozeChoices.map((choice) => (
          <button key={choice.value} type="button" className="btn sm" disabled={busy} onClick={() => void put(choice.when())}>
            {choice.label}
          </button>
        ))}
      </div>
      <div className="snooze-custom">
        <label className="sr-only" htmlFor="snooze-when">
          เลือกวันและเวลาเอง
        </label>
        <input id="snooze-when" type="datetime-local" value={custom} disabled={busy} onChange={(e) => setCustom(e.target.value)} />
        <button
          type="button"
          className="btn sm"
          disabled={busy || !custom}
          onClick={() => {
            const when = new Date(custom);
            if (Number.isNaN(when.getTime())) toast('เวลาที่เลือกไม่ถูกต้อง', true);
            else void put(when);
          }}
        >
          <Icon name="clock" />
          พักถึงเวลานี้
        </button>
      </div>
      <p className="tiny muted">SLA ยังเดินอยู่ระหว่างพัก · ลูกค้าตอบเมื่อไร เคสกลับเข้าคิวทันที</p>
    </section>
  );
}
