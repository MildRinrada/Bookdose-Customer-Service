'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { useCopyText } from '@/components/ui/actions';
import { useDialogs } from '@/components/ui/Dialogs';
import { Badge, ErrorState, PageLoading } from '@/components/ui/display';
import { OrgLogo } from '@/components/ui/OrgLogo';
import { useToast } from '@/components/ui/Toast';
import { download } from '@/lib/api/client';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { customerHomeUrl } from '@/lib/routes';
import { useBoot, useSwitchTenant, useWorkspace } from '@/lib/session';
import { bytesText } from './labels';
import { closeTenant, HEALTH_PATH, PLATFORM_PREFIX, setTenantStatus, tenantExportPath, TENANTS_PATH, withdrawSupportAccess } from './api';
import { QuotaForm } from './components/HealthCards';
import { StaffSecurityList, SupportAccessForm, SuspendTenantForm, TenantAdminForm } from './components/TenantForms';
import { FeatureForm, SlugForm, tenantAccess } from './OrganizationsScreen';
import type { OrgUsage, SupportSummary, Tenant, TenantsPage } from './types';

/* Platform console, one organization: everything about it on its own page.

   All of this used to be columns of the list - a switch behind a two-character button, a code behind a pencil, a
   quota on another screen entirely. A list is for finding an organization among a hundred; it is not a place to
   configure one, because every setting has to fit in a cell and a setting that fits in a cell is a setting nobody
   finds. So the list stays a list and the settings live here, each with room to say what it does.

   The order is how often it is needed: what the organization is, then the switches, the disk it is allowed, the code
   its customers reach it by, who runs it, and last the two that end things - support access and suspending.

   It reads the same two answers the console already has (the organizations and the usage figures), so opening this
   page asks the server for nothing new. Markup: pages/platform (org-page). */

/** One fact about the organization: its name, what it is now, a word of context, and the button that changes it. */
function Row({ label, hint, action, children }: { label: string; hint?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="org-row">
      <div className="org-row-text">
        <span className="org-row-label">{label}</span>
        {children && <div className="org-row-body">{children}</div>}
        {hint && <span className="tiny muted">{hint}</span>}
      </div>
      {action && <div className="org-row-action">{action}</div>}
    </div>
  );
}

export function OrganizationScreen({ id }: { id: string }) {
  const tenants = useApi<TenantsPage>(TENANTS_PATH);
  const health = useApi<{ usage: OrgUsage[] }>(HEALTH_PATH);
  if (tenants.error) return <ErrorState error={tenants.error} onRetry={() => void tenants.refetch()} />;
  if (!tenants.data) return <PageLoading />;
  const tenant = tenants.data.tenants.find((t) => t.id === id);
  if (!tenant)
    return (
      <ErrorState
        error={new Error('ไม่พบองค์กรนี้ · อาจถูกลบไปแล้ว หรือลิงก์ไม่ถูกต้อง')}
        onRetry={() => void tenants.refetch()}
      />
    );
  return (
    <OrganizationView
      tenant={tenant}
      page={tenants.data}
      usage={health.data?.usage.find((u) => u.id === id)}
      support={tenants.data.support?.[id]}
    />
  );
}

