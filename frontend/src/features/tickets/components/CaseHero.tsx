'use client';

import { useEffect, useRef } from 'react';
import { Icon } from '@/components/Icon';
import { Badge, PriorityTag, PrivacyTag } from '@/components/ui/display';
import { MoodTag, type Mood } from '@/components/ui/MoodTag';
import { date, isDone } from '@/lib/format';
import type { Ticket } from '../types';

/* The case screen's dark head, in the notifications panel's language: the number and what kind of case it is, the
   subject large, its status, and the two SLA clocks as bars (time used of the time allowed) with what is left or how
   late it is. Markup: pages/tickets/ticket-detail (case-hero). */

/** "3 ชม. 20 นาที", "2 วัน 4 ชม.", "45 นาที" */
function span(ms: number): string {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / 60000));
  if (minutes < 60) return `${minutes} นาที`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} ชม. ${minutes % 60} นาที` : `${hours} ชม.`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} วัน ${hours % 24} ชม.` : `${days} วัน`;
}

type Clock = { state: 'done' | 'late' | 'warn' | 'ok'; used: number; text: string };

/** How far a clock from `start` to `due` has run; `doneAt` stops it. */
function clock(start: string, due: string | null | undefined, doneAt: string | null | undefined, doneLabel: string): Clock {
  if (!due) return { state: 'ok', used: 0, text: 'ไม่มีกำหนด' };
  const from = new Date(start).getTime();
  const until = new Date(due).getTime();
  const at = doneAt ? new Date(doneAt).getTime() : Date.now();
  const used = Math.min(1, Math.max(0, (at - from) / Math.max(1, until - from)));
  if (doneAt) return { state: at > until ? 'late' : 'done', used, text: `${doneLabel} ${date(doneAt, true)}${at > until ? ` · ช้าไป ${span(at - until)}` : ''}` };
  if (at > until) return { state: 'late', used: 1, text: `เกินกำหนดมา ${span(at - until)}` };
  return { state: used > 0.75 ? 'warn' : 'ok', used, text: `เหลือ ${span(until - at)} · ภายใน ${date(due, true)}` };
}

function SlaClock({ label, value }: { label: string; value: Clock }) {
  const fill = useRef<HTMLSpanElement>(null);
  // The width goes through the CSSOM: the page's CSP allows no style attributes.
  useEffect(() => {
    fill.current?.style.setProperty('width', `${Math.round(value.used * 100)}%`);
  }, [value.used]);
  return (
    <div className={`case-sla-clock ${value.state}`}>
      <div className="case-sla-label">
        <span>{label}</span>
        {value.state === 'done' && <Icon name="checkCircle" />}
      </div>
      <span className="case-sla-bar" aria-hidden="true">
        <span ref={fill} />
      </span>
      <span className="case-sla-text">{value.text}</span>
    </div>
  );
}

export function CaseHero({
  ticket: t,
  org,
  escalation,
  late,
  mood,
}: {
  ticket: Ticket;
  org: string;
  escalation: string;
  late: boolean;
  mood?: Mood | null;
}) {
  // A closed case stops both clocks (overdue() in lib/format does not count a done case either).
  const resolved = t.resolved_at ?? (isDone(t) ? t.updated_at : null);
  const first = t.first_response_at
    ? clock(t.created_at, t.first_response_due_at, t.first_response_at, 'ตอบแล้ว')
    : clock(t.created_at, t.first_response_due_at, resolved, 'ปิดเคสแล้ว');
  const resolution = clock(t.created_at, t.resolution_due_at, resolved, 'ปิดเคสแล้ว');
  return (
    <header className="case-hero">
      <div className="case-hero-main">
        <div className="case-hero-top">
          <span className="case-hero-id">BD-{t.number}</span>
          {t.category && <span>{t.category}</span>}
          <span>เปิดเรื่อง {date(t.created_at, true)}</span>
          <PrivacyTag org={org} />
        </div>
        <h1>{t.subject}</h1>
        <div className="case-hero-tags">
          <Badge status={t.status} />
          <PriorityTag value={t.priority} />
          {late && (
            <span className="case-hero-flag late">
              <Icon name="clock" />
              เกินกำหนด SLA
            </span>
          )}
          {mood && <MoodTag mood={mood} className="case-hero-mood" />}
          {t.hand && !isDone(t) && (
            <span className="case-hero-flag hand" title={t.hand.note || undefined}>
              <Icon name="hand" />
              {t.hand.raised_name} ยกมือขอช่วย{t.hand.helper_id ? ` · ${t.hand.helper_name} กำลังช่วย` : ''}
            </span>
          )}
          {escalation && (
            <span className="case-hero-flag">
              <Icon name="bolt" />
              {escalation}
            </span>
          )}
          {/* ไม่รีบ (portal/no_rush.py): why the first-reply deadline is later than the SLA. */}
          {t.no_rush && !isDone(t) && (
            <span className="case-hero-flag" title="ลูกค้าบอกว่าไม่รีบ กำหนดตอบครั้งแรกจึงเลื่อนไปถึงเวลานี้ โดยไม่นับว่าเกิน SLA">
              <Icon name="clock" />
              ลูกค้าไม่รีบ ตอบได้ถึง{t.no_rush.text}
            </span>
          )}
        </div>
      </div>
      <div className="case-sla" title="SLA นับเวลาต่อเนื่อง 24 ชั่วโมง ไม่หยุดนับระหว่างรอลูกค้า">
        <SlaClock label="ตอบกลับครั้งแรก" value={first} />
        <SlaClock label="แก้ไขเคส" value={resolution} />
      </div>
    </header>
  );
}
