'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { rateAssistantAnswer } from '../api';
import type { AssistantFeedback } from '../types';

/* ถูกใจ / ไม่ถูกใจ under an answer (AiAssistant.tsx), by the member who asked it; pressed again, it is taken back.
   ไม่ถูกใจ is kept at once and opens a short form: why (one choice) and a comment, both optional. The organization's
   owner reads the counts, the reasons and the comments in the service report, never who wrote them.
   Markup: pages/ai-assistant.css (assistant-rate). */

export const feedbackReasonLabels: Record<string, string> = {
  wrong: 'ข้อมูลไม่ถูกต้อง',
  off_topic: 'ไม่ตรงกับที่ถาม',
  actions: 'รายการที่เสนอไม่ถูก',
  unclear: 'อ่านแล้วไม่เข้าใจ',
  other: 'อื่น ๆ',
};
const COMMENT_MAX = 300;

export function AnswerRating({ jobId, value, onChange }: { jobId: string; value?: AssistantFeedback; onChange: (feedback: AssistantFeedback) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const rating = value?.rating ?? '';

  const save = async (body: { rating: AssistantFeedback['rating']; reason?: string; comment?: string }) => {
    if (busy) return false;
    setBusy(true);
    try {
      onChange(await rateAssistantAnswer(jobId, body));
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const up = () => {
    setOpen(false);
    void save({ rating: rating === 'up' ? '' : 'up' });
  };
  const down = async () => {
    if (rating === 'down') {
      setOpen(false);
      void save({ rating: '' });
    } else if (await save({ rating: 'down' })) {
      setReason('');
      setComment('');
      setOpen(true);
    }
  };
  const send = async () => {
    if (!reason && !comment.trim()) return setOpen(false);
    if (await save({ rating: 'down', reason, comment: comment.trim() })) {
      setOpen(false);
      toast('ขอบคุณ บันทึกความเห็นแล้ว');
    }
  };

  return (
    <>
      <span className="assistant-rate" role="group" aria-label="คำตอบนี้ช่วยได้ไหม">
        <button
          type="button"
          className={`assistant-rate-btn up${rating === 'up' ? ' on' : ''}`}
          aria-pressed={rating === 'up'}
          aria-label="ถูกใจคำตอบนี้"
          title={rating === 'up' ? 'กดอีกครั้งเพื่อยกเลิก' : 'ถูกใจ'}
          onClick={up}
        >
          <Icon name="thumbUp" />
        </button>
        <button
          type="button"
          className={`assistant-rate-btn down${rating === 'down' ? ' on' : ''}`}
          aria-pressed={rating === 'down'}
          aria-label="ไม่ถูกใจคำตอบนี้"
          title={rating === 'down' ? 'กดอีกครั้งเพื่อยกเลิก' : 'ไม่ถูกใจ'}
          onClick={() => void down()}
        >
          <Icon name="thumbDown" />
        </button>
      </span>
      {open && (
        <div className="assistant-rate-form">
          <strong>ไม่ถูกใจตรงไหน</strong>
          <div className="assistant-rate-reasons" role="radiogroup" aria-label="เหตุผลที่ไม่ถูกใจ">
            {Object.entries(feedbackReasonLabels).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={reason === key}
                className={`assistant-rate-reason${reason === key ? ' on' : ''}`}
                onClick={() => setReason(reason === key ? '' : key)}
              >
                {label}
              </button>
            ))}
          </div>
          <textarea
            className="assistant-action-text"
            rows={2}
            maxLength={COMMENT_MAX}
            value={comment}
            aria-label="ความเห็นเพิ่มเติม"
            placeholder="ควรตอบอย่างไร (ไม่ใส่ก็ได้)"
            onChange={(e) => setComment(e.target.value)}
          />
          <p className="assistant-rate-note">เจ้าขององค์กรเห็นเหตุผลและความเห็นนี้ในหน้ารายงาน โดยไม่แสดงชื่อคุณและคำถาม</p>
          <div className="assistant-rate-actions">
            <button type="button" className="btn sm" onClick={() => setOpen(false)}>
              ข้าม
            </button>
            <button type="button" className="btn primary sm" onClick={() => void send()}>
              {busy ? 'กำลังส่ง…' : 'ส่งความเห็น'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
