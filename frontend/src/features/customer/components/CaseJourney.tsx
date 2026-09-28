import { Icon } from '@/components/Icon';
import { date } from '@/lib/format';
import type { CustomerTone } from '@/lib/labels';
import type { CaseJourneyStep } from '../types';

/* เส้นทางเคส (backend tickets/journey.py), like tracking a parcel: รับเรื่อง → กำลังดูแล → รอคุณ → เสร็จ, each step
   passed with the time it was reached, the step the case is at now marked. รอคุณ happens only when the team asks the
   customer for something, so a case finished without it says ไม่ต้องรอ there, and one still in the team's hands says
   when it would come. The whole path, every change with its time, is the case page's ความคืบหน้า card
   (journeyEvents). Markup: pages/customer (case-journey). */

const STEPS: { state: CustomerTone; label: string }[] = [
  { state: 'received', label: 'รับเรื่อง' },
  { state: 'working', label: 'กำลังดูแล' },
  { state: 'waiting', label: 'รอคุณ' },
  { state: 'done', label: 'เสร็จ' },
];

const lastAt = (journey: CaseJourneyStep[], state: CustomerTone) => [...journey].reverse().find((j) => j.state === state)?.at;

export function CaseJourney({ journey }: { journey: CaseJourneyStep[] }) {
  const current = STEPS.findIndex((s) => s.state === (journey[journey.length - 1]?.state ?? 'received'));
  return (
    <ol className="case-journey" aria-label="เส้นทางของเคส">
      {STEPS.map((step, i) => {
        const at = lastAt(journey, step.state);
        const state = i === current ? 'current' : i > current ? 'next' : at ? 'done' : 'skipped';
        const note =
          state === 'skipped' ? 'ไม่ต้องรอ' : state === 'next' ? (step.state === 'waiting' ? 'ถ้าทีมขอข้อมูลเพิ่ม' : '') : at ? date(at, true) : '';
        return (
          <li
            key={step.state}
            className={`case-journey-step ${state}${state === 'current' ? ` tone-${step.state}` : ''}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="case-journey-dot" aria-hidden="true">
              {state === 'done' || (state === 'current' && step.state === 'done') ? <Icon name="check" /> : state === 'skipped' ? null : i + 1}
            </span>
            <span className="case-journey-label">{step.label}</span>
            {note && <span className="case-journey-time">{note}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Every change of the case with its time, oldest first, in the customer's words; the team's first reply is its own
    line unless it is the moment the team started (then the two are one line). */
export function journeyEvents(journey: CaseJourneyStep[], firstResponseAt: string | null): Array<{ title: string; at: string }> {
  const events: Array<{ title: string; at: string }> = [];
  let started = false;
  journey.forEach((step, i) => {
    const before = journey[i - 1]?.state;
    if (step.state === 'received') events.push({ title: i ? 'กลับเข้าคิว รอทีมงานรับดูแล' : 'รับเรื่องแล้ว', at: step.at });
    else if (step.state === 'waiting') events.push({ title: 'ทีมงานขอข้อมูลเพิ่มจากคุณ', at: step.at });
    else if (step.state === 'done') events.push({ title: 'ดำเนินการเรียบร้อย', at: step.at });
    else if (before === 'done') events.push({ title: 'เปิดเรื่องอีกครั้ง ทีมงานดูแลต่อ', at: step.at });
    else if (started) events.push({ title: 'ทีมงานกลับมาดูแลต่อ', at: step.at });
    else {
      started = true;
      const together = firstResponseAt && Math.abs(Date.parse(firstResponseAt) - Date.parse(step.at)) < 120000;
      events.push({ title: together ? 'ทีมงานตอบครั้งแรกและเริ่มดูแล' : 'ทีมงานเริ่มดูแล', at: step.at });
      if (firstResponseAt && !together) events.push({ title: 'ทีมงานตอบครั้งแรก', at: firstResponseAt });
    }
  });
  if (firstResponseAt && !started) events.push({ title: 'ทีมงานตอบครั้งแรก', at: firstResponseAt });
  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
