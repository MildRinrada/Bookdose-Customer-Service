'use client';

import { useState } from 'react';
import { PageLoading } from '@/components/ui/display';
import { ACHIEVEMENTS_PATH, type Achievements } from '@/features/achievements/api';
import { BadgeGrid } from '@/features/achievements/components/BadgeGrid';
import { RecapMonth } from '@/features/achievements/components/RecapCard';
import { useApi } from '@/lib/query';
import { useWork } from '@/lib/session';

/* ตั้งค่าบัญชี → ผลงานของฉัน: the member's monthly summary (any of the last twelve months, or this one so far) and their
   badges, in the organization selected - the one section of the account that belongs to an organization, because the
   work does. Only ever the member's own. */

export function AchievementsSettings() {
  const work = useWork();
  const data = useApi<Achievements>(ACHIEVEMENTS_PATH).data;
  const [month, setMonth] = useState<string | null>(null);
  if (!data) return <PageLoading />;
  const picked = month ?? data.last_month;
  const earned = data.badges.filter((b) => b.earned_at).length;
  return (
    <div className="account-section">
      <section className="card">
        <div className="card-header recap-picker">
          <div>
            <h2>สรุปผลงานประจำเดือน</h2>
            <p>งานของคุณใน {work.tenant.name} เห็นเฉพาะคุณ</p>
          </div>
          <label className="sr-only" htmlFor="recap-month">
            เดือนที่ต้องการดู
          </label>
          <select id="recap-month" value={picked} onChange={(e) => setMonth(e.target.value)}>
            {data.months.map((m, i) => (
              <option key={m.month} value={m.month}>
                {i === 0 ? `${m.label} (ถึงวันนี้)` : m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="card-body">
          <RecapMonth key={picked} month={picked} />
        </div>
      </section>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>เหรียญความสำเร็จ</h2>
            <p>
              ได้แล้ว {earned} จาก {data.badges.length} เหรียญ ไม่มีการจัดอันดับ แข่งกับตัวเองเท่านั้น
            </p>
          </div>
        </div>
        <div className="card-body">
          <BadgeGrid badges={data.badges} />
        </div>
      </section>
    </div>
  );
}
