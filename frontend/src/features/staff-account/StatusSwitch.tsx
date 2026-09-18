'use client';

import { useRunAction } from '@/components/ui/actions';
import type { WorkStatus } from '@/lib/types';
import { usePreferences } from './prefs';
import { useSaveStatus } from './StatusSettings';

/* The work status in the staff top bar (where "Online" used to be): one tap to go on a break and back, so routing
   stops and starts giving the member new cases (ตั้งค่าบัญชี → สถานะการทำงาน). When the status is "available" but
   the hours or leave say otherwise, the dot says so. Markup: pages/account-settings.css (.status-switch). */

export function StatusSwitch() {
  const view = usePreferences();
  const run = useRunAction();
  const save = useSaveStatus();
  const data = view.data;
  if (!data) return null;
  const status = data.preferences.status;
  const tone = data.availability.available ? 'online' : status === 'online' ? 'offhours' : status;
  const title = data.availability.available ? 'พร้อมรับเรื่องใหม่' : `ไม่รับเรื่องใหม่: ${data.availability.reason}`;
  return (
    <label className={`status-switch status-${tone}`} title={title}>
      <span className="status-dot" aria-hidden="true" />
      <span className="sr-only">สถานะการทำงาน</span>
      <select value={status} onChange={(event) => void run(() => save(event.target.value as WorkStatus, data.statuses))} aria-describedby="status-switch-hint">
        {(Object.keys(data.statuses) as WorkStatus[]).map((key) => (
          <option key={key} value={key}>
            {data.statuses[key]}
          </option>
        ))}
      </select>
      <span id="status-switch-hint" className="sr-only">
        {title}
      </span>
    </label>
  );
}
