'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { ErrorState, InitialLoading } from '@/components/ui/display';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useApi } from '@/lib/query';
import { roleLabels } from '@/lib/labels';
import { useBoot } from '@/lib/session';
import { acceptInvitation, INVITATION_PATH } from './api';
import { SinglePage } from './components/Frames';
import { useFinishStaffSignIn } from './hooks';
import type { InvitationView } from './types';

/* /invite?token=: the link an organization's admin emailed to a colleague (backend invitations). Somebody new to the
   platform chooses their own name and password here and lands in the organization straight away; somebody who
   already has an account only joins it, and then signs in the way they always do - a link never skips a password
   or a second step. */

export function InvitationScreen({ token = '' }: { token?: string }) {
  const boot = useBoot();
  const invitation = useApi<InvitationView>(token ? INVITATION_PATH(token) : null);
  const [joined, setJoined] = useState('');

  if (!token) return <Bad message="ลิงก์คำเชิญไม่ครบถ้วน กรุณาเปิดลิงก์จากอีเมลอีกครั้ง" />;
  if (invitation.error) return <Bad message={invitation.error.message} />;
  if (!invitation.data || !boot.data) return <InitialLoading />;
  if (boot.error) return <ErrorState error={boot.error} onRetry={() => void boot.refetch()} />;

  const info = invitation.data;
  if (joined)
    return (
      <SinglePage>
        <section className="card mt">
          <div className="card-body">
            <h1>เข้าร่วม {joined} แล้ว</h1>
            <p>เข้าสู่ระบบด้วยอีเมล {info.email} และรหัสผ่านเดิมของคุณ เพื่อเริ่มทำงานในองค์กรนี้</p>
            <Link className="btn primary" href="/login">
              ไปหน้าเข้าสู่ระบบ
            </Link>
          </div>
        </section>
      </SinglePage>
    );

  return (
    <SinglePage>
      <section className="card mt">
        <div className="card-body">
          <h1>คำเชิญร่วมทีมงาน {info.organization}</h1>
          <p>
            คำเชิญนี้ส่งถึง <strong>{info.email}</strong> ในบทบาท{roleLabels[info.role] ?? info.role}
          </p>
          {info.needs_account ? (
            <NewAccountForm token={token} email={info.email} organization={info.organization} />
          ) : (
            <JoinForm token={token} organization={info.organization} onJoined={setJoined} />
          )}
        </div>
      </section>
    </SinglePage>
  );
}

/** The address is new here: the colleague sets their own password, so no admin ever knows it. */
function NewAccountForm({ token, email, organization }: { token: string; email: string; organization: string }) {
  const finish = useFinishStaffSignIn();
  return (
    <Form
      onSubmit={async (values) => {
        await acceptInvitation({ token, name: values.name ?? '', password: values.password ?? '' });
        finish('/dashboard');
      }}
    >
      <p className="notice">รหัสผ่านที่ตั้งที่นี่เป็นของคุณคนเดียว ผู้ดูแลองค์กรไม่เห็นและเปลี่ยนแทนคุณไม่ได้</p>
      <div className="stack mb">
        <TextField id="invite-name" label="ชื่อที่ให้เพื่อนร่วมงานเห็น" name="name" max={100} autoFocus />
        <TextField id="invite-password" label="ตั้งรหัสผ่านของคุณ" name="password" type="password" max={200} />
      </div>
      <p className="tiny muted">อีเมลสำหรับเข้าสู่ระบบคือ {email}</p>
      <button className="btn primary" type="submit">
        <Icon name="check" />
        เข้าร่วม {organization}
      </button>
    </Form>
  );
}

/** The address already has an account: joining adds the organization, nothing else changes. */
function JoinForm({ token, organization, onJoined }: { token: string; organization: string; onJoined: (name: string) => void }) {
  return (
    <Form
      onSubmit={async () => {
        const answer = await acceptInvitation({ token });
        onJoined(answer.organization || organization);
      }}
    >
      <p className="notice">อีเมลนี้มีบัญชีอยู่แล้ว การเข้าร่วมจะเพิ่มองค์กรนี้ให้บัญชีเดิม รหัสผ่านและการยืนยันสองขั้นตอนของคุณไม่เปลี่ยน</p>
      <button className="btn primary" type="submit">
        <Icon name="check" />
        เข้าร่วม {organization}
      </button>
    </Form>
  );
}

function Bad({ message }: { message: string }) {
  return (
    <SinglePage>
      <section className="card mt">
        <div className="card-body">
          <h1>เปิดคำเชิญไม่ได้</h1>
          <p className="notice warning">{message}</p>
          <p>กรุณาขอให้ผู้ดูแลองค์กรส่งคำเชิญอีกครั้ง หรือหากคุณเข้าร่วมไปแล้ว ให้เข้าสู่ระบบตามปกติ</p>
          <Link className="btn" href="/login">
            ไปหน้าเข้าสู่ระบบ
          </Link>
        </div>
      </section>
    </SinglePage>
  );
}
