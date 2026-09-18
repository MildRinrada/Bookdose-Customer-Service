import Link from 'next/link';
import { Icon } from '@/components/Icon';
import type { SetupChecklist } from '../types';

/* ตั้งค่าองค์กรให้ครบ (owners): a broken channel first, then the steps still to do with where to do them, and the steps
   already done ticked. Nothing shows once every step is done and nothing is broken. Markup: dashboard-extras
   (setup-card). */

export function SetupCard({ setup }: { setup: SetupChecklist }) {
  const done = setup.steps.filter((s) => s.done).length;
  if (done === setup.steps.length && !setup.problems.length) return null;
  const todo = setup.steps.filter((s) => !s.done);
  return (
    <section className="card setup-card" aria-labelledby="setup-title">
      <div className="card-header">
        <div>
          <h2 id="setup-title">{setup.problems.length ? 'ต้องแก้ไขตอนนี้' : 'ตั้งค่าองค์กรให้ครบ'}</h2>
          <p>
            ตั้งค่าแล้ว {done} จาก {setup.steps.length} ขั้น · เห็นเฉพาะเจ้าขององค์กร
          </p>
        </div>
        <progress className="setup-progress" value={done} max={setup.steps.length} aria-label={`ตั้งค่าแล้ว ${done} จาก ${setup.steps.length} ขั้น`} />
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
        {todo.map((s) => (
          <li key={s.key} className="setup-item">
            <span className="setup-check" aria-hidden="true" />
            <span className="setup-text">
              <strong>{s.title}</strong>
              <span className="tiny muted">{s.detail}</span>
            </span>
            <Link className="btn small" href={s.action.href}>
              {s.action.label}
            </Link>
          </li>
        ))}
      </ul>
      {done > 0 && (
        <p className="setup-done tiny muted">
          <Icon name="checkCircle" /> เสร็จแล้ว: {setup.steps.filter((s) => s.done).map((s) => s.title).join(' · ')}
        </p>
      )}
    </section>
  );
}
