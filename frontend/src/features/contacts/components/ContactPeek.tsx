'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Badge } from '@/components/ui/display';
import { date, isDone, overdue, relative } from '@/lib/format';
import { channelIcons, channelNames } from '@/lib/labels';
import { contactMood, type ContactStats } from '../labels';
import type { Contact } from '../types';

/* The customer list's quick view: resting on a customer's name (or focusing it) shows a card beside it - how
   satisfied they have been, where they usually write, their note and their latest cases as a short timeline - so
   nobody has to leave the list. The card is fixed to the screen (the table scrolls sideways and would cut it) and
   placed through the CSSOM (no style attributes). Markup: pages/contacts (contact-peek). */

const SHOWN = 4;
const OPEN_MS = 280;
const CLOSE_MS = 180;

type Peek = { c: Contact; s: ContactStats; anchor: HTMLElement };

/** show(c, s, element) after a short rest, hide() after a short grace (moving onto the card keeps it). */
export function useContactPeek() {
  const [peek, setPeek] = useState<Peek | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((c: Contact, s: ContactStats, anchor: HTMLElement, now = false) => {
    clearTimeout(timer.current);
    if (now) setPeek({ c, s, anchor });
    else timer.current = setTimeout(() => setPeek({ c, s, anchor }), OPEN_MS);
  }, []);
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPeek(null), CLOSE_MS);
  }, []);
  const keep = useCallback(() => clearTimeout(timer.current), []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { peek, show, hide, keep };
}

export function ContactPeek({ peek, onKeep, onHide }: { peek: Peek | null; onKeep: () => void; onHide: () => void }) {
  const card = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !peek) return;
    const place = () => {
      const at = peek.anchor.getBoundingClientRect();
      const height = el.offsetHeight;
      const width = el.offsetWidth;
      const below = at.bottom + 8 + height <= window.innerHeight - 12;
      el.style.setProperty('top', `${Math.round(below ? at.bottom + 8 : Math.max(12, at.top - height - 8))}px`);
      el.style.setProperty('left', `${Math.round(Math.min(at.left, window.innerWidth - width - 16))}px`);
    };
    place();
    window.addEventListener('scroll', onHide, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', onHide, true);
      window.removeEventListener('resize', place);
    };
  }, [peek, onHide]);

  if (!peek) return null;
  const { c, s } = peek;
  const mood = contactMood(c);
  const channel = c.main_channel;
  return (
    <div ref={card} className="contact-peek" role="dialog" aria-label={`สรุปลูกค้า ${c.name}`} onMouseEnter={onKeep} onMouseLeave={onHide}>
      <div className="contact-peek-head">
        <strong>{c.name}</strong>
        <span className="muted">{c.company || 'ไม่ระบุองค์กร'}</span>
      </div>
      <div className="contact-peek-facts">
        <span>
          <b>{s.total}</b> เคส
        </span>
        <span>
          <b>{s.open}</b> ค้าง
        </span>
        {mood ? (
          <span className={`mood ${mood.tone}`} title={`คะแนนเฉลี่ย ${c.satisfaction!.average}/5 จาก ${c.satisfaction!.count} ครั้ง`}>
            {mood.face} {c.satisfaction!.average}
          </span>
        ) : (
          <span className="muted">ยังไม่มีคะแนน</span>
        )}
        {channel && (
          <span>
            <Icon name={channelIcons[channel] ?? 'chat'} />
            {channelNames[channel] ?? channel}
          </span>
        )}
      </div>
      {c.notes && (
        <p className="contact-peek-note">
          <Icon name="edit" />
          {c.notes}
        </p>
      )}
      {s.cases.length ? (
        <ol className="contact-peek-timeline">
          {s.cases.slice(0, SHOWN).map((t) => (
            <li key={t.id} className={overdue(t) ? 'late' : isDone(t) ? 'done' : 'open'}>
              <Link href={`/tickets/${t.id}`}>
                <span className="contact-peek-subject">{t.subject}</span>
                <span className="contact-peek-meta">
                  BD-{t.number} · <Badge status={t.status} /> · {relative(t.updated_at)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted contact-peek-empty">ยังไม่มีเคส · เพิ่มเข้าระบบ {date(c.created_at)}</p>
      )}
      {s.cases.length > SHOWN && <span className="small muted">และอีก {s.cases.length - SHOWN} เคส · กดจำนวนเคสเพื่อดูทั้งหมด</span>}
    </div>
  );
}

/** A small button that copies `value`, and says so for a moment. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className={`copy-btn${copied ? ' copied' : ''}`}
      aria-label={`คัดลอก${label}`}
      title={`คัดลอก${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} />
      <span className="copy-tip" aria-live="polite">
        {copied ? 'คัดลอกแล้ว!' : ''}
      </span>
    </button>
  );
}
