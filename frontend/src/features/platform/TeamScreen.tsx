'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { Avatar, ErrorState, PageLoading } from '@/components/ui/display';
import { FormActions, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { addPlatformAdmin, ADMINS_PATH, PLATFORM_PREFIX, removePlatformAdmin } from './api';
import type { PlatformTeam } from './types';

/* Platform console, ทีมผู้ดูแลระบบ: who may use the console.

   The people come first. This page used to open with two paragraphs explaining the difference between this team and
   the one that answers Bookdose's own customers - six lines of prose before a list of three names. The distinction
   still matters and is still here, but as short lines at the foot of the page, where somebody who needs it will
   look, rather than as a wall in front of what everybody came for.

   The platform's owner (the account made at first-run setup) adds and removes the platform admins; the admins look
   after the server and the organizations like the owner, but the list is read-only for them.
   Markup: pages/platform.css (role-note). */

export function TeamScreen() {
  const team = useApi<PlatformTeam>(ADMINS_PATH);
  if (team.isPending) return <PageLoading />;
  if (team.error) return <ErrorState error={team.error} onRetry={() => void team.refetch()} />;
  return <TeamView data={team.data} />;
}

function TeamView({ data }: { data: PlatformTeam }) {
  const { openModal, confirm } = useDialogs();
  const owner = data.admins.some((a) => a.owner && a.id === data.me);
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <>
      <Link href="/platform/settings" className="back-link">
        <Icon name="back" />
        ตั้งค่าระบบ
      </Link>
      <div className="page-heading">
        <div>
          <h1>ทีมผู้ดูแลระบบ</h1>
          <p>{data.admins.length} บัญชี</p>
        </div>
        {owner && (
          <div className="flex">
            <button type="button" className="btn primary" onClick={() => openModal('เพิ่มผู้ดูแลระบบกลาง', <PlatformAdminForm />)}>
              <Icon name="plus" />
              เพิ่มผู้ดูแลระบบกลาง
            </button>
          </div>
        )}
      </div>

      <section className="card">
        <div className="table-scroll admin-table">
          <table>
            <colgroup>
              <col className="col-person" />
              <col className="col-email" />
              <col className="col-since" />
              <col className="col-manage" />
            </colgroup>
            <thead>
              <tr>
                <th>ชื่อ</th>
                <th>อีเมล</th>
                <th>สร้างบัญชีเมื่อ</th>
                <th>
                  <span className="sr-only">จัดการ</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.admins.map((a, i) => {
                const me = a.id === data.me;
                return (
                  <tr key={a.id}>
                    <td>
                      <div className="org-cell">
                        <Avatar name={a.name} index={i} />
                        <div className="org-text">
                          <strong className="truncate" title={a.name}>
                            {a.name}
                          </strong>
                          {me && <span className="tiny muted">บัญชีของคุณ</span>}
                        </div>
                      </div>
                    </td>
                    <td className="truncate" title={a.email}>
                      {a.email}
                    </td>
                    <td>{date(a.created_at)}</td>
                    <td className="admin-manage">
                      {/* The owner is the one account nobody can remove, so it says so instead of leaving a blank. */}
                      {a.owner ? (
                        <span className="admin-owner">
                          <Icon name="shield" />
                          เจ้าของแพลตฟอร์ม
                        </span>
                      ) : (
                        owner && (
                          <button
                            type="button"
                            className="btn sm subtle"
                            onClick={() =>
                              confirm({
                                title: 'ถอดสิทธิ์ผู้ดูแลระบบกลาง',
                                message: `${a.name} จะเข้าคอนโซลระบบกลางไม่ได้ตั้งแต่คำขอถัดไป`,
                                cancelLabel: 'ยกเลิก',
                                confirmLabel: 'ถอดสิทธิ์',
                                tone: 'danger',
                                run: async () => {
                                  await removePlatformAdmin(a.id);
                                  toast('ถอดสิทธิ์แล้ว');
                                  await refresh(PLATFORM_PREFIX);
                                },
                              })
                            }
                          >
                            <Icon name="close" />
                            ถอดสิทธิ์
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function PlatformAdminForm() {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      data-form="platform-admin"
      onSubmit={async (values) => {
        const body: { email: string; admin_name?: string; password?: string } = { email: values.email ?? '' };
        if (values.admin_name) body.admin_name = values.admin_name;
        if (values.password) body.password = values.password;
        await addPlatformAdmin(body);
        closeModal();
        toast('เพิ่มผู้ดูแลระบบกลางแล้ว');
        await refresh(PLATFORM_PREFIX);
      }}
    >
      <TextField label="อีเมล" name="email" type="email" max={254} />
      <div className="form-grid">
        <TextField label="ชื่อ (กรอกเมื่อยังไม่มีบัญชี)" name="admin_name" required={false} max={100} />
        <TextField label="รหัสผ่านเริ่มต้น (กรอกเมื่อยังไม่มีบัญชี)" name="password" type="password" required={false} max={200} />
      </div>
      <FormActions label="เพิ่มผู้ดูแล" onCancel={() => closeModal()} />
    </Form>
  );
}
