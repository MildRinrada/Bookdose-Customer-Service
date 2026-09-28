'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api/client';
import { countryName } from '@/features/security/components/IpInfo';
import { date } from '@/lib/format';
import { SinglePage } from './components/Frames';

/* /not-me#t=<token>: the "ไม่ใช่ฉัน" link of the email about a platform admin's sign-in from a new device or network
   (backend security/sign_in_alerts.py). The token is in the fragment, so it never reaches a server log or a mail
   scanner's request; it is read once and dropped from the address. The page shows which sign-in it is about and ends
   that session only when the owner presses the button, then sends them to choose a new password. */

type SignIn = { signed_in_at: string; device: string; ip: string; active: boolean; country?: string; network?: string; hosting?: boolean };
type State = { step: 'loading' } | { step: 'gone'; message: string } | { step: 'ask'; signIn: SignIn } | { step: 'mine' } | { step: 'ended'; ended: boolean };

export function NotMeScreen() {
  const [state, setState] = useState<State>({ step: 'loading' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const token = useRef('');

  useEffect(() => {
    if (token.current) return;
    token.current = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t') ?? '';
    window.history.replaceState(null, '', window.location.pathname);
    if (!token.current) {
      setState({ step: 'gone', message: 'ลิงก์ไม่ครบ กรุณาเปิดลิงก์จากอีเมลอีกครั้ง' });
      return;
    }
    api<SignIn>('/api/sign-in-alerts/check', { token: token.current })
      .then((signIn) => setState({ step: 'ask', signIn }))
      .catch((error: Error) => setState({ step: 'gone', message: error.message }));
  }, []);

  const disown = async () => {
    setBusy(true);
    setProblem('');
    try {
      const { ended } = await api<{ ended: boolean }>('/api/sign-in-alerts/not-me', { token: token.current });
      setState({ step: 'ended', ended });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (state.step === 'loading') body = <p className="muted">กำลังตรวจลิงก์…</p>;
  else if (state.step === 'gone')
    body = (
      <>
        <h1>เปิดลิงก์นี้ไม่ได้</h1>
        <p className="notice warning">{state.message}</p>
        <Link className="btn" href="/forgot-password">
          ตั้งรหัสผ่านใหม่
        </Link>
      </>
    );
  else if (state.step === 'mine')
    body = (
      <>
        <h1>ไม่ต้องทำอะไรเพิ่ม</h1>
        <p>การเข้าสู่ระบบครั้งนั้นเป็นของคุณ บัญชียังใช้งานได้ตามปกติ ปิดหน้านี้ได้เลย</p>
      </>
    );
  else if (state.step === 'ended')
    body = (
      <>
        <h1>{state.ended ? 'ยุติการเข้าสู่ระบบนั้นแล้ว' : 'การเข้าสู่ระบบนั้นออกจากระบบไปก่อนแล้ว'}</h1>
        <p>
          ระบบแจ้งเตือนในหน้าความปลอดภัยของคอนโซลระบบกลางแล้ว ผู้ที่เข้าสู่ระบบได้อาจรู้รหัสผ่านของคุณ กรุณาตั้งรหัสผ่านใหม่ทันที การตั้งรหัสผ่านใหม่จะออกจากระบบทุกเครื่องด้วย
        </p>
        <Link className="btn primary" href="/forgot-password">
          <Icon name="lock" />
          ตั้งรหัสผ่านใหม่
        </Link>
      </>
    );
  else
    body = (
      <>
        <h1>การเข้าสู่ระบบนี้ใช่คุณหรือไม่</h1>
        <dl className="not-me-facts">
          <dt>เวลา</dt>
          <dd>{date(state.signIn.signed_in_at, true)}</dd>
          <dt>อุปกรณ์</dt>
          <dd>{state.signIn.device}</dd>
          <dt>IP</dt>
          <dd>{state.signIn.ip || 'ไม่ทราบ'}</dd>
          {state.signIn.country && (
            <>
              <dt>ประเทศ</dt>
              <dd>{countryName(state.signIn.country)}</dd>
            </>
          )}
          {state.signIn.network && (
            <>
              <dt>ผู้ให้บริการ</dt>
              <dd>
                {state.signIn.network}
                {state.signIn.hosting && ' (เครือข่ายคลาวด์หรือ VPN)'}
              </dd>
            </>
          )}
        </dl>
        {!state.signIn.active && <p className="notice">การเข้าสู่ระบบนี้ออกจากระบบไปแล้ว ถ้าไม่ใช่คุณ ยังควรกดแจ้งและตั้งรหัสผ่านใหม่</p>}
        {problem && (
          <p className="error-message" role="alert">
            {problem}
          </p>
        )}
        <div className="form-actions start">
          <button type="button" className="btn danger" disabled={busy} onClick={() => void disown()}>
            <Icon name="ban" />
            {busy ? 'กำลังยุติ…' : 'ไม่ใช่ฉัน ยุติการเข้าสู่ระบบนี้'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setState({ step: 'mine' })}>
            เป็นฉันเอง
          </button>
        </div>
      </>
    );

  return (
    <SinglePage>
      <section className="card mt not-me-card">
        <div className="card-body">{body}</div>
      </section>
    </SinglePage>
  );
}
