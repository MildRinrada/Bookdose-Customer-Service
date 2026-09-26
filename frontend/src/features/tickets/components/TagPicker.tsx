'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import type { CaseTag } from '../tags';

/* The organization's tags as chips that switch on and off (a case's tags, a routing rule's). The list can be up to
   fifty long, so past SHOWN it gets a box to narrow it down, and only the first SHOWN are drawn until the member asks
   for all of them. A tag that is on is always drawn, wherever it sits in the list, and one the member touched stays
   where it is until they close the picker, so a chip never jumps away from under the pointer.
   Markup: pages/tickets (tag-picker, tag-chip). */

const SHOWN = 12;

export function TagPicker({
  tags,
  picked,
  onToggle,
  max,
  disabled = false,
  label,
}: {
  tags: CaseTag[];
  picked: string[];
  onToggle: (id: string) => void;
  /** No more than this many may be on at once. */
  max?: number;
  disabled?: boolean;
  label: string;
}) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  // Chips drawn once stay drawn: turning one off must not make it vanish while the picker is open.
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set(picked));
  const full = max != null && picked.length >= max;
  const words = q.trim().toLowerCase();
  const many = tags.length > SHOWN;
  const shown = words
    ? tags.filter((t) => t.name.toLowerCase().includes(words))
    : all || !many
      ? tags
      : tags.filter((t, i) => i < SHOWN || picked.includes(t.id) || kept.has(t.id));
  const hidden = tags.length - shown.length;

  const toggle = (id: string) => {
    setKept((ids) => new Set(ids).add(id));
    onToggle(id);
  };

  return (
    <div className="tag-picker">
      {many && (
        <label className="tag-picker-search">
          <Icon name="search" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`ค้นหาจาก ${tags.length} ป้าย`} aria-label="ค้นหาป้าย" />
        </label>
      )}
      <div className="tag-chips" role="group" aria-label={label}>
        {shown.map((t) => {
          const on = picked.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              className={`tag-chip toggle${on ? ' on' : ''}`}
              aria-pressed={on}
              disabled={disabled || (!on && full)}
              title={!on && full ? `ติดได้ไม่เกิน ${max} ป้าย` : undefined}
              onClick={() => toggle(t.id)}
            >
              {on && <Icon name="check" />}
              {t.name}
            </button>
          );
        })}
        {!shown.length && <span className="tiny muted">ไม่พบป้ายที่ค้นหา</span>}
      </div>
      {!words && many && (hidden > 0 || all) && (
        <button type="button" className="btn sm tag-picker-more" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'แสดงน้อยลง' : `แสดงอีก ${hidden} ป้าย`}
        </button>
      )}
    </div>
  );
}

/** The chips of tags a case carries, read-only; `limit` folds the rest into "+N". */
export function TagChips({ tags, limit }: { tags: CaseTag[]; limit?: number }) {
  if (!tags.length) return null;
  const shown = limit ? tags.slice(0, limit) : tags;
  const rest = tags.length - shown.length;
  return (
    <span className="tag-chips" aria-label={`ป้ายเคส: ${tags.map((t) => t.name).join(', ')}`}>
      {shown.map((t) => (
        <span key={t.id} className="tag-chip">
          {t.name}
        </span>
      ))}
      {rest > 0 && (
        <span className="tag-chip more" title={tags.slice(shown.length).map((t) => t.name).join(', ')}>
          +{rest}
        </span>
      )}
    </span>
  );
}
