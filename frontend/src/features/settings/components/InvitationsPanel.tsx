'use client';

import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { date } from '@/lib/format';
import { roleLabels } from '@/lib/labels';
import { useApi, useInvalidate } from '@/lib/query';
import { useToast } from '@/components/ui/Toast';
import { useWork } from '@/lib/session';
import { cancelInvitation, INVITATIONS_PATH, resendInvitation, WORKSPACE_PATH } from '../api';
import { inviteStateLabels } from '../labels';
import type { Invitation, InvitationsPage } from '../types';
import { MemberForm } from './MemberForm';

/* ตั้งค่า → ทีมและสมาชิก → คำเชิญเข้าร่วมทีม (admins only; backend invitations). The admin names an address, a role and a
   team; the colleague opens the emailed link and chooses their own password, so no admin ever has to invent one and
   pass it on by hand. An invitation waiting for nobody can be sent again or taken back. */

// The rows share the look of the support-request list above them (settings.css .support-*).
const REFRESH = [INVITATIONS_PATH, WORKSPACE_PATH, '/api/audit'];

export function InvitationsPanel() {
  const work = useWork();
  const { openModal } = useDialogs();
  const page = useApi<InvitationsPage>(work.role === 'admin' ? INVITATIONS_PATH : null);
  if (work.role !== 'admin') return null;
  const rows = page.data?.invitations ?? [];
  const open = rows.filter((r) => r.state === 'pending');
  const past = rows.filter((r) => r.state !== 'pending').slice(0, 10);
  const canInvite = page.data?.can_invite ?? false;

  return (
    <section className="card invitations" id="invitations">
      <div className="card-header">
        <div>
          <h2>คำเชิญเข้าร่วมทีม</h2>
          <p>เชิญเพื่อนร่วมงานทางอีเมล เจ้าตัวเป็นผู้ตั้งรหัสผ่านเอง ผู้ดูแลไม่ต้องตั้งรหัสผ่านให้ใครอีก</p>
        </div>
        {canInvite && (
          <button type="button" className="btn" onClick={() => openModal('เชิญเพื่อนร่วมงาน', <MemberForm key="invite" />)}>
            <Icon name="mail" />
            เชิญทางอีเมล
          </button>
        )}
      </div>
      <div className="card-body">
        {page.error && !page.data ? (
          <ErrorState error={page.error} onRetry={() => void page.refetch()} />
        ) : !page.data ? (
          <PageLoading />
        ) : !canInvite ? (
          <p className="notice warning">
            ยังส่งคำเชิญไม่ได้ เพราะแพลตฟอร์มยังไม่ได้ตั้งค่าอีเมลของระบบ ระหว่างนี้ให้เพิ่มสมาชิกพร้อมรหัสผ่านเริ่มต้นในรายชื่อด้านล่าง แล้วแจ้งให้เจ้าตัวเปลี่ยนรหัสผ่านทันที
          </p>
        ) : open.length === 0 ? (
          <EmptyState
            icon="mail"
            title="ยังไม่มีคำเชิญที่รอตอบรับ"
            description="กด “เชิญทางอีเมล” แล้วระบบจะส่งลิงก์ให้เพื่อนร่วมงานตั้งรหัสผ่านของตัวเอง"
          />
        ) : (
          <ul className="support-list">
            {open.map((r) => (
              <InviteRow key={r.id} invitation={r} />
            ))}
          </ul>
        )}
        {past.length > 0 && (
          <details className="support-history">
            <summary>คำเชิญที่ผ่านมา ({past.length})</summary>
            <ul className="support-list">
              {past.map((r) => (
                <InviteRow key={r.id} invitation={r} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}

function InviteRow({ invitation: r }: { invitation: Invitation }) {
  const { confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const work = useWork();
  const team = work.teams.find((t) => t.id === r.team_id);

  const resend = async () => {
    const answer = await resendInvitation(r.id);
    toast((answer as { sent?: boolean }).sent === false ? 'บันทึกลิงก์ใหม่แล้ว แต่ส่งอีเมลไม่สำเร็จ กรุณาลองอีกครั้ง' : `ส่งคำเชิญถึง ${r.email} อีกครั้งแล้ว`);
    await refresh(...REFRESH);
  };
  const cancel = () =>
    confirm({
      title: 'ยกเลิกคำเชิญ',
      message: `ลิงก์ที่ส่งถึง ${r.email} จะใช้ไม่ได้ทันที หากต้องการเชิญใหม่ ให้ส่งคำเชิญอีกครั้ง`,
      confirmLabel: 'ยกเลิกคำเชิญ',
      tone: 'danger',
      run: async () => {
        await cancelInvitation(r.id);
        toast('ยกเลิกคำเชิญแล้ว');
        await refresh(...REFRESH);
      },
    });

  return (
    <li className={`support-item status-${r.state}`}>
      <span className="support-icon">
        <Icon name="mail" />
      </span>
      <div className="grow">
        <strong>{r.email}</strong>
        <span className="muted">
          {roleLabels[r.role] ?? r.role}
          {team ? ` · ทีม ${team.name}` : ''}
        </span>
        <span className="tiny muted">
          เชิญเมื่อ {date(r.created_at, true)}
          {r.invited_by ? ` โดย ${r.invited_by}` : ''}
          {r.state === 'pending' ? ` · ลิงก์หมดอายุ ${date(r.expires_at, true)}` : ''}
        </span>
      </div>
      <span className={`badge support-status-${r.state === 'accepted' ? 'approved' : r.state}`}>{inviteStateLabels[r.state] ?? r.state}</span>
      {r.state === 'pending' && (
        <div className="support-actions">
          <button type="button" className="btn sm" onClick={() => void resend()}>
            ส่งอีกครั้ง
          </button>
          <button type="button" className="btn sm danger" onClick={cancel}>
            ยกเลิก
          </button>
        </div>
      )}
    </li>
  );
}
