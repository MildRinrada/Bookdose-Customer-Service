import { Icon } from '@/components/Icon';
import type { ThanksCardData } from '../types';

/* การ์ดขอบคุณหลังปิดเคส (backend automation/thanks.py): at the end of a finished conversation, the person who looked
   after it - their photo when they chose to show it, else their initials - and a thank-you, so the customer knows a
   real person was there. The signed-in customer's chat and the guest chat both show it; the team member's settings
   page shows the same card as a preview (`src` then is their own photo). Markup: pages/team-spirit (thanks-card). */

/** The first letter a person's name is read by (a Thai vowel written before its consonant is skipped). */
export function initialOf(name: string) {
  const letters = [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(name.trim())].map((s) => s.segment);
  return (letters.find((l) => !/^[เแโใไ]$/.test(l)) ?? letters[0] ?? '?').toUpperCase();
}

export function ThanksCardView({ card, src }: { card: Pick<ThanksCardData, 'name' | 'message' | 'case'>; src?: string | null }) {
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
      <Icon name="heart" className="thanks-heart" />
    </div>
  );
}

/** The card in a customer's conversation. `slug` is the portal the chat belongs to ("<org>/guest" for a guest chat). */
export function ThanksCard({ card, slug }: { card: ThanksCardData; slug: string }) {
  return <ThanksCardView card={card} src={card.photo ? `/api/public/${slug}/thanks/${card.id}/photo` : null} />;
}
