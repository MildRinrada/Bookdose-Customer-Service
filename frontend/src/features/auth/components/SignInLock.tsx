'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { ApiError } from '@/lib/api/client';
import { clockTime } from '@/lib/format';

/* Too many wrong passwords (or codes) for this email: the server answers 429 {error, retry_after} until the lock ends
   (docs/SECURITY-DESIGN.md §1). The sign-in forms (AuthScreen, TwoFactorStep) show it here with a live countdown and
   keep their submit button disabled until it is over. Markup: pages/security.css (.lock-notice). */

export type SignInLock = {
  locked: boolean;
  /** Seconds left. */
  left: number;
  /** When the lock is over (local time), for the sentence screen readers hear once. */
  until: number | null;
  message: string;
  /** Take a failed sign-in: true when it was a lock (now shown), false for anything else. */
  catchLock: (error: unknown) => boolean;
};

export function useSignInLock(): SignInLock {
  const [until, setUntil] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (until === null) return;
    const tick = () => {
      const seconds = Math.ceil((until - Date.now()) / 1000);
      if (seconds > 0) setLeft(seconds);
      else {
        setLeft(0);
        setUntil(null);
      }
    };
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [until]);

  const catchLock = useCallback((error: unknown) => {
    if (!(error instanceof ApiError) || error.status !== 429) return false;
    // A 429 without a wait (e.g. an old server) still stops the form for a minute rather than inviting more tries.
    const seconds = Math.max(1, Math.ceil(error.retryAfter ?? 60));
    setUntil(Date.now() + seconds * 1000);
    setLeft(seconds);
    setMessage(error.message);
    return true;
  }, []);

  return { locked: until !== null, left, until, message, catchLock };
}

const mmss = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

/** The lock message: what happened and when to try again (read once), the ticking countdown, and what else to do
    (`help`: the "ลืมรหัสผ่าน" links - a new password from the email lifts the lock at once). */
export function LockNotice({ lock, help }: { lock: SignInLock; help: ReactNode }) {
  if (!lock.locked || lock.until === null) return null;
  // The server's sentence ends with "…ในอีก N นาที", which the countdown says better.
  const title = lock.message.replace(/\s*กรุณาลองใหม่ในอีก.*$/, '') || 'ลงชื่อเข้าใช้ผิดหลายครั้ง';
  return (
    <div className="lock-notice">
      <Icon name="lock" />
      <div className="lock-notice-text">
        <p role="alert">
          <strong>{title}</strong> ลองใหม่ได้อีกครั้งเวลา {clockTime(lock.until)} น.
        </p>
        <p className="lock-countdown" aria-hidden="true">
          เหลือเวลา <span className="mono">{mmss(lock.left)}</span>
        </p>
        <p className="lock-help">{help}</p>
      </div>
    </div>
  );
}
