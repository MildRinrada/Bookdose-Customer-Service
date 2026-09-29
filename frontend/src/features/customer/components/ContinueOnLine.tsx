'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import type { LineMoveCode, PortalLine } from '../types';

/* คุยต่อใน LINE (backend channels/move.py): the same chat carried to the organization's LINE, history and all, so the
   customer does not start over and tell it again. The button in the chat's header opens the steps under it: a
   6-digit code, and on a phone a button that opens LINE with the code typed in. While the code waits, the chat is read
   every 5 seconds; once it arrives the page says the chat goes on in LINE and the box to write in makes way for a link
   there. Used by the signed-in customer's chat and the guest's. Markup: pages/continue-line.css. */

export function useSecondsLeft(until: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, Math.round((Date.parse(until) - now) / 1000)) : 0;
}

export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** The header's button: shown while the chat can still go to LINE. */
export function ContinueOnLineButton({ line, open, onToggle }: { line: PortalLine | null | undefined; open: boolean; onToggle: () => void }) {
  if (!line || line.moved) return null;
  return (
    <button type="button" className="btn sm continue-line-btn" aria-expanded={open} onClick={onToggle}>
      <Icon name="chat" />
      คุยต่อใน LINE
    </button>
  );
}

/** The steps, under the header while open. */
export function ContinueOnLinePanel({
  line,
  request,
  refresh,
  onClose,
}: {
  line: PortalLine;
  /** Asks the server for a code for this chat. */
  request: () => Promise<LineMoveCode>;
  /** Reads the chat again (to see the code arrive). */
  refresh: () => unknown;
  onClose: () => void;
}) {
  const [code, setCode] = useState<LineMoveCode | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useRunAction();
  const left = useSecondsLeft(code?.expires_at);
  const waiting = Boolean(code && left > 0);
  const name = code?.oa_name || line.oa_name;

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [waiting, refresh]);

  const ask = () =>
    run(async () => {
      setBusy(true);
      try {
        setCode(await request());
      } finally {
        setBusy(false);
      }
    });

  return (
    <section className="continue-line" aria-label="คุยต่อใน LINE">
      <div className="continue-line-head">
        <p>
          <strong>ย้ายแชทนี้ไปคุยต่อใน LINE กับ {name}</strong>
          ข้อความเดิมย้ายไปด้วยทั้งหมด ไม่ต้องเล่าใหม่ ทีมงานจะตอบใน LINE แทน
        </p>
        <button type="button" className="icon-btn" aria-label="ปิด" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {waiting && code ? (
        <>
          <div className="line-code-box">
            <span className="line-code" aria-label={`รหัส ${code.code.split('').join(' ')}`}>
              {code.code}
            </span>
            {code.send_url && (
              <a className="btn primary" href={code.send_url} target="_blank" rel="noopener noreferrer">
                <Icon name="send" />
                เปิด LINE พร้อมรหัส
              </a>
            )}
            <span className="line-expiry" aria-live="polite">
              <Icon name="clock" />
              ใช้ได้อีก {clock(left)} นาที
            </span>
          </div>
          <ol className="line-steps">
            {code.send_url ? (
              <li>บนมือถือ กด “เปิด LINE พร้อมรหัส” แล้วกดส่ง</li>
            ) : (
              <li>
                เพิ่มเพื่อน “{name}” ในแอป LINE
                {code.add_url && (
                  <>
                    {' '}
                    <a href={code.add_url} target="_blank" rel="noopener noreferrer">
                      เพิ่มเพื่อน
                    </a>
                  </>
                )}
              </li>
            )}
            <li>หรือพิมพ์รหัส 6 หลักนี้ส่งในแชทส่วนตัวกับ “{name}”</li>
            <li>รอสักครู่ หน้านี้จะเปลี่ยนเองเมื่อย้ายแล้ว</li>
          </ol>
        </>
      ) : (
        <button type="button" className="btn primary" disabled={busy} onClick={ask}>
          <Icon name="chat" />
          {code ? 'รหัสหมดอายุแล้ว ขอรหัสใหม่' : 'ขอรหัสย้ายไป LINE'}
        </button>
      )}
    </section>
  );
}

/** In place of the box to write in, once the chat went to LINE. */
export function MovedToLine({ line }: { line: PortalLine }) {
  return (
    <div className="moved-to-line" role="status">
      <Icon name="chat" />
      <p>
        <strong>แชทนี้ย้ายไปคุยต่อใน LINE กับ {line.oa_name} แล้ว</strong>
        ข้อความทั้งหมดยังอยู่ที่นี่ ทีมงานตอบใน LINE พิมพ์ต่อที่นั่นได้เลย
      </p>
      {line.open_url && (
        <a className="btn primary" href={line.open_url} target="_blank" rel="noopener noreferrer">
          เปิด LINE
        </a>
      )}
    </div>
  );
}
