'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Icon } from '@/components/Icon';
import { celebrate } from '@/features/staff-account/celebrate';
import { useWork } from '@/lib/session';
import type { SetupChecklist, SetupStep } from '../types';

/* เริ่มต้นใช้งาน (owners): a broken channel first, then the four steps that make a new organization work, with where
   to do each one. A new organization that cannot work out what to set up stops using the system, so this says how
   far along it is rather than only what is missing, and a step that is partly done says how far ("2 จาก 5 บทความ"):
   a number that is moving is a reason to carry on.

   Steps already done stay on the list, ticked, instead of disappearing: seeing three ticks and one blank is what
   makes the last one feel worth doing. Rules and AI sit apart under ทำเพิ่มได้ภายหลัง - they make a working
   organization better, they do not make it work. Nothing shows once the four are done and nothing is broken.
   Markup: dashboard-extras (setup-card). */

function StepRow({ step }: { step: SetupStep }) {
  const partial = !step.done && typeof step.count === 'number' && step.count > 0;
  return (
    <li className={`setup-item${step.done ? ' is-done' : ''}`}>
      {step.done ? <Icon name="checkCircle" /> : <span className="setup-check" aria-hidden="true" />}
      <span className="setup-text">
        <strong>{step.title}</strong>
        {/* The detail says why the step is worth doing, so it reads wrong once it is done ("ยังไม่มีเจ้าหน้าที่"
            under a ticked row). A finished step shows what it ended up with, or nothing at all. */}
        {step.done ? (
          typeof step.count === 'number' ? <span className="tiny muted">มีแล้ว {step.count} บทความ</span> : null
        ) : (
          <span className="tiny muted">{partial ? `ทำแล้ว ${step.count} จาก ${step.target} · ${step.detail}` : step.detail}</span>
        )}
      </span>
      {step.done ? (
        <span className="setup-tag">เสร็จแล้ว</span>
      ) : (
        <Link className="btn small" href={step.action.href}>
          {step.action.label}
        </Link>
      )}
    </li>
  );
}

/** Which steps were already done the last time this browser looked, so a step finishing is noticed once and not on
    every visit afterwards. Kept per organization, so switching organizations never celebrates the other one's work.
    Browser storage can be refused (a private window); it is only a nicety, so a failure means no celebration. */
function useCelebrateFinished(setup: SetupChecklist) {
  const work = useWork();
  const key = `bookdose.setup-done:${work.tenant.id}`;
  const doneKeys = setup.steps.filter((s) => s.done).map((s) => s.key);
  const fingerprint = doneKeys.join(',');
  useEffect(() => {
    let before: string[] | null = null;
    try {
      const raw = localStorage.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) before = parsed.filter((item): item is string => typeof item === 'string');
      localStorage.setItem(key, JSON.stringify(fingerprint ? fingerprint.split(',') : []));
    } catch {
      return;
    }
    // Nothing remembered yet: this is the first look, and an organization that is already half set up should not be
    // congratulated for work it did before anyone was watching.
    if (!before) return;
    const finished = (fingerprint ? fingerprint.split(',') : []).filter((k) => !before.includes(k));
    if (!finished.length) return;
    const step = setup.steps.find((s) => s.key === finished[finished.length - 1]);
    const all = doneKeys.length === setup.steps.length;
    const left = setup.steps.length - doneKeys.length;
    celebrate({
      kind: 'resolved',
      title: all ? 'ตั้งค่าครบทุกขั้นแล้ว' : `สำเร็จ: ${step?.title ?? ''}`,
      detail: all ? 'องค์กรของคุณพร้อมรับลูกค้าจริงแล้ว' : `เหลืออีก ${left} ขั้น`,
    });
    // setup.steps only changes with the fingerprint, which is what decides whether anything is said at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fingerprint]);
}

export function SetupCard({ setup }: { setup: SetupChecklist }) {
  useCelebrateFinished(setup);
  const done = setup.steps.filter((s) => s.done).length;
  const later = setup.later ?? [];
  if (done === setup.steps.length && !setup.problems.length) return null;
  return (
    <section className="card setup-card" aria-labelledby="setup-title">
      <div className="card-header">
        <div>
          <h2 id="setup-title">{setup.problems.length ? 'ต้องแก้ไขตอนนี้' : 'เริ่มต้นใช้งาน'}</h2>
          <p>
            ทำแล้ว {done} จาก {setup.steps.length} ขั้น · ทำครบแล้วองค์กรของคุณพร้อมรับลูกค้าจริง · เห็นเฉพาะเจ้าขององค์กร
          </p>
        </div>
        <progress className="setup-progress" value={done} max={setup.steps.length} aria-label={`ทำแล้ว ${done} จาก ${setup.steps.length} ขั้น`} />
      </div>
      <ul className="setup-list">
        {setup.problems.map((p) => (
          <li key={p.key} className={`setup-item ${p.level}`}>
            <Icon name="bolt" />
            <span className="setup-text">
              <strong>{p.title}</strong>
              <span className="tiny muted">{p.detail}</span>
            </span>
            <Link className="btn small" href={p.action.href}>
              {p.action.label}
            </Link>
          </li>
        ))}
        {setup.steps.map((step) => (
          <StepRow key={step.key} step={step} />
        ))}
      </ul>
      {later.length > 0 && done === setup.steps.length && (
        <>
          <p className="setup-later-head tiny muted">ทำเพิ่มได้ภายหลัง · ไม่จำเป็นต่อการเริ่มใช้งาน</p>
          <ul className="setup-list setup-later">
            {later.map((step) => (
              <StepRow key={step.key} step={step} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
