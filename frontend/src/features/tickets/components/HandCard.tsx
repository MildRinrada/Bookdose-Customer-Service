'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { isDone, shortAgo } from '@/lib/format';
import { useInvalidate } from '@/lib/query';
import { useStaffUser, useWork } from '@/lib/session';
import type { Hand } from '@/lib/types';
import { helpHand, lowerHand, raiseHand, TICKET_PREFIXES } from '../api';
import type { Ticket } from '../types';
import { FoldCard } from './FoldCard';

/* ยกมือขอช่วย (the case screen's aside, and the chip the case lists show).

   A member stuck on a case raises their hand here instead of asking in another chat: the case's team and the
   organization's owners see it at once - on the case, in the lists, in the bell, and as a desktop notification and a
   sound when they asked for those - and the question stays with the case it is about. Somebody who comes says so
   (เข้าไปช่วย), so the one who asked knows help is on the way and two people do not both turn up. The hand comes down
   when it is lowered, or by itself when the case is finished.

   Markup: pages/team-spirit (hand-card, hand-chip). */

/** "ขอช่วย" beside a case in a list, while a hand is up on it. */
export function HandChip({ hand }: { hand: Hand }) {
  const coming = hand.helper_id ? `${hand.helper_name} กำลังช่วย` : 'ยังไม่มีใครเข้าไปช่วย';
  return (
    <span className={`hand-chip${hand.helper_id ? ' helped' : ''}`} title={`${hand.raised_name} ยกมือขอช่วย${hand.note ? `: ${hand.note}` : ''} · ${coming}`}>
      <Icon name="hand" />
      {hand.helper_id ? 'มีคนช่วยแล้ว' : 'ขอช่วย'}
    </span>
  );
}

export function HandCard({ ticket }: { ticket: Ticket }) {
  const me = useStaffUser().id;
  const work = useWork();
  const toast = useToast();
  const refresh = useInvalidate();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const hand = ticket.hand ?? null;

  const act = async (call: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await call();
      toast(message);
      setNote('');
      await refresh(...TICKET_PREFIXES);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy(false);
    }
  };

  if (isDone(ticket) || work.read_only) return null;

  if (!hand)
    return (
      <FoldCard id="hand" title="ติดเคสนี้อยู่ไหม" className="hand-card">
        <p className="tiny muted">ยกมือแล้ว ทีมของเคสนี้และเจ้าขององค์กรจะเห็นทันที ใครว่างก็เข้ามาช่วยได้</p>
        <label className="sr-only" htmlFor="hand-note">
          ติดเรื่องอะไร
        </label>
        <input
          id="hand-note"
          value={note}
          maxLength={200}
          disabled={busy}
          placeholder="ติดเรื่องอะไร (ไม่บังคับ)"
          onChange={(e) => setNote(e.target.value)}
        />
        <button type="button" className="btn" disabled={busy} onClick={() => void act(() => raiseHand(ticket.id, note), `ยกมือขอช่วยใน BD-${ticket.number} แล้ว`)}>
          <Icon name="hand" />
          ยกมือขอช่วย
        </button>
      </FoldCard>
    );

  const mine = hand.raised_by === me;
  const helping = hand.helper_id === me;
  const canLower = mine || helping || ticket.assignee_id === me || work.role === 'admin';
  return (
    <FoldCard id="hand" title="ขอความช่วยเหลือ" hint={mine ? 'คุณยกมืออยู่' : `${hand.raised_name} ยกมืออยู่`} open highlight className="hand-card raised">
      <p className="hand-who">
        <Icon name="hand" />
        <strong>{mine ? 'คุณยกมือขอช่วยอยู่' : `${hand.raised_name} ยกมือขอช่วย`}</strong>
      </p>
      {hand.note && <p className="hand-note">{hand.note}</p>}
      <p className="tiny muted">
        ยกมือเมื่อ {shortAgo(hand.raised_at)} ·{' '}
        {hand.helper_id ? (helping ? 'คุณกำลังเข้าไปช่วย' : `${hand.helper_name} กำลังเข้ามาช่วย`) : 'ยังไม่มีใครเข้ามาช่วย'}
      </p>
      <div className="hand-actions">
        {!mine && !helping && (
          <button type="button" className="btn primary" disabled={busy} onClick={() => void act(() => helpHand(ticket.id), `บอก ${hand.raised_name} แล้วว่าคุณกำลังไปช่วย`)}>
            <Icon name="hand" />
            เข้าไปช่วย
          </button>
        )}
        {canLower && (
          <button type="button" className="btn" disabled={busy} onClick={() => void act(() => lowerHand(ticket.id), 'เอามือลงแล้ว')}>
            <Icon name="check" />
            {mine ? 'ได้คำตอบแล้ว เอามือลง' : 'เอามือลง'}
          </button>
        )}
      </div>
    </FoldCard>
  );
}
