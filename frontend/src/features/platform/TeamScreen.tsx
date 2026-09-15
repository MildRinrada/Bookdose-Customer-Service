'use client';

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

/* Platform console, ทีมผู้ดูแลระบบ: who may use the console. Bookdose works in two roles - the platform team runs
   the server and the organizations (this list), and the people who answer Bookdose's own customers are members of
   the Bookdose organization, managed in its settings like any other organization's team.
   Markup: pages/platform/platform-team.html, platform-admin-row.html, platform-admin-form.html. */

export function TeamScreen() {
  const team = useApi<PlatformTeam>(ADMINS_PATH);
  if (team.isPending) return <PageLoading />;
  if (team.error) return <ErrorState error={team.error} onRetry={() => void team.refetch()} />;
  return <TeamView data={team.data} />;
}

function TeamView({ data }: { data: PlatformTeam }) {
  const { openModal, confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>ทีมผู้ดูแลระบบ</h1>
          <p>บัญชีที่เข้าคอนโซลระบบกลางได้ · {data.admins.length} คน</p>
        </div>
        <div className="flex">
          <button type="button" className="btn primary" onClick={() => openModal('เพิ่มผู้ดูแลระบบกลาง', <PlatformAdminForm />)}>
            <Icon name="plus" />
            เพิ่มผู้ดูแลระบบกลาง
          </button>
        </div>
      </div>
      <div className="role-split">
        <section className="card role-card">
          <div className="card-body">
            <span className="role-icon">
              <Icon name="shield" />
            </span>
            <div>
              <h2>ทีมจัดการระบบ (หน้านี้)</h2>
              <p>ดูแลเซิร์ฟเวอร์ องค์กรลูกค้า และ FAQ กลาง เข้าคอนโซลระบบกลางได้ แต่ไม่ได้สิทธิ์อ่านเคสขององค์กรโดยอัตโนมัติ ต้องขอ Support Access ก่อนทุกครั้ง</p>
            </div>
          </div>
        </section>
        <section className="card role-card">
          <div className="card-body">
            <span className="role-icon">
              <Icon name="chat" />
            </span>
            <div>
              <h2>ทีมติดต่อลูกค้า Bookdose</h2>
              <p>
                เป็นสมาชิกขององค์กร Bookdose เหมือนองค์กรอื่น ใช้บทบาทผู้ดูแลองค์กร หัวหน้าทีม หรือเจ้าหน้าที่ เพิ่มหรือเปลี่ยนได้ที่ ตั้งค่าองค์กร → ทีมและสมาชิก
                ในพื้นที่ทำงาน Bookdose
              </p>
            </div>
          </div>
        </section>
      </div>
      <section className="card">
        <div className="card-header">
          <div>
            <h2>ผู้ดูแลระบบกลาง</h2>
            <p>ถอดสิทธิ์ของตัวเองไม่ได้ ต้องให้ผู้ดูแลคนอื่นทำ ระบบจึงมีผู้ดูแลอย่างน้อยหนึ่งคนเสมอ</p>
          </div>
          <Icon name="shield" />
        </div>
        <div className="table-scroll">
          <table>
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
                          <strong className="truncate">{a.name}</strong>
                          {me && <span className="muted">บัญชีของคุณ</span>}
                        </div>
                      </div>
                    </td>
                    <td>{a.email}</td>
                    <td>{date(a.created_at)}</td>
                    <td>
                      {!me && (
                        <button
                          type="button"
                          className="btn sm subtle"
                          onClick={() =>
                            confirm({
                              title: 'ถอดสิทธิ์ผู้ดูแลระบบกลาง',
                              message: `${a.name} จะเข้าคอนโซลระบบกลางไม่ได้ตั้งแต่คำขอถัดไป งานในองค์กรที่เป็นสมาชิกอยู่ยังทำได้ตามเดิม`,
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
      <div className="notice">
        ใช้อีเมลของบัญชีที่มีอยู่แล้ว (เช่น คนในทีม Bookdose) หรืออีเมลใหม่พร้อมชื่อและรหัสผ่านเริ่มต้น ผู้ดูแลระบบกลางไม่ได้สิทธิ์อ่านเคสขององค์กรใดโดยอัตโนมัติ
      </div>
      <TextField label="อีเมล" name="email" type="email" max={254} />
      <div className="form-grid">
        <TextField label="ชื่อ (กรอกเมื่อยังไม่มีบัญชี)" name="admin_name" required={false} max={100} />
        <TextField label="รหัสผ่านเริ่มต้น (กรอกเมื่อยังไม่มีบัญชี)" name="password" type="password" required={false} max={200} />
      </div>
      <FormActions label="เพิ่มผู้ดูแล" onCancel={() => closeModal()} />
    </Form>
  );
}
