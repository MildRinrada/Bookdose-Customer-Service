'use client';

import { Icon } from '@/components/Icon';
import { useCopyText, useRunAction } from '@/components/ui/actions';
import { useDialogs } from '@/components/ui/Dialogs';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { SelectField, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { createJoinLink, ORG_LINKS_PATH, revokeJoinLink } from '@/features/org-links/api';
import type { OrgLinksView } from '@/features/org-links/types';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';

/* ตั้งค่าองค์กร → ลิงก์และ QR สำหรับลูกค้า: the organization's permanent link (…/?org=<code>) with its QR, and the
   invite links an admin makes for a fair, an email or a partner — each with its own QR, lifetime and number of
   users, and revocable at any time. Markup: pages/org-links.css. */

const DAYS = [
  ['0', 'ไม่มีวันหมดอายุ'],
  ['1', '1 วัน'],
  ['7', '7 วัน'],
  ['30', '30 วัน'],
  ['90', '90 วัน'],
  ['365', '1 ปี'],
];
const USES = [
  ['0', 'ไม่จำกัดจำนวน'],
  ['1', '1 คน'],
  ['5', '5 คน'],
  ['25', '25 คน'],
  ['100', '100 คน'],
];

export function JoinLinksPanel() {
  const { data, error, refetch } = useApi<OrgLinksView>(ORG_LINKS_PATH);
  const refresh = useInvalidate();
  const copyText = useCopyText();
  const toast = useToast();
  const run = useRunAction();
  const { openModal, confirm } = useDialogs();

  const showQr = (title: string, qr: string, url: string) =>
    openModal(
      title,
      <div className="org-qr-large">
        {/* A data: URL drawn by the server. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt={`QR ของ ${title}`} width={320} height={320} />
        <p className="tiny muted">{url}</p>
      </div>,
    );

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <PageLoading />;

  return (
    <>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>ลิงก์และ QR ขององค์กร</h2>
            <p>ลิงก์ถาวรของ {data.org_slug} · ลูกค้าที่เปิดลิงก์แล้วเข้าสู่ระบบจะเห็นองค์กรนี้ในรายการที่ติดต่อได้</p>
          </div>
        </div>
        <div className="card-body org-link-share">
          <figure className="org-qr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={data.org_qr} alt="QR ลิงก์ขององค์กร" width={180} height={180} />
            <figcaption>สแกนด้วยกล้องมือถือ</figcaption>
          </figure>
          <div className="grow">
            <p className="muted">
              พิมพ์ QR นี้ไว้ที่หน้าร้าน ใส่ในเอกสารหรือท้ายอีเมล ลิงก์นี้ใช้ได้เสมอและไม่มีวันหมดอายุ
              ใครที่เปิดจะสมัครสมาชิกหรือเข้าสู่ระบบก่อน แล้วองค์กรนี้จะถูกเพิ่มให้อัตโนมัติ
            </p>
            <a className="portal-url" href={data.org_url} target="_blank" rel="noopener">
              {data.org_url}
            </a>
            <div className="org-link-actions">
              <button type="button" className="btn subtle" onClick={() => void copyText(data.org_url)}>
                <Icon name="link" />
                คัดลอกลิงก์
              </button>
              <button type="button" className="btn subtle" onClick={() => showQr('ลิงก์ขององค์กร', data.org_qr, data.org_url)}>
                <Icon name="image" />
                ดู QR ขนาดใหญ่
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <div>
            <h2>ลิงก์เชิญเข้าร่วม</h2>
            <p>ลิงก์เฉพาะกิจสำหรับงานอีเวนต์หรือลูกค้ากลุ่มหนึ่ง กำหนดอายุและจำนวนคนได้ และยกเลิกได้ทุกเมื่อ</p>
          </div>
        </div>
        <Form
          className="card-body org-link-form"
          onSubmit={async (values, form) => {
            const made = await createJoinLink({
              label: values.label ?? '',
              days: Number(values.days ?? 0),
              max_uses: Number(values.max_uses ?? 0),
            });
            form.reset();
            toast('สร้างลิงก์เชิญแล้ว');
            await refresh(ORG_LINKS_PATH);
            showQr(made.label || 'ลิงก์เชิญเข้าร่วม', made.qr, made.url);
          }}
        >
          <TextField label="ชื่อเรียกลิงก์ (ไม่บังคับ)" name="label" max={60} required={false} placeholder="เช่น งานอบรมลูกค้า มีนาคม" />
          <SelectField label="อายุลิงก์" name="days" defaultValue="0">
            {DAYS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <SelectField label="ใช้ได้กี่คน" name="max_uses" defaultValue="0">
            {USES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <button className="btn primary" type="submit">
            <Icon name="plus" />
            สร้างลิงก์
          </button>
        </Form>
        <div className="card-body">
          {data.links.length === 0 ? (
            <p className="muted">ยังไม่มีลิงก์เชิญ ลูกค้าเพิ่มองค์กรนี้ด้วยลิงก์ถาวรหรือรหัสองค์กรได้เสมอ</p>
          ) : (
            <div className="table-scroll">
              <table className="join-links">
                <thead>
                  <tr>
                    <th>QR</th>
                    <th>ลิงก์</th>
                    <th>ใช้ไปแล้ว</th>
                    <th>อายุ</th>
                    <th>สถานะ</th>
                    <th aria-label="การจัดการ" />
                  </tr>
                </thead>
                <tbody>
                  {data.links.map((link) => (
                    <tr key={link.id} className={link.gone ? 'join-link-gone' : undefined}>
                      <td>
                        <button
                          type="button"
                          className="join-link-qr"
                          onClick={() => showQr(link.label || 'ลิงก์เชิญเข้าร่วม', link.qr, link.url)}
                          aria-label="ดู QR ขนาดใหญ่"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={link.qr} alt="" width={56} height={56} />
                        </button>
                      </td>
                      <td>
                        <strong>{link.label || 'ลิงก์เชิญ'}</strong>
                        <span className="tiny muted join-link-url">{link.url}</span>
                        <span className="tiny muted">สร้างเมื่อ {date(link.created_at, true)}</span>
                      </td>
                      <td>
                        {link.uses}
                        {link.max_uses ? ` / ${link.max_uses}` : ''} คน
                      </td>
                      <td>{link.expires_at ? date(link.expires_at, true) : 'ไม่มีวันหมดอายุ'}</td>
                      <td>
                        <span className={`badge ${link.gone ? 'cancelled' : 'resolved'}`}>{link.gone || 'ใช้งานได้'}</span>
                      </td>
                      <td className="join-link-actions">
                        <button type="button" className="btn sm subtle" onClick={() => void copyText(link.url)}>
                          <Icon name="link" />
                          คัดลอก
                        </button>
                        {!link.revoked_at && (
                          <button
                            type="button"
                            className="btn sm danger"
                            onClick={() =>
                              confirm({
                                title: 'ยกเลิกลิงก์เชิญ',
                                message: `ยกเลิก “${link.label || 'ลิงก์เชิญ'}”? ลิงก์และ QR ที่แจกไปแล้วจะใช้ไม่ได้ทันที คนที่เข้าร่วมแล้วยังอยู่เหมือนเดิม`,
                                confirmLabel: 'ยกเลิกลิงก์',
                                cancelLabel: 'เก็บไว้',
                                tone: 'danger',
                                run: () =>
                                  run(async () => {
                                    await revokeJoinLink(link.id);
                                    toast('ยกเลิกลิงก์แล้ว');
                                    await refresh(ORG_LINKS_PATH);
                                  }),
                              })
                            }
                          >
                            ยกเลิก
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
