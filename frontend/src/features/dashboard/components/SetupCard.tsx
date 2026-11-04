'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { InfoHint } from '@/components/ui/InfoHint';
import { useDialogs } from '@/components/ui/Dialogs';
import { useToast } from '@/components/ui/Toast';
import { celebrate } from '@/features/staff-account/celebrate';
import { useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import { hideSetup, OVERVIEW_PREFIX } from '../api';
import type { SetupChecklist, SetupStep } from '../types';

/* เริ่มต้นใช้งาน (owners): a broken channel first, then the four steps that make a new organization work, with where
   to do each one. A new organization that cannot work out what to set up stops using the system, so this says how
   far along it is rather than only what is missing, and a step that is partly done says how far ("2 จาก 5 บทความ"):
   a number that is moving is a reason to carry on.

   Steps already done stay on the list, ticked, instead of disappearing: seeing three ticks and one blank is what
   makes the last one feel worth doing. Rules and AI sit apart under ทำเพิ่มได้ภายหลัง - they make a working
   organization better, they do not make it work. Nothing shows once the four are done and nothing is broken.

   An owner who does not want to follow the steps closes them for good (ปิดถาวร, in this organization): the card leaves
   the page and the cards under it move up. A broken channel still shows here, alone, because that is not a step.
   Markup: dashboard-extras (setup-card). */

/** One step. `number` is its place in the order the steps are meant to be done (none for the ones under
    ทำเพิ่มได้ภายหลัง); `next` is the first one not done yet, the one to do now, so it is the one that stands out. */
function StepRow({ step, number, next = false }: { step: SetupStep; number?: number; next?: boolean }) {
  const partial = !step.done && typeof step.count === 'number' && step.count > 0;
  return (
    <li className={`setup-item${step.done ? ' is-done' : ''}${next ? ' is-next' : ''}`}>
      {step.done ? (
        <span className="setup-mark">
          <Icon name="checkCircle" />
        </span>
      ) : (
        <span className="setup-check" aria-label={number ? `ขั้นที่ ${number}` : undefined}>
          {number}
        </span>
      )}
      <span className="setup-text">
        <strong>{step.title}</strong>
        {/* The detail says why the step is worth doing, so it reads wrong once it is done ("ยังไม่มีเจ้าหน้าที่"
            under a ticked row). A finished step shows what it ended up with, or nothing at all. */}
        {step.done ? (
          typeof step.count === 'number' ? <span className="tiny muted">มีแล้ว {step.count} บทความ</span> : null
        ) : (
          partial && <span className="tiny muted">ทำแล้ว {step.count} จาก {step.target}</span>
        )}
      </span>
      {step.done ? (
        <span className="setup-tag">เสร็จแล้ว</span>
      ) : (
        <Link className={`btn small${next ? ' primary' : ''}`} href={step.action.href}>
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

/** The problems this browser closed the card on, per organization: closed, the card stays away until the problems
    are different ones (a new one appears, or one is fixed and another breaks). Browser storage can be refused; then
    closing lasts until the page is opened again. */
function useClosedProblems(setup: SetupChecklist) {
  const work = useWork();
  const key = `bookdose.setup-problems-closed:${work.tenant.id}`;
  const fingerprint = setup.problems.map((p) => p.key).sort().join(',');
  const [closed, setClosed] = useState<string | null>(() => {
    try {
      return typeof window === 'undefined' ? null : localStorage.getItem(key);
    } catch {
      return null;
    }
  });
  const close = () => {
    setClosed(fingerprint);
    try {
      localStorage.setItem(key, fingerprint);
    } catch {
      /* Only for this visit, then. */
    }
  };
  return { hidden: Boolean(fingerprint) && closed === fingerprint, close };
}

/** Is there anything for the card to show? When not, the page leaves it off and the cards under it move up. */
export const setupShown = (setup: SetupChecklist) =>
  setup.problems.length > 0 || (!setup.hidden && setup.steps.some((s) => !s.done));

export function SetupCard({ setup }: { setup: SetupChecklist }) {
  useCelebrateFinished(setup);
  const problems = useClosedProblems(setup);
  const { confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const done = setup.steps.filter((s) => s.done).length;
  const later = setup.later ?? [];
  if (!setupShown(setup)) return null;
  const steps = !setup.hidden;
  if (!steps && problems.hidden) return null;
  const close = () =>
    confirm({
      title: 'ปิดเริ่มต้นใช้งานถาวร',
      message: 'รายการขั้นตอนนี้จะไม่แสดงบนหน้าภาพรวมของคุณในองค์กรนี้อีก',
      confirmLabel: 'ปิดถาวร',
      run: async () => {
        await hideSetup(true);
        await refresh(OVERVIEW_PREFIX);
        toast('ปิดเริ่มต้นใช้งานแล้ว');
      },
    });
  return (
    <section className="card setup-card" aria-labelledby="setup-title">
      <div className="card-header">
        <div>
          <h2 id="setup-title">
            {setup.problems.length ? 'ต้องแก้ไขตอนนี้' : 'เริ่มต้นใช้งาน'}
            <InfoHint>
              {setup.problems.length
                ? 'ช่องทางที่ส่งข้อความถึงลูกค้าไม่ออกหรือล่าช้า แก้แล้วรายการจะหายไปเอง เห็นเฉพาะหัวหน้าทีม'
                : 'ขั้นตอนที่ทำให้องค์กรพร้อมรับลูกค้าจริง ทำตามลำดับเลข ขั้นที่ทำแล้วระบบจะติ๊กให้เอง เห็นเฉพาะหัวหน้าทีม'}
            </InfoHint>
          </h2>
          <p>
            {steps
              ? `ทำแล้ว ${done} จาก ${setup.steps.length} ขั้น`
              : 'ช่องทางที่ส่งข้อความไม่ออก'}
          </p>
        </div>
        {steps && (
          <div className="setup-head-side">
            <progress className="setup-progress" value={done} max={setup.steps.length} aria-label={`ทำแล้ว ${done} จาก ${setup.steps.length} ขั้น`} />
            <button type="button" className="btn small" onClick={close}>
              <Icon name="close" />
              ปิดถาวร
            </button>
          </div>
        )}
        {!steps && (
          <button type="button" className="icon-btn" aria-label="ปิด" title="ปิด จะแสดงอีกเมื่อมีปัญหาใหม่" onClick={problems.close}>
            <Icon name="close" />
          </button>
        )}
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
        {steps &&
          setup.steps.map((step, i) => (
            <StepRow key={step.key} step={step} number={i + 1} next={setup.steps.findIndex((s) => !s.done) === i} />
          ))}
      </ul>
      {steps && later.length > 0 && done === setup.steps.length && (
        <>
          <p className="setup-later-head tiny muted">ทำเพิ่มได้ภายหลัง</p>
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
