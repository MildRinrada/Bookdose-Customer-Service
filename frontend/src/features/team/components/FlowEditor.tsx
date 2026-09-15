'use client';

import { useId } from 'react';
import { Icon } from '@/components/Icon';
import type { Reviewer } from '../types';

/* An approval flow being edited: the reviewers in order (move up, move down, remove) and a list to add the next one
   from (each person once). The final decision after them is not a step: whoever may decide does it. Controlled:
   `value` is the account ids in order. Markup: pages/team.css (.flow-*). */

export function FlowEditor({
  reviewers,
  value,
  onChange,
  label,
}: {
  reviewers: Reviewer[];
  value: string[];
  onChange: (next: string[]) => void;
  /** What the flow is for (read by screen readers on the add list). */
  label: string;
}) {
  const addId = useId();
  const byId = new Map(reviewers.map((r) => [r.account_id, r]));
  const left = reviewers.filter((r) => !value.includes(r.account_id));
  const move = (from: number, to: number) => {
    const next = [...value];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  return (
    <div className="flow-editor">
      {value.length ? (
        <ol className="flow-steps">
          {value.map((id, i) => {
            const person = byId.get(id);
            return (
              <li key={id} className="flow-step">
                <span className="approval-step-dot" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="grow">
                  <strong>{person ? person.name : 'ไม่อยู่ในทีมแล้ว'}</strong>
                  <span className="muted">{person?.role === 'owner' ? 'คุณ (เจ้าของ)' : person?.role_label}</span>
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`เลื่อน ${person?.name ?? ''} ขึ้น`}
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  <Icon name="down" className="flow-up" />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`เลื่อน ${person?.name ?? ''} ลง`}
                  disabled={i === value.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <Icon name="down" />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`นำ ${person?.name ?? ''} ออกจากขั้นตอน`}
                  onClick={() => onChange(value.filter((x) => x !== id))}
                >
                  <Icon name="close" />
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="muted flow-empty">ไม่มีผู้ตรวจ · ผู้มีสิทธิ์อนุมัติตัดสินใจได้ทันทีเหมือนเดิม</p>
      )}
      {left.length > 0 && (
        <div className="flow-add">
          <label className="sr-only" htmlFor={addId}>
            เพิ่มผู้ตรวจใน{label}
          </label>
          <select
            id={addId}
            value=""
            onChange={(e) => {
              if (e.target.value) onChange([...value, e.target.value]);
            }}
          >
            <option value="">+ เพิ่มผู้ตรวจขั้นถัดไป</option>
            {left.map((r) => (
              <option key={r.account_id} value={r.account_id}>
                {r.name} · {r.role === 'owner' ? 'คุณ (เจ้าของ)' : r.role_label}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="tiny muted">หลังผู้ตรวจขั้นสุดท้าย ผู้มีสิทธิ์อนุมัติ (คุณหรือผู้ดูแลร่วม) จึงอนุมัติรับงานหรือลงนามได้</p>
    </div>
  );
}
