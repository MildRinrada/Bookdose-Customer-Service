'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { date, relative } from '@/lib/format';
import { trashKind } from '../labels';
import type { TrashItem } from '../types';

/* One removed item: what it was, who removed it, how long it will be kept, and the way back.
   Markup: old-frontend/pages/trash/trash-item.html. */

export function TrashRow({
  item,
  onRestore,
  onPurge,
}: {
  item: TrashItem;
  onRestore: (item: TrashItem) => Promise<void>;
  onPurge: (item: TrashItem) => void;
}) {
  const [busy, setBusy] = useState(false);
  const kind = trashKind(item.kind);
  const restore = async () => {
    setBusy(true);
    try {
      await onRestore(item);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={`trash-item trash-${item.kind}`}>
      <span className="trash-icon">
        <Icon name={kind.icon} />
      </span>
      <div className="trash-body">
        <strong className="trash-title">{item.title || '(ไม่มีชื่อ)'}</strong>
        <span className="trash-meta">
          {kind.label}
          {item.detail ? ` · ${item.detail}` : ''}
        </span>
        <span className="trash-meta">
          ลบโดย {item.actor} ·{' '}
          <time dateTime={item.deleted_at} title={date(item.deleted_at, true)}>
            {relative(item.deleted_at)}
          </time>
        </span>
      </div>
      <span className={`trash-left${item.days_left <= 7 ? ' soon' : ''}`}>
        <Icon name="clock" />
        เหลืออีก {item.days_left} วัน
      </span>
      <div className="trash-actions">
        {item.can_restore ? (
          <>
            <button type="button" className="btn sm" disabled={busy} onClick={() => void restore()}>
              <Icon name="restore" />
              กู้คืน
            </button>
            <button type="button" className="btn sm subtle trash-purge" onClick={() => onPurge(item)}>
              <Icon name="trash" />
              ลบถาวร
            </button>
          </>
        ) : (
          <span className="tiny muted">ต้องเป็นผู้ดูแลองค์กรจึงกู้คืนได้</span>
        )}
      </div>
    </li>
  );
}
