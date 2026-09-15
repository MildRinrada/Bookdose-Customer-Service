'use client';

import { useCallback, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { addFollowup, FOLLOWUP_PREFIXES, finishFollowup } from '../api';
import { followupChoices, followupState } from '../labels';
import type { Followup } from '../types';

/** Close a follow-up reminder: toasts and refreshes the case and the member's alerts. Resolves true when done. */
export function useFinishFollowup() {
  const toast = useToast();
  const refresh = useInvalidate();
  return useCallback(
    async (id: string) => {
      try {
        await finishFollowup(id);
        toast('ปิดรายการติดตามแล้ว');
        await refresh(...FOLLOWUP_PREFIXES);
        return true;
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), true);
        return false;
      }
    },
    [toast, refresh],
  );
}

/** One reminder with its "เสร็จแล้ว" button. Markup: pages/automation/followup-item. */
export function FollowupItem({ followup: f }: { followup: Followup }) {
  const finish = useFinishFollowup();
  const [busy, setBusy] = useState(false);
  const done = Boolean(f.done_at);
  const { late, when } = followupState(f);
  return (
    <div className={`followup-item${late ? ' late' : ''}${done ? ' done' : ''}`}>
      <span className="followup-icon">
        <Icon name="clock" />
      </span>
      <div className="grow">
        <strong>{f.note}</strong>
        <span className="tiny muted">
          {when} · ตั้งโดย {f.user_name}
        </span>
      </div>
      {!done && (
        <button
          type="button"
          className="btn sm"
          data-id={f.id}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            if (!(await finish(f.id))) setBusy(false);
          }}
        >
          <Icon name="check" />
          เสร็จแล้ว
        </button>
      )}
    </div>
  );
}

/** The "เตือนติดตามผล" block of a case: its reminders and the form to set a new one. Put it under the block's <h3>. */
export function FollowupsPanel({ ticketId, followups }: { ticketId: string; followups: Followup[] }) {
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <>
      <div className="followup-list">
        {followups.map((f) => (
          <FollowupItem key={f.id} followup={f} />
        ))}
      </div>
      <Form
        className="followup-form"
        onSubmit={async (values, form) => {
          await addFollowup(ticketId, Number(values.hours), values.note || '');
          toast('ตั้งเตือนติดตามผลแล้ว');
          // The old screen redrew the form after saving; start again from the default choice.
          form.reset();
          await refresh(...FOLLOWUP_PREFIXES);
        }}
      >
        <label className="sr-only" htmlFor="followup-hours">
          เตือนเมื่อ
        </label>
        <select id="followup-hours" name="hours" defaultValue="24">
          {Object.entries(followupChoices).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button className="btn sm" type="submit">
          <Icon name="clock" />
          ตั้งเตือน
        </button>
        <label className="sr-only" htmlFor="followup-note">
          เรื่องที่ต้องติดตาม
        </label>
        <input id="followup-note" name="note" maxLength={300} placeholder="เรื่องที่ต้องติดตาม (ไม่บังคับ)" />
      </Form>
    </>
  );
}
