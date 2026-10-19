'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Brand } from '@/components/shell/chrome';
import { date } from '@/lib/format';

/* /status — the page anyone may open, signed in or not.

   It exists for one question: my screen has stopped working, is it the system or is it me? Without an answer every
   organization phones at the same moment, and the people who could fix the outage spend it on the phone.

   It is deliberately its own page with its own frame and no shell: the shell needs a signed-in session and the
   workspace, and the moment this page matters most is the moment those may be what is broken. It fetches on its own
   for the same reason, and says the honest thing when the fetch fails - not being able to reach the system IS the
   answer, and it is "it is us, not you". */

type Component = { key: string; name: string; state: string; detail: string; since: string | null };
type Notice = { state: string; text: string; updated_at: string; updated_by: string } | null;
type Status = { state: string; components: Component[]; notice: Notice; checked_at: string; labels: Record<string, string> };

const FALLBACK: Record<string, string> = {
  ok: 'ปกติ',
  partial: 'ใช้งานได้บางส่วน',
  down: 'ขัดข้อง',
  unknown: 'ตรวจสอบไม่ได้',
  starting: 'กำลังเริ่ม',
  watching: 'กำลังตรวจสอบ',
  maintenance: 'ปิดปรับปรุงตามแผน',
};

const REFRESH_MS = 30_000;

const icon = (state: string) =>
  state === 'ok' ? 'checkCircle' : state === 'down' ? 'bolt' : state === 'unknown' || state === 'starting' ? 'clock' : 'shield';

export function StatusScreen() {
  const [status, setStatus] = useState<Status | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    const ask = async () => {
      try {
        const response = await fetch('/api/status', { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        const answer = (await response.json()) as Status;
        if (!alive) return;
        setStatus(answer);
        setUnreachable(false);
      } catch {
        if (alive) setUnreachable(true);
      } finally {
        if (alive) setChecking(false);
      }
    };
    void ask();
    const timer = setInterval(() => void ask(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const label = (state: string) => status?.labels?.[state] ?? FALLBACK[state] ?? state;
  const overall = unreachable ? 'down' : (status?.state ?? 'unknown');

  return (
    <main className="status-page">
      <header className="status-head">
        <Brand />
        <Link className="btn subtle" href="/">
          กลับหน้าแรก
        </Link>
      </header>

      <section className={`status-hero state-${overall}`}>
        <Icon name={unreachable ? 'bolt' : icon(overall)} />
        <div>
          <h1>
            {unreachable
              ? 'ติดต่อระบบไม่ได้'
              : checking
                ? 'กำลังตรวจสอบ…'
                : overall === 'ok'
                  ? 'ระบบทำงานปกติ'
                  : `ระบบ${label(overall)}`}
          </h1>
          {unreachable ? <p>หน้านี้ติดต่อเซิร์ฟเวอร์ไม่ได้</p> : overall !== 'ok' && <p>ทีมงานเห็นปัญหาแล้ว</p>}
        </div>
      </section>

      {status?.notice && (
        <section className={`status-notice state-${status.notice.state}`}>
          <strong>
            {label(status.notice.state)} อัปเดตเมื่อ {date(status.notice.updated_at, true)}
          </strong>
          <p>{status.notice.text}</p>
        </section>
      )}

      {!unreachable && status && (
        <ul className="status-list">
          {status.components.map((part) => (
            <li key={part.key} className={`status-item state-${part.state}`}>
              <Icon name={icon(part.state)} />
              <span className="grow">
                <strong>{part.name}</strong>
                <span className="muted">{part.detail}</span>
              </span>
              <span className="status-tag">{label(part.state)}</span>
            </li>
          ))}
        </ul>
      )}

      {status && <p className="status-checked muted">ตรวจสอบล่าสุด {date(status.checked_at, true)}</p>}
    </main>
  );
}
