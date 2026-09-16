'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { useOrgFilter, useOrgs } from '../hooks';

/* Small pieces several customer screens share (pages/customer/customer-*.html). */

/** Which organization's rows to show (customer-org-filter.html); only when there are two or more. */
export function OrgFilter({ id }: { id: string }) {
  const orgs = useOrgs();
  const [value, setValue] = useOrgFilter();
  if (orgs.length < 2) return null;
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        แสดงขององค์กร
      </label>
      <select id={id} className="customer-org-filter" value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">ทุกองค์กร</option>
        {orgs.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.name}
          </option>
        ))}
      </select>
    </>
  );
}

/** "ไม่พบคำตอบที่ต้องการ?" under the FAQ (customer-ask.html). */
export function CustomerAsk() {
  return (
    <section className="card customer-ask">
      <div className="card-body">
        <span className="customer-ask-icon">
          <Icon name="chat" />
        </span>
        <div className="grow">
          <strong>ไม่พบคำตอบที่ต้องการ?</strong>
          <p className="muted">ส่งคำถามถึงทีมงาน แล้วติดตามคำตอบได้ในแชทของฉัน</p>
        </div>
        <NewChatLink />
      </div>
    </section>
  );
}

/** customer-new-chat-link.html */
export function NewChatLink() {
  return (
    <Link className="btn primary" href="/customer/chats/new">
      <Icon name="plus" />
      เริ่มแชทใหม่
    </Link>
  );
}

/** The steps of a case (ส่งเรื่องแล้ว → ทีมงานดูแล → เรียบร้อย): the ones before `step` are done. */
export function ProgressSteps({ steps, step }: { steps: string[]; step: number }) {
  return (
    <ol className="customer-progress">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        return (
          <li key={n} className={`customer-progress-step${done ? ' done' : ''}${current ? ' current' : ''}`} aria-current={current ? 'step' : undefined}>
            <span className="customer-progress-dot" aria-hidden="true">
              {done ? <Icon name="check" /> : n}
            </span>
            <span className="customer-progress-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
