'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { sendThanksHeart } from '../api';
import type { ThanksCardData } from '../types';

/* การ์ดขอบคุณหลังปิดเคส (backend automation/thanks.py): at the end of a finished conversation, the person who looked
   after it - their photo when they chose to show it, else their initials - and a thank-you, so the customer knows a
   real person was there. The heart in its corner sends a heart back, which goes up on the team's กำแพงคำชม. The
   signed-in customer's chat and the guest chat both show it; the team member's settings page shows the same card as
   a preview (`src` then is their own photo, and the heart is only a picture). Markup: pages/team-spirit (thanks-card)
   and pages/reactions (thanks-heart). */

/** The first letter a person's name is read by (a Thai vowel written before its consonant is skipped). */
export function initialOf(name: string) {
  const letters = [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(name.trim())].map((s) => s.segment);
  return (letters.find((l) => !/^[เแโใไ]$/.test(l)) ?? letters[0] ?? '?').toUpperCase();
}

type Heart = { sent: boolean; pop?: boolean; onSend?: () => void };

export function ThanksCardView({ card, src, heart }: { card: Pick<ThanksCardData, 'name' | 'message' | 'case'>; src?: string | null; heart?: Heart }) {
  return (
    <div className="thanks-card" role="note" aria-label={`การ์ดขอบคุณจาก ${card.name}`}>
      <span className="thanks-face" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt="" width={56} height={56} /> : initialOf(card.name)}
      </span>
      <span className="thanks-body">
        <small>{card.case ? `ดูแลเคส BD-${card.case} ของคุณโดย` : 'ดูแลเรื่องของคุณโดย'}</small>
        <strong>{card.name}</strong>
        <span className="thanks-message">{card.message}</span>
      </span>
      {heart &&
        (heart.sent ? (
          <span className={`thanks-heart sent${heart.pop ? ' pop' : ''}`} role="img" aria-label={`ส่งหัวใจให้ ${card.name} แล้ว`} title={`ส่งหัวใจให้ ${card.name} แล้ว`}>
            <Icon name="heart" />
          </span>
        ) : heart.onSend ? (
          <button type="button" className="thanks-heart" aria-label={`ส่งหัวใจขอบคุณ ${card.name}`} title="ส่งหัวใจขอบคุณกลับ" onClick={heart.onSend}>
            <Icon name="heart" />
          </button>
        ) : (
          <span className="thanks-heart" aria-hidden="true">
            <Icon name="heart" />
          </span>
        ))}
    </div>
  );
}

/** The card in a customer's conversation. `slug` is the portal the chat belongs to ("<org>/guest" for a guest chat). */
export function ThanksCard({ card, slug, conversationId }: { card: ThanksCardData; slug: string; conversationId: string }) {
  const toast = useToast();
  const refresh = useInvalidate();
  // Sent at once on the card; put back if the server refuses (the case was opened again meanwhile, say).
  const [sending, setSending] = useState(false);
  const send = async () => {
    setSending(true);
    try {
      await sendThanksHeart(slug, conversationId, card.id);
      toast(`ส่งหัวใจให้ ${card.name} แล้ว`);
      await refresh(`/api/public/${slug}/session`);
    } catch (error) {
      setSending(false);
      toast(error instanceof Error ? error.message : String(error), true);
    }
  };
  return (
    <ThanksCardView
      card={card}
      src={card.photo ? `/api/public/${slug}/thanks/${card.id}/photo` : null}
      heart={{ sent: card.hearted || sending, pop: sending, onSend: () => void send() }}
    />
  );
}
