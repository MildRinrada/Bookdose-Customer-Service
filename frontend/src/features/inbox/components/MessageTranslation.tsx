'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { languageName } from '@/features/ai/languages';
import type { MessageTranslation as Translation } from '../types';

/* Under a translated message on the team's screens (ai/translate.py): which way it went, and the other side a click
   away - the customer's own words under the Thai the team reads, or what the customer got under the Thai the member
   wrote. While a reply is being translated it says the customer has not seen it yet; when a translation failed it says
   what happened instead. Markup: pages/inbox.css (.message-translation). */

const WHY: Record<string, string> = {
  quota: 'ถึงเพดานการใช้ AI ของวันนี้',
  timeout: 'AI ตอบช้าเกินไป',
  stale: 'การตั้งค่า AI เปลี่ยน',
  too_long: 'ข้อความยาวเกินจะแปล',
};

/** The language a Thai reply is translated into before it goes, or null when replies go as typed. */
export function translateTo(state: { enabled: boolean; language: string } | null | undefined) {
  return state?.enabled && state.language && state.language !== 'th' ? state.language : null;
}

/** The Thai to show in the bubble for this message, or null to show the body as it is. */
export function thaiSide(t: Translation | null | undefined) {
  if (!t || !t.thai) return null;
  return t.direction === 'out' || t.status === 'done' ? t.thai : null;
}

export function MessageTranslation({ translation: t, body }: { translation: Translation; body: string }) {
  const [open, setOpen] = useState(false);
  const language = t.language ? languageName(t.language) : 'ภาษาของลูกค้า';
  const why = WHY[t.error] ? ` (${WHY[t.error]})` : '';
  let text: string;
  let other: { label: string; text: string } | null = null;
  if (t.direction === 'in') {
    if (t.status === 'pending') text = 'กำลังแปลเป็นภาษาไทย…';
    else if (t.status === 'failed') text = `แปลเป็นภาษาไทยไม่สำเร็จ${why}`;
    // The AI found it was Thai after all (written in Latin letters and the same once read): nothing to show.
    else if (!t.thai) return null;
    else {
      text = `แปลจาก${language}ด้วย AI`;
      other = { label: 'ต้นฉบับ', text: body };
    }
  } else if (t.status === 'pending') text = `กำลังแปลเป็น${language}ก่อนส่ง · ลูกค้ายังไม่เห็นข้อความนี้`;
  else if (t.status === 'failed') text = `แปลไม่สำเร็จ${why} ส่งเป็นภาษาไทยตามที่พิมพ์`;
  else {
    text = `ลูกค้าได้รับเป็น${language}`;
    other = { label: 'ข้อความที่ลูกค้าได้รับ', text: body };
  }
  return (
    <div className={`message-translation is-${t.status}`} role={t.status === 'pending' ? 'status' : undefined}>
      <p>
        <Icon name="translate" />
        <span>{text}</span>
        {other && (
          <button type="button" className="translation-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'ซ่อน' : 'ดู'}
            {other.label}
          </button>
        )}
      </p>
      {open && other && (
        <blockquote className="translation-other" lang={t.language || undefined}>
          {other.text}
        </blockquote>
      )}
    </div>
  );
}
