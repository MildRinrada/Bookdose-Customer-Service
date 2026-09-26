'use client';

import Link from 'next/link';
import { tagsOf, useCaseTags } from '@/features/tickets/tags';
import type { TicketRow } from '@/features/tickets/types';
import { useWork } from '@/lib/session';

/* เคสตามป้าย: which problems came most in the period (ป้ายเคส, features/tickets/tags.ts), against the period before,
   beside the status and priority bars. A case about two things counts under both. The full measures per tag are in
   the pivot table (analysis.ts, ป้ายเคส). */

const SHOWN = 8;

export function TagBarsCard({ tickets, before }: { tickets: TicketRow[]; before: TicketRow[] }) {
  const work = useWork();
  const list = useCaseTags();
  if (!list.length) {
    if (work.role !== 'admin') return null;
    return (
      <section className="card">
        <div className="card-header">
          <h2>เคสตามป้าย</h2>
        </div>
        <div className="card-body">
          <p className="empty-mini">
            ตั้งป้ายเคสไว้ แล้วให้ทีมติดป้าย รายงานจะบอกได้ว่าปัญหาเรื่องไหนมากที่สุด{' '}
            <Link href="/tickets">ตั้งป้ายที่หน้าเคสบริการ</Link>
          </p>
        </div>
      </section>
    );
  }
  const count = (cases: TicketRow[]) => {
    const found = new Map<string, number>();
    for (const t of cases) for (const tag of tagsOf(t.tags, list)) found.set(tag.id, (found.get(tag.id) ?? 0) + 1);
    return found;
  };
  const now = count(tickets);
  const earlier = count(before);
  const tagged = tickets.filter((t) => tagsOf(t.tags, list).length).length;
  const rows = list
    .map((tag) => ({ ...tag, count: now.get(tag.id) ?? 0, before: earlier.get(tag.id) ?? 0 }))
    .filter((r) => r.count || r.before)
    .sort((a, b) => b.count - a.count || b.before - a.before);
  const top = Math.max(1, ...rows.map((r) => r.count));
  const shown = rows.slice(0, SHOWN);
  return (
    <section className="card tag-bars">
      <div className="card-header">
        <h2>เคสตามป้าย</h2>
        <span className="muted">
          ติดป้ายแล้ว {tagged} จาก {tickets.length} เคส
        </span>
      </div>
      <div className="card-body">
        {shown.length ? (
          shown.map((r) => {
            const change = r.before ? Math.round((100 * (r.count - r.before)) / r.before) : null;
            return (
              <div key={r.id} className="bar-row" title={`${r.count} เคส · ช่วงก่อนหน้า ${r.before} เคส`}>
                <span className="bar-label">{r.name}</span>
                <progress value={r.count} max={top} aria-label={`${r.name}: ${r.count} เคส`} />
                <span className="bar-value">
                  {r.count}
                  <small className="muted">
                    {' '}
                    · {change == null ? 'ใหม่ในช่วงนี้' : change === 0 ? 'เท่าเดิม' : `${change > 0 ? 'เพิ่ม' : 'ลด'} ${Math.abs(change)}%`}
                  </small>
                </span>
              </div>
            );
          })
        ) : (
          <p className="empty-mini">ยังไม่มีเคสในช่วงนี้ที่ติดป้าย</p>
        )}
        {rows.length > SHOWN && <p className="tiny muted mt">อีก {rows.length - SHOWN} ป้าย ดูครบในตารางวิเคราะห์ด้านบน แยกตามป้ายเคส</p>}
        <p className="tiny muted mt">เทียบกับช่วงก่อนหน้าที่ยาวเท่ากัน · เคสที่ติดหลายป้ายนับในทุกป้าย</p>
      </div>
    </section>
  );
}
