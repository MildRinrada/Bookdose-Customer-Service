'use client';

import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import { approveSupport, denySupport, endSupport, SUPPORT_PATH, WORKSPACE_PATH } from '../api';
import { supportHours, supportStatusLabels } from '../labels';
import type { SupportRequest } from '../types';

/* ตั้งค่า → ทีมและสมาชิก → คำขอเข้าช่วยเหลือจากทีมแพลตฟอร์ม (admins only; backend support_access): a platform admin who
   asks to enter this organization waits here. Nothing of the organization can be read until an admin approves, for
   no longer than was asked; an access in force can be stopped at any moment, and it ends by itself on time. */

const REFRESH = [SUPPORT_PATH, WORKSPACE_PATH, '/api/audit'];

/** `quiet`: nothing is drawn while no platform admin is asking or already inside, beyond one line for the ones that
    are over. It is rare, and a card explaining it is not what a screen about the organization's own people opens with. */
export function SupportRequestsPanel({ quiet = false }: { quiet?: boolean } = {}) {
  const work = useWork();
  const requests = useApi<{ requests: SupportRequest[] }>(work.role === 'admin' ? SUPPORT_PATH : null);
  if (work.role !== 'admin') return null;
  const rows = requests.data?.requests ?? [];
  const open = rows.filter((r) => r.status === 'pending' || (r.status === 'approved' && r.expires_at && r.expires_at > new Date().toISOString()));
  const past = rows.filter((r) => !open.includes(r)).slice(0, 10);

  if (quiet && requests.data && open.length === 0) {
    if (!past.length) return null;
    return (
      <details className="support-history lone-history">
        <summary>คำขอเข้าช่วยเหลือที่ผ่านมา ({past.length})</summary>
        <ul className="support-list">
          {past.map((r) => (
            <SupportRow key={r.id} request={r} />
          ))}
        </ul>
      </details>
    );
  }
  return (
    <section className="card support-requests" id="support-requests">
      <div className="card-header">
        <div>
          <h2>คำขอเข้าช่วยเหลือจากทีมแพลตฟอร์ม</h2>
          <p>ทีมผู้ดูแลแพลตฟอร์มจะอ่านเคสและบทสนทนาขององค์กรได้เฉพาะเมื่อคุณอนุมัติ และเฉพาะช่วงเวลาที่อนุมัติเท่านั้น</p>
        </div>
      </div>
      <div className="card-body">
        {requests.error && !requests.data ? (
          <ErrorState error={requests.error} onRetry={() => void requests.refetch()} />
        ) : !requests.data ? (
          <PageLoading />
        ) : open.length === 0 ? (
          <EmptyState icon="shield" title="ไม่มีคำขอที่รอหรือกำลังใช้งาน" description="เมื่อทีมแพลตฟอร์มขอเข้าช่วยเหลือ คำขอจะแสดงที่นี่และส่งอีเมลแจ้งผู้ดูแลองค์กร" />
        ) : (
          <ul className="support-list">
            {open.map((r) => (
              <SupportRow key={r.id} request={r} />
            ))}
          </ul>
        )}
        {past.length > 0 && (
          <details className="support-history">
            <summary>คำขอที่ผ่านมา ({past.length})</summary>
            <ul className="support-list">
              {past.map((r) => (
                <SupportRow key={r.id} request={r} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}

function SupportRow({ request: r }: { request: SupportRequest }) {
  const { openModal, closeModal, confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const active = r.status === 'approved' && Boolean(r.expires_at && r.expires_at > new Date().toISOString());
  const approve = () =>
    openModal(
      'อนุมัติให้เข้าช่วยเหลือ',
      <Form
        className="dialog-form"
        data-form="support-approve"
        onSubmit={async (values) => {
          await approveSupport(r.id, { hours: Number(values.hours), note: values.note ?? '' });
          closeModal(true);
          toast(`อนุมัติแล้ว ${r.requester.name} เข้าได้ ${values.hours} ชั่วโมง`);
          await refresh(...REFRESH);
        }}
      >
        <p>
          <strong>{r.requester.name}</strong> ({r.requester.email}) จะดูข้อมูลขององค์กรได้แบบอ่านอย่างเดียว เพื่อช่วยตรวจสอบปัญหา ตอบลูกค้า รับเคส หรือแก้ไขข้อมูลไม่ได้
          และสิทธิ์จะหมดเองเมื่อครบเวลา
        </p>
        <p className="notice">เหตุผล: {r.reason}</p>
        <div className="field">
          <label htmlFor="support-hours">อนุญาตเป็นเวลา</label>
          <select id="support-hours" name="hours" defaultValue={String(r.hours)}>
            {supportHours
              .filter((h) => h <= r.hours)
              .map((h) => (
                <option key={h} value={h}>
                  {h} ชั่วโมง
                </option>
              ))}
          </select>
        </div>
        <TextField label="หมายเหตุถึงผู้ขอ (ไม่บังคับ)" name="note" max={300} required={false} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => closeModal()}>
            ยกเลิก
          </button>
          <button className="btn primary" type="submit">
            <Icon name="check" />
            อนุมัติ
          </button>
        </div>
      </Form>,
    );
  const deny = () =>
    confirm({
      title: 'ปฏิเสธคำขอ',
      message: `${r.requester.name} จะเข้าองค์กรไม่ได้ ถ้ายังต้องการช่วยเหลือ ต้องส่งคำขอใหม่`,
      confirmLabel: 'ปฏิเสธ',
      tone: 'danger',
      run: async () => {
        await denySupport(r.id);
        toast('ปฏิเสธคำขอแล้ว');
        await refresh(...REFRESH);
      },
    });
  const end = () =>
    confirm({
      title: 'หยุดสิทธิ์เข้าช่วยเหลือตอนนี้',
      message: `${r.requester.name} จะออกจากองค์กรทันที เคสที่มอบหมายให้จะกลับเป็นยังไม่มีผู้รับผิดชอบ`,
      confirmLabel: 'หยุดสิทธิ์',
      tone: 'danger',
      run: async () => {
        await endSupport(r.id);
        toast('หยุดสิทธิ์เข้าช่วยเหลือแล้ว');
        await refresh(...REFRESH);
      },
    });
  return (
    <li className={`support-item status-${active ? 'active' : r.status}`}>
      <span className="support-icon">
        <Icon name="shield" />
      </span>
      <div className="grow">
        <strong>
          {r.requester.name} <span className="muted">· {r.requester.email}</span>
        </strong>
        <span>{r.reason}</span>
        <span className="tiny muted">
          ขอเมื่อ {date(r.created_at, true)} · ขอ {r.hours} ชั่วโมง
          {active && r.expires_at ? ` · ใช้งานได้ถึง ${date(r.expires_at, true)}` : ''}
          {r.decided_by ? ` · ตัดสินโดย ${r.decided_by}` : ''}
          {r.ended_by ? ` · หยุดโดย ${r.ended_by}` : ''}
          {r.note ? ` · หมายเหตุ: ${r.note}` : ''}
        </span>
      </div>
      <span className={`badge support-status-${active ? 'active' : r.status}`}>{active ? 'กำลังใช้งาน' : supportStatusLabels[r.status]}</span>
      {r.status === 'pending' && (
        <div className="support-actions">
          <button type="button" className="btn sm primary" onClick={approve}>
            อนุมัติ
          </button>
          <button type="button" className="btn sm" onClick={deny}>
            ปฏิเสธ
          </button>
        </div>
      )}
      {active && (
        <div className="support-actions">
          <button type="button" className="btn sm danger" onClick={end}>
            หยุดสิทธิ์ตอนนี้
          </button>
        </div>
      )}
    </li>
  );
}
