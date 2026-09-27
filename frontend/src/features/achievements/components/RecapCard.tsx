'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { PageLoading } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { useApi } from '@/lib/query';
import { useWork } from '@/lib/session';
import { recapPath, type Recap } from '../api';
import { monthHeading, recapFacts, TITLE_EMOJI } from '../recap';
import { saveRecapImage } from '../recapImage';

/* สรุปผลงานประจำเดือน: one member's month as a card - the title of the month in fun and the figure that earned it,
   six figures, a customer's words, the badges of the month - and บันทึกเป็นรูปภาพ, which saves the same card as a
   picture for the member to send wherever they like. Only ever the member's own. Markup: pages/team-spirit (recap-). */

export function RecapCard({ recap }: { recap: Recap }) {
  const work = useWork();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  if (recap.empty)
    return (
      <div className="board-empty recap-empty">
        <Icon name="calendar" />
        <strong>{monthHeading(recap)}</strong>
        <span>เดือนนี้ยังไม่มีเคสที่ปิดหรือข้อความที่ตอบ เมื่อเริ่มดูแลลูกค้า สรุปจะขึ้นที่นี่</span>
      </div>
    );
  const quote = recap.praise.texts[0];
  return (
    <div className="recap">
      <article className="recap-card" aria-label={monthHeading(recap)}>
        <header className="recap-head">
          <span className="recap-org">{work.tenant.name}</span>
          <span className="recap-month">{monthHeading(recap)}</span>
          <strong className="recap-name">{recap.name}</strong>
        </header>
        <div className="recap-title">
          <span className="recap-emoji" aria-hidden="true">
            {TITLE_EMOJI[recap.title.key] ?? '✨'}
          </span>
          <span>
            <small>ฉายาประจำเดือน</small>
            <strong>{recap.title.name}</strong>
            <span>{recap.title.reason}</span>
          </span>
        </div>
        <dl className="recap-facts">
          {recapFacts(recap).map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
              <span>{fact.sub}</span>
            </div>
          ))}
        </dl>
        {quote && (
          <figure className="recap-quote">
            <blockquote>“{quote}”</blockquote>
            <figcaption>คำชมจากลูกค้า{recap.praise.count > 1 ? ` (ทั้งเดือน ${recap.praise.count} ครั้ง)` : ''}</figcaption>
          </figure>
        )}
        {recap.badges.length > 0 && (
          <div className="recap-badges">
            <span>เหรียญที่ได้เดือนนี้</span>
            <ul>
              {recap.badges.map((b) => (
                <li key={b.key}>
                  <Icon name={b.icon} />
                  {b.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </article>
      <div className="recap-actions">
        <button
          type="button"
          className="btn primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await saveRecapImage(recap, work.tenant.name);
              toast('บันทึกรูปสรุปผลงานแล้ว ส่งต่อให้ใครก็ได้ตามต้องการ');
            } catch (error) {
              toast(error instanceof Error ? error.message : String(error), true);
            } finally {
              setSaving(false);
            }
          }}
        >
          <Icon name="download" />
          {saving ? 'กำลังสร้างรูป…' : 'บันทึกเป็นรูปภาพ'}
        </button>
        <span className="tiny muted">เห็นเฉพาะคุณ ระบบไม่ส่งให้ใคร</span>
      </div>
    </div>
  );
}

/** One month, read from the server. */
export function RecapMonth({ month }: { month?: string }) {
  const recap = useApi<Recap>(recapPath(month));
  if (recap.error) return <p className="muted">{recap.error.message}</p>;
  if (!recap.data) return <PageLoading />;
  return <RecapCard recap={recap.data} />;
}
