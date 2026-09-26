'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import type { TicketRow } from '@/features/tickets/types';
import { useApi } from '@/lib/query';
import type { Forecast } from '../forecast';
import { capacity, CAPACITY_DAYS, handlers, MIN_PERSON_DAYS, staffDays, type StaffDay, type StaffPlan } from '../staffing';

/* คนที่ต้องใช้แต่ละวัน (staffing.ts): for the organization's owners, the forecast's coming days beside how many of the
   team are expected to work, and which days are short. Markup: pages/report-insights (staffing-*). */

export const STAFFING_PATH = '/api/reports/staffing';

const dayName = new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
const SHOWN = 7;
const people = (low: number, high: number) => (low === high ? `${low} คน` : `${low}-${high} คน`);
const range = (d: StaffDay) => (d.low === d.high ? `${d.low}` : `${d.low}-${d.high}`);
const whyWords: Record<string, string> = { leave: 'ลา', off: 'ไม่ใช่วันทำงาน' };

export function StaffingCard({ forecast: f, all, team }: { forecast: Forecast; all: TicketRow[]; team: string }) {
  const plan = useApi<StaffPlan>(STAFFING_PATH);
  const [more, setMore] = useState(false);
  const scope = team ? ' ของทีมที่เลือก' : '';

  const head = (
    <div className="card-header">
      <div>
        <h2 className="report-title">
          <Icon name="users" />
          คนที่ต้องใช้แต่ละวัน
        </h2>
        <p>เทียบเคสที่คาดว่าจะเข้ามากับคนที่ทำงานวันนั้น{scope} จากวันลาและเวลาทำงานของแต่ละคน · เห็นเฉพาะเจ้าขององค์กร</p>
      </div>
    </div>
  );
  const message = (text: ReactNode) => (
    <section className="card report-card">
      {head}
      <div className="card-body">
        <p className="empty-mini">{text}</p>
      </div>
    </section>
  );

  if (!f.ready) return message('ต้องพยากรณ์จำนวนเคสได้ก่อน จึงจะบอกได้ว่าแต่ละวันต้องใช้กี่คน');
  if (plan.error && !plan.data) return message('โหลดวันทำงานของทีมไม่สำเร็จ ลองรีเฟรชหน้านี้อีกครั้ง');
  if (!plan.data) return message('กำลังโหลดวันทำงานของทีม…');

  const cap = capacity(team ? all.filter((t) => t.crewid === team) : all);
  if (cap.perPerson == null)
    return message(
      `ยังมีข้อมูลการปิดเคสไม่พอ ต้องมีวันที่สมาชิกปิดเคสรวมกันอย่างน้อย ${MIN_PERSON_DAYS} วันใน ${CAPACITY_DAYS / 7} สัปดาห์ล่าสุด (ตอนนี้ ${cap.personDays} วัน)`,
    );

  const crew = handlers(plan.data, team);
  const days = staffDays(f.ahead, plan.data, crew, cap.perPerson);
  const week = days.slice(0, SHOWN);
  const shown = more ? days : week;
  const short = week.filter((d) => d.state === 'short');
  const guessed = crew.filter((m) => !m.hours_set);

  return (
    <section className="card report-card staffing-card">
      {head}
      <div className="card-body">
        <div className="report-figures">
          <div>
            <span>คนหนึ่งปิดได้ราว</span>
            <strong>วันละ {cap.perPerson.toFixed(1)} เคส</strong>
            <small>
              จาก {cap.resolved} เคสที่ปิดใน {CAPACITY_DAYS / 7} สัปดาห์ล่าสุด
            </small>
          </div>
          <div className={short.length ? 'warn' : ''}>
            <span>วันที่คนไม่พอ</span>
            <strong>{short.length ? `${short.length} จาก ${week.length} วัน` : 'ไม่มี'}</strong>
            <small>{short.length ? `วันแรกคือ ${dayName.format(short[0].day)}` : `ใน ${week.length} วันข้างหน้า`}</small>
          </div>
          <div className={guessed.length ? 'warn' : ''}>
            <span>ยังไม่ได้ตั้งเวลาทำงาน</span>
            <strong>{guessed.length ? `${guessed.length} คน` : 'ตั้งครบแล้ว'}</strong>
            <small>{guessed.length ? (plan.data.org_hours ? 'นับว่าทำงานทุกวันที่องค์กรเปิด' : 'นับว่าทำงานทุกวัน') : `ทีมที่นับ ${crew.length} คน`}</small>
          </div>
        </div>

        {crew.length ? (
          <ul className="staffing-list">
            {shown.map((d, i) => (
              <li key={d.day.toDateString()} className={d.state}>
                <span className="staffing-day">
                  {i === 0 && <span className="muted">พรุ่งนี้ · </span>}
                  {dayName.format(d.day)}
                </span>
                <span className="staffing-cases">{range(d)} เคส</span>
                <span className="staffing-need">{d.need ? `ต้องใช้ ${people(d.need, d.needHigh)}` : 'เคสน้อยมาก'}</span>
                <span className="staffing-have">มี {d.have} คน</span>
                <span className={`staffing-state ${d.state}`}>
                  {d.state === 'closed'
                    ? 'องค์กรปิด'
                    : d.state === 'short'
                      ? `ขาด ${d.need - d.have} คน`
                      : d.state === 'tight'
                        ? 'พอดี'
                        : 'พอ'}
                </span>
                {(d.holiday || d.away.length > 0 || d.state === 'tight') && (
                  <span className="staffing-note">
                    {d.holiday
                      ? `${d.holiday} · เคสที่เข้ามาจะรอวันทำการถัดไป`
                      : [
                          d.state === 'tight' && `ถ้าเคสเข้ามามากตามขอบบน ควรมี ${d.needHigh} คน`,
                          d.away.length > 0 && `ไม่อยู่: ${d.away.map((a) => `${a.name} (${whyWords[a.why] ?? 'ไม่อยู่'})`).join(', ')}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-mini">
            ยังไม่มีเจ้าหน้าที่{scope} <Link href="/members">เพิ่มสมาชิก</Link>
          </p>
        )}
        {days.length > SHOWN && (
          <button type="button" className="btn sm mt" aria-expanded={more} onClick={() => setMore(!more)}>
            {more ? `แสดง ${SHOWN} วัน` : `แสดงถึง ${days.length} วัน`}
          </button>
        )}
        <p className="tiny muted mt">
          ต้องใช้กี่คน คิดจากเคสที่คาดว่าจะเข้ามาหารด้วยจำนวนที่คนหนึ่งปิดได้ต่อวัน ตัวเลขแรกคือจำนวนที่น่าจะเป็นที่สุด ตัวเลขหลังคือถ้าเคสเข้ามามากตามขอบบนของช่วง ·
          นับเจ้าหน้าที่ทุกคน และเจ้าขององค์กรที่ปิดเคสเองใน {CAPACITY_DAYS / 7} สัปดาห์ล่าสุด · ไม่รวมเคสที่ค้างอยู่ตอนนี้ · วันลาและเวลาทำงานตั้งได้ที่
          ตั้งค่าบัญชี → สถานะการทำงาน ของแต่ละคน
        </p>
      </div>
    </section>
  );
}
