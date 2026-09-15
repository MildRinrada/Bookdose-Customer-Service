import { date, starsText } from '@/lib/format';
import type { Survey } from '../types';

/** The CSAT result of a case, or that it waits for the customer; nothing when no survey was sent.
    Markup: pages/automation/survey-result (the case screen wraps it in the "ความพึงพอใจ (CSAT)" block). */
export function SurveySummary({ survey }: { survey: Survey | null | undefined }) {
  if (!survey) return null;
  if (survey.rating == null)
    return <p className="small muted">ส่งแบบประเมินเมื่อ {date(survey.sent_at, true)} · รอลูกค้าให้คะแนน</p>;
  return (
    <>
      <div className="csat-result">
        <span className="csat-stars" aria-hidden="true">
          {survey.rating ? starsText(survey.rating) : ''}
        </span>
        <strong>{survey.rating}/5</strong>
        <span className="tiny muted">ตอบเมื่อ {survey.answered_at ? date(survey.answered_at, true) : ''}</span>
      </div>
      {survey.comment && <p className="csat-comment">“{survey.comment}”</p>}
    </>
  );
}
