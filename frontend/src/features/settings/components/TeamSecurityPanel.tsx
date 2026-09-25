'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { useRunAction } from '@/components/ui/actions';
import { roleLabels } from '@/lib/labels';
import { useApi, useInvalidate } from '@/lib/query';
import { saveTeamSecurity, TEAM_SECURITY_PATH, type TeamSecurity } from '../api';

/* ความปลอดภัยของทีม (ตั้งค่า → ภาพรวมและบริการ): require every member to sign in with two steps or a passkey. A
   member without one reaches only their own account settings until they add one (backend organization/
   team_security.py). The list says who would be held back before the owner turns it on. Markup: pages/settings. */

export function TeamSecurityPanel() {
  const state = useApi<TeamSecurity>(TEAM_SECURITY_PATH);
  const refresh = useInvalidate();
  const toast = useToast();
  const run = useRunAction();
  if (state.isPending) return <PageLoading />;
  if (state.error) return <ErrorState title="โหลดการตั้งค่าไม่สำเร็จ" error={state.error} onRetry={() => void state.refetch()} />;
  const { require_two_factor: on, members } = state.data;
  const missing = members.filter((m) => !m.protected);
  const toggle = () =>
    run(async () => {
      await saveTeamSecurity(!on);
      await refresh(TEAM_SECURITY_PATH);
      toast(on ? 'เลิกบังคับการยืนยันตัวตน 2 ขั้นแล้ว' : 'บังคับการยืนยันตัวตน 2 ขั้นแล้ว');
    });
  return (
    <>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>บังคับเจ้าหน้าที่ยืนยันตัวตน 2 ขั้น</h2>
            <p>
              เจ้าหน้าที่ทุกคนต้องเปิดการยืนยันตัวตน 2 ขั้นด้วยแอปยืนยันตัวตน หรือเพิ่ม Passkey ก่อนเข้าใช้งานองค์กรนี้ คนที่ยังไม่ได้ตั้งจะเข้าได้แค่หน้า
              ตั้งค่าบัญชี เพื่อไปตั้งให้เสร็จก่อน · ช่วยกันไม่ให้คนที่ได้รหัสผ่านไปเข้าดูข้อมูลลูกค้าได้
            </p>
          </div>
        </div>
        <div className="card-body">
          <div className="team-security-state">
            <span className={`settings-status ${on ? 'on' : 'off'}`}>{on ? 'บังคับอยู่' : 'ยังไม่บังคับ'}</span>
            <span className="grow">
              {on
                ? missing.length
                  ? `ตอนนี้มี ${missing.length} คนที่ยังเข้าใช้งานไม่ได้จนกว่าจะตั้งเสร็จ`
                  : 'เจ้าหน้าที่ทุกคนตั้งเรียบร้อยแล้ว'
                : missing.length
                  ? `ถ้าเปิด ${missing.length} คนจะต้องตั้งก่อนจึงจะเข้าใช้งานได้`
                  : 'เจ้าหน้าที่ทุกคนตั้งไว้แล้ว เปิดได้เลยโดยไม่มีใครติด'}
            </span>
            <button type="button" className={`btn ${on ? '' : 'primary'}`} onClick={() => void toggle()}>
              <Icon name={on ? 'close' : 'shield'} />
              {on ? 'เลิกบังคับ' : 'เปิดการบังคับ'}
            </button>
          </div>
          <p className="tiny muted mt">
            คุณต้องตั้งให้บัญชีของตัวเองก่อนจึงจะเปิดได้ ที่ <Link href="/account?tab=security">ตั้งค่าบัญชี → ความปลอดภัย</Link>
          </p>
        </div>
      </section>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>สถานะของเจ้าหน้าที่</h2>
            <p>ตั้งแล้ว {members.length - missing.length} จาก {members.length} คน · แต่ละคนตั้งเองได้ที่ ตั้งค่าบัญชี → ความปลอดภัย</p>
          </div>
        </div>
        <div className="card-body">
          <ul className="security-list team-security-list">
            {members.map((m) => (
              <li key={m.id}>
                <span className="security-list-icon">
                  <Icon name={m.protected ? 'shield' : 'lock'} />
                </span>
                <span className="grow">
                  <strong>
                    {m.name} <span className="muted">· {roleLabels[m.role] ?? m.role}</span>
                  </strong>
                  <span className="muted">{m.email}</span>
                  <span className={`settings-status ${m.protected ? 'on' : 'warn'}`}>{m.protected ? 'ตั้งแล้ว' : 'ยังไม่ได้ตั้ง'}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