function OrganizationView({
  tenant: t,
  page,
  usage,
  support,
}: {
  tenant: Tenant;
  page: TenantsPage;
  usage?: OrgUsage;
  support?: SupportSummary;
}) {
  const boot = useBoot().data!;
  const { data: work } = useWorkspace();
  const copyText = useCopyText();
  const { openModal, confirm, confirmDelete } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const router = useRouter();
  const switchTenant = useSwitchTenant();
  const url = customerHomeUrl(t.slug, boot.home?.slug);
  const access = tenantAccess(t, boot, Boolean(work), support);
  const isHome = t.slug === boot.home?.slug;
  // Closing for good needs an export from the last 30 days (backend platform/closing.py EXPORT_DAYS).
  const [openedAt] = useState(() => Date.now());
  const exportedRecently = Boolean(t.exported_at) && openedAt - Date.parse(t.exported_at ?? '') <= 30 * 86_400_000;

  return (
    <>
      <div className="page-heading org-page-heading">
        <div className="org-page-title">
          <OrgLogo slug={t.slug} name={t.name} index={0} hasLogo={t.has_logo} />
          <div>
            <h1>{t.name}</h1>
            <p>
              <Badge status={t.status} /> · สร้างเมื่อ {date(t.created_at)} · {t.member_count} สมาชิก
            </p>
          </div>
        </div>
        <div className="flex">
          <Link className="btn subtle" href="/platform/organizations">
            <Icon name="back" />
            กลับไปรายการองค์กร
          </Link>
        </div>
      </div>

      <div className="org-page">
        <div className="org-column">
          {/* The facts about the organization, one row each: what it is on the left, the one thing to do about it on the right. */}
          <section className="card">
            <div className="card-header">
              <div>
                <h2>ข้อมูลองค์กร</h2>
                <p>ลิงก์ รหัส พื้นที่ และผู้ดูแลขององค์กรนี้</p>
              </div>
            </div>
            <Row
              label="หน้าลูกค้า"
              hint="ลิงก์ที่ลูกค้าขององค์กรนี้ใช้เข้าหน้าช่วยเหลือ"
              action={
                <button type="button" className="btn sm" onClick={() => void copyText(url)}>
                  <Icon name="link" />
                  คัดลอกลิงก์
                </button>
              }
            >
              <a className="org-page-link" href={url} target="_blank" rel="noopener">
                {url}
              </a>
            </Row>
            <Row
              label="รหัสองค์กร"
              hint={
                t.former_slugs?.length > 0
                  ? `รหัสเดิมที่ยังใช้ได้: ${t.former_slugs.join(', ')}`
                  : 'อยู่ในลิงก์ที่ลูกค้าได้รับไปแล้วทั้งหมด เปลี่ยนได้ ลิงก์เดิมยังพามาที่นี่'
              }
              action={
                <button type="button" className="btn sm" onClick={() => openModal(`รหัสองค์กรของ ${t.name}`, <SlugForm tenant={t} />)}>
                  <Icon name="edit" />
                  เปลี่ยนรหัส
                </button>
              }
            >
              <span className="org-page-figure mono">{t.slug}</span>
            </Row>
            <Row
              label="พื้นที่ดิสก์"
              hint={
                usage
                  ? `ไฟล์แนบ ${bytesText(usage.storage_bytes)} · ฐานข้อมูล ${bytesText(usage.database_bytes)}${usage.quota_mb ? '' : ' · ไม่มีโควตา ใช้ดิสก์ได้ไม่จำกัด และทำให้ทุกองค์กรเขียนข้อมูลไม่ได้เมื่อดิสก์เต็ม'}`
                  : undefined
              }
              action={
                usage && (
                  <button type="button" className="btn sm" onClick={() => openModal(`โควตาพื้นที่ของ ${t.name}`, <QuotaForm org={usage} />)}>
                    <Icon name="settings" />
                    {usage.quota_mb ? 'เปลี่ยนโควตา' : 'กำหนดโควตา'}
                  </button>
                )
              }
            >
              {usage ? (
                <span className="org-page-figure">
                  {bytesText(usage.used_bytes)}
                  <span className="muted"> / {usage.quota_mb ? `${usage.quota_mb >= 1024 ? `${Math.round(usage.quota_mb / 1024)} GB` : `${usage.quota_mb} MB`}` : 'ยังไม่ได้กำหนด'}</span>
                </span>
              ) : (
                <span className="tiny muted">กำลังอ่านตัวเลขการใช้งาน…</span>
              )}
            </Row>
            <Row
              label="ผู้ดูแลองค์กร"
              action={
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => openModal(`ผู้ดูแลองค์กร ${t.name}`, <TenantAdminForm id={t.id} name={t.name} canInvite={page.can_invite} />)}
                >
                  <Icon name="plus" />
                  {t.admins.length ? 'เพิ่มผู้ดูแล' : 'เชิญผู้ดูแล'}
                </button>
              }
            >
              <span className="org-page-admins">
                {t.admins.map((a) => (
                  <span key={a.email} className="org-admin" title={a.email}>
                    {a.name}
                  </span>
                ))}
                {t.admin_invites.map((email) => (
                  <span key={email} className="org-admin muted" title="ส่งคำเชิญแล้ว ยังไม่ตอบรับ">
                    <Icon name="clock" />
                    {email}
                  </span>
                ))}
                {!t.admins.length && !t.admin_invites.length && <span className="org-admin-missing">ยังไม่มีผู้ดูแล</span>}
              </span>
            </Row>
          </section>

          {/* The thing this page exists for: a switch that says what it does, not a count in a table cell. */}
          <section className="card">
            <div className="card-header">
              <div>
                <h2>ฟีเจอร์ของ {t.name}</h2>
              </div>
            </div>
            <div className="card-body">
              <FeatureForm tenant={t} catalogue={page.feature_catalogue ?? []} />
            </div>
          </section>
        </div>

        <div className="org-column">
          <section className="card">
            <div className="card-header">
              <div>
                <h2>ทีมงานและการเข้าถึง</h2>
              </div>
            </div>
            <Row
              label="สิทธิ์เข้าช่วยเหลือ"
              hint="เคสและบทสนทนาเป็นข้อมูลขององค์กร ดูได้เฉพาะเมื่อองค์กรอนุมัติ และดูได้อย่างเดียว"
              action={
                'pending' in access ? (
                  <button type="button" className="btn sm subtle" onClick={() => void withdraw(access.pending, false)}>
                    ยกเลิกคำขอ
                  </button>
                ) : 'canOpen' in access ? (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => switchTenant(t.id).catch((error: unknown) => toast(error instanceof Error ? error.message : String(error), true))}
                  >
                    <Icon name="arrow" />
                    ดูแบบอ่านอย่างเดียว
                  </button>
                ) : 'noAccess' in access && access.canRequest ? (
                  <button type="button" className="btn sm" onClick={() => openModal('ขอสิทธิ์ Support Access', <SupportAccessForm id={t.id} name={t.name} />)}>
                    <Icon name="shield" />
                    ขอเข้าช่วยเหลือ
                  </button>
                ) : null
              }
            >
              {'current' in access && (
                <span className="org-access">
                  <Icon name="check" />
                  กำลังดูอยู่ (อ่านอย่างเดียว)
                </span>
              )}
              {'pending' in access && (
                <span className="org-access org-support-pending">
                  <Icon name="clock" />
                  รอผู้ดูแลองค์กรอนุมัติ · ขอ {access.pending.hours} ชม.
                </span>
              )}
              {'canOpen' in access && <span className="org-access">ได้รับอนุมัติแล้ว</span>}
              {'noAccess' in access && (
                <span className="org-access muted">
                  <Icon name="lock" />
                  {access.canRequest ? 'ยังไม่มีสิทธิ์' : access.noAccess}
                </span>
              )}
            </Row>
            <Row
              label="การยืนยันสองขั้นตอนของทีมงาน"
              hint="รีเซ็ตให้ทีมงานที่ทำโทรศัพท์และรหัสสำรองหาย โดยไม่ต้องเข้าเซิร์ฟเวอร์"
              action={
                <button type="button" className="btn sm" onClick={() => openModal(`การยืนยันสองขั้นตอนของทีมงาน ${t.name}`, <StaffSecurityList id={t.id} />)}>
                  <Icon name="shield" />
                  ดูและรีเซ็ต
                </button>
              }
            />
          </section>

          <section className="card">
            <div className="card-header">
              <div>
                <h2>ระงับและปิดองค์กร</h2>
              </div>
            </div>
            <Row
              label="สถานะ"
              hint={
                isHome && t.status === 'active'
                  ? 'องค์กรหลัก ลูกค้าทุกคนสมัครและเข้าสู่ระบบผ่านองค์กรนี้ จึงระงับไม่ได้'
                  : t.status === 'active'
                    ? 'ระงับแล้วทีมงานและลูกค้าใช้งานไม่ได้จนกว่าจะเปิดอีกครั้ง'
                    : 'ทีมงานเข้าพื้นที่ทำงานไม่ได้ และหน้าลูกค้าปิด'
              }
              action={
                isHome ? null : t.status === 'active' ? (
                  <button type="button" className="btn sm org-suspend" onClick={() => openModal(`ระงับองค์กร ${t.name}`, <SuspendTenantForm id={t.id} name={t.name} />)}>
                    <Icon name="lock" />
                    ระงับองค์กร
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() =>
                      confirm({
                        title: `เปิดใช้งาน ${t.name} อีกครั้ง`,
                        message: 'ทีมงานกลับเข้าพื้นที่ทำงานได้ หน้าลูกค้าและช่องทาง LINE / Facebook กลับมารับเรื่องทันที',
                        cancelLabel: 'ยกเลิก',
                        confirmLabel: 'เปิดใช้งาน',
                        run: async () => {
                          await setTenantStatus(t.id, 'active');
                          toast(`เปิดใช้งาน ${t.name} แล้ว`);
                          await refresh(PLATFORM_PREFIX, '/api/bootstrap');
                        },
                      })
                    }
                  >
                    <Icon name="restore" />
                    เปิดใช้งานอีกครั้ง
                  </button>
                )
              }
            >
              <Badge status={t.status} />
            </Row>
            {!isHome && (
              <Row
                label="ปิดองค์กรถาวร"
                hint={
                  t.status !== 'suspended'
                    ? 'ระงับองค์กรก่อน จึงส่งออกข้อมูลและปิดถาวรได้'
                    : t.exported_at && !exportedRecently
                      ? 'ไฟล์ส่งออกเก่ากว่า 30 วัน ส่งออกใหม่ก่อนปิดถาวร'
                      : 'ลบข้อมูลทั้งหมดจริงตาม PDPA และคืนพื้นที่ดิสก์ ย้อนกลับไม่ได้'
                }
                action={
                  t.status === 'suspended' && (
                    <>
                      <button type="button" className="btn sm" onClick={() => void exportAll()}>
                        <Icon name="download" />
                        {t.exported_at ? 'ส่งออกอีกครั้ง' : 'ส่งออกข้อมูล'}
                      </button>
                      {exportedRecently && (
                        <button type="button" className="btn sm danger" onClick={closeForGood}>
                          <Icon name="close" />
                          ปิดถาวร
                        </button>
                      )}
                    </>
                  )
                }
              >
                {t.status === 'suspended' && (
                  <span className="tiny">
                    {t.exported_at ? `ส่งออกข้อมูลล่าสุด ${date(t.exported_at, true)}` : 'ขั้นแรก ส่งออกข้อมูลทั้งองค์กรเป็นไฟล์เดียว แล้วส่งให้เจ้าขององค์กรเก็บไว้'}
                  </span>
                )}
              </Row>
            )}
          </section>
        </div>
      </div>
    </>
  );

  async function exportAll() {
    try {
      await download(tenantExportPath(t.id), `${t.slug}.zip`);
      toast('ส่งออกแล้ว · ส่งไฟล์นี้ให้เจ้าขององค์กรก่อนปิดถาวร');
      await refresh(PLATFORM_PREFIX);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    }
  }

  function closeForGood() {
    confirmDelete({
      title: `ปิด ${t.name} ถาวร`,
      warning: 'ข้อมูลทั้งหมดขององค์กรนี้จะถูกลบจริงและกู้คืนจากหน้านี้ไม่ได้ ตรวจว่าเจ้าขององค์กรได้รับไฟล์ที่ส่งออกแล้ว',
      effects: [
        'เคส บทสนทนา ลูกค้า คลังความรู้ ไฟล์แนบ และการตั้งค่าทั้งหมดขององค์กร',
        'Token ของ LINE อีเมล Facebook และคีย์ AI ขององค์กร',
        'บัญชีทีมงานที่ไม่ได้อยู่องค์กรอื่น ส่วนบัญชีลูกค้ายังอยู่ เพราะเป็นของลูกค้าเอง',
        `รหัส ${t.slug} ยังถูกจองไว้ ลิงก์เดิมของลูกค้าจะไม่พาไปองค์กรอื่น`,
        'ไฟล์สำรองทั้งแพลตฟอร์มที่ทำไว้ก่อนหน้ายังมีข้อมูลนี้ จนกว่าจะถูกลบตามรอบ',
      ],
      word: t.slug,
      confirmLabel: 'ปิดถาวร',
      run: async () => {
        await closeTenant(t.id, t.slug);
        toast(`ปิด ${t.name} ถาวรแล้ว`);
        router.push('/platform/organizations');
        await refresh(PLATFORM_PREFIX, '/api/bootstrap');
      },
    });
  }

  function withdraw(summary: SupportSummary, leaving: boolean) {
    confirm({
      title: leaving ? 'ออกจากองค์กรก่อนเวลา' : 'ยกเลิกคำขอ',
      message: leaving ? `สิทธิ์เข้าช่วยเหลือ ${t.name} จะสิ้นสุดทันที` : `คำขอเข้าช่วยเหลือ ${t.name} จะถูกยกเลิก`,
      confirmLabel: leaving ? 'ออกจากองค์กร' : 'ยกเลิกคำขอ',
      tone: 'danger',
      run: async () => {
        await withdrawSupportAccess(summary.id);
        toast(leaving ? 'ออกจากองค์กรแล้ว' : 'ยกเลิกคำขอแล้ว');
        await refresh(PLATFORM_PREFIX, '/api/bootstrap');
      },
    });
  }
}
