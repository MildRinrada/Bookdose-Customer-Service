'use client';

import { useEffect, useState } from 'react';
import { waitingRequests } from '@/lib/api/client';

/* Under the whole-screen wait (display.tsx InitialLoading): still waiting after SLOW_MS, it says so, names what has not
   answered (lib/api/client waitingRequests) and offers to load the page again, instead of a logo that never goes away. */

const SLOW_MS = 12000;

export function SlowNotice() {
  const [waiting, setWaiting] = useState<Array<{ path: string; seconds: number }> | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setWaiting(waitingRequests()), SLOW_MS);
    return () => window.clearTimeout(timer);
  }, []);
  if (!waiting) return null;
  return (
    <div className="initial-loading-slow">
      <p>ใช้เวลานานกว่าปกติ</p>
      {waiting.length > 0 && <p className="tiny muted">ยังรอ {waiting.map((r) => `${r.path} (${r.seconds} วินาที)`).join(', ')}</p>}
      <button type="button" className="btn" onClick={() => window.location.reload()}>
        โหลดหน้าใหม่
      </button>
    </div>
  );
}
