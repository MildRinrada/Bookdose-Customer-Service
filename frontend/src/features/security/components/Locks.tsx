'use client';

import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { date, number } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { LOCKS_PATH, SECURITY_PREFIX, unlockAccount } from '../api';
import { lockActorLabels as actorLabels } from '../labels';
import type { SignInLockRow } from '../types';

/* Accounts locked after too many wrong passwords right now (by the email typed, so it may not be a real account).
   "ปลดล็อก" asks first; a lock also ends by itself or with a password reset. */

export function LocksCard() {
  const locks = useApi<{ locks: SignInLockRow[] }>(LOCKS_PATH, { refetchInterval: 60000 });
  const { confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();

  const unlock = (lock: SignInLockRow) =>
    confirm({
      title: 'ปลดล็อกบัญชี',
      message: `${lock.subject} (${actorLabels[lock.actor] ?? lock.actor}) จะลองเข้าสู่ระบบได้ทันที ปลดล็อกเฉพาะเมื่อแน่ใจว่าเป็นเจ้าของบัญชี`,
      confirmLabel: 'ปลดล็อก',
      run: async () => {
        await unlockAccount(lock.key);
        toast(`ปลดล็อก ${lock.subject} แล้ว`);
        await refresh(LOCKS_PATH, `${SECURITY_PREFIX}/overview`, `${SECURITY_PREFIX}/events`);
      },
    });

  const rows = locks.data?.locks ?? [];
  return (
    <section className="card security-card security-section" id="security-locks" aria-labelledby="security-locks-title">
      <div className="card-header">
        <div>
          <h2 id="security-locks-title">บัญชีที่ถูกล็อกอยู่</h2>
          <p>ล็อกอัตโนมัติเมื่อกรอกรหัสผิด 5 ครั้งใน 15 นาที ยิ่งถูกล็อกบ่อย ระยะเวลาล็อกยิ่งนานขึ้น</p>
        </div>
        <Icon name="lock" />
      </div>
      {locks.error ? (
        <ErrorState error={locks.error} onRetry={() => void locks.refetch()} />
      ) : !locks.data ? (
        <PageLoading />
      ) : rows.length ? (
        <div className="table-scroll">
          <table className="security-table">
            <thead>
              <tr>
                <th scope="col">บัญชี</th>
                <th scope="col">กลุ่ม</th>
                <th scope="col">ผิด</th>
                <th scope="col">ระดับ</th>
                <th scope="col">ล็อกถึง</th>
                <th scope="col">IP ล่าสุด</th>
                <th scope="col">
                  <span className="sr-only">การจัดการ</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((lock) => (
                <tr key={lock.key}>
                  <td>{lock.subject}</td>
                  <td>{actorLabels[lock.actor] ?? lock.actor}</td>
                  <td className="mono">{number(lock.failures)}</td>
                  <td className="mono">{number(lock.level)}</td>
                  <td>
                    <time dateTime={lock.locked_until}>{date(lock.locked_until, true)}</time>
                  </td>
                  <td className="mono">{lock.last_ip || '-'}</td>
                  <td className="security-actions-cell">
                    <button type="button" className="btn sm" onClick={() => unlock(lock)}>
                      <Icon name="lock" />
                      ปลดล็อก
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="card-body muted">
          <Icon name="checkCircle" /> ไม่มีบัญชีที่ถูกล็อกในขณะนี้
        </p>
      )}
    </section>
  );
}

