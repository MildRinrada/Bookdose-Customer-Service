'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { clock, useSecondsLeft } from '@/features/customer/components/ContinueOnLine';
import { requestHandoffQr } from '../api';

/* คุยต่อบนมือถือ (backend guest/handoff.py): a QR code of this chat for the guest's phone. Scanned with the phone's
   camera, the same chat opens there without an account, so a photo taken on the phone goes straight into it. The code
   works once and for 10 minutes; asking again replaces it. Shown the moment the panel opens.
   Markup: the LINE move's panel and its anchor (pages/continue-line.css) plus phone-handoff-*. */

type Handoff = { url: string; qr: string; expires_at: string };

export function PhoneHandoffPanel({ slug, conversationId, onClose }: { slug: string; conversationId: string; onClose: () => void }) {
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [problem, setProblem] = useState('');
  const [asked, setAsked] = useState(0);
  const left = useSecondsLeft(handoff?.expires_at);
  const live = Boolean(handoff && left > 0);

  useEffect(() => {
    let alive = true;
    requestHandoffQr(slug, conversationId)
      .then((made) => alive && setHandoff(made))
      .catch((error: unknown) => alive && setProblem(error instanceof Error ? error.message : String(error)));
    return () => {
      alive = false;
    };
  }, [slug, conversationId, asked]);

  const again = () => {
    setHandoff(null);
    setProblem('');
    setAsked((n) => n + 1);
  };

  return (
    // In the LINE panel's anchor, which takes no height: the panel lies over the top of the messages, not the page.
    <div className="continue-line-anchor">
    <section className="continue-line phone-handoff" aria-label="คุยต่อบนมือถือ">
      <div className="continue-line-head">
        <p>
          <strong>คุยต่อบนมือถือ</strong>
          สแกน QR ด้วยกล้องมือถือ แชทนี้จะเปิดบนมือถือทันทีโดยไม่ต้องเข้าสู่ระบบ ถ่ายรูปแล้วส่งเข้าแชทนี้ได้เลย
        </p>
        <button type="button" className="icon-btn" aria-label="ปิด" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {problem ? (
        <p className="error-text" role="alert">
          {problem}
        </p>
      ) : !handoff ? (
        <p className="muted" role="status">
          กำลังสร้าง QR…
        </p>
      ) : live ? (
        <div className="phone-handoff-body">
          {/* An SVG data: URL made by the server (backend/utils/qrcode.py), like the join links' QR. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="phone-handoff-qr" src={handoff.qr} alt="QR สำหรับเปิดแชทนี้บนมือถือ" width={180} height={180} />
          <div className="phone-handoff-text">
            <span className="line-expiry" aria-live="polite">
              <Icon name="clock" />
              ใช้ได้ครั้งเดียว อีก {clock(left)} นาที
            </span>
            <p className="tiny muted">อย่าให้คนอื่นสแกน เพราะผู้ที่สแกนจะอ่านและตอบแชทนี้ได้ แชทยังเปิดอยู่บนเครื่องนี้เหมือนเดิม</p>
          </div>
        </div>
      ) : (
        <button type="button" className="btn primary" onClick={again}>
          <Icon name="clock" />
          QR หมดอายุแล้ว สร้างใหม่
        </button>
      )}
    </section>
    </div>
  );
}
