'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { useCopyText } from '@/components/ui/actions';
import { useDialogs } from '@/components/ui/Dialogs';
import { Badge, ErrorState, PageLoading } from '@/components/ui/display';
import { OrgLogo } from '@/components/ui/OrgLogo';
import { useToast } from '@/components/ui/Toast';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { customerHomeUrl } from '@/lib/routes';
import { useBoot, useSwitchTenant, useWorkspace } from '@/lib/session';
import { bytesText } from './labels';
import { HEALTH_PATH, PLATFORM_PREFIX, setTenantStatus, TENANTS_PATH, withdrawSupportAccess } from './api';
import { QuotaForm } from './components/HealthCards';
import { SupportAccessForm, SuspendTenantForm, TenantAdminForm } from './components/TenantForms';
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
  const { openModal, confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const switchTenant = useSwitchTenant();
  const url = customerHomeUrl(t.slug, boot.home?.slug);
  const access = tenantAccess(t, boot, Boolean(work), support);
  const isHome = t.slug === boot.home?.slug;

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
        <section className="card info-block">
          <h2>หน้าลูกค้า</h2>
          <p className="tiny muted">ลิงก์ที่ลูกค้าขององค์กรนี้ใช้เข้าหน้าช่วยเหลือ</p>
          <p className="org-page-link">
            <a href={url} target="_blank" rel="noopener">
              {url}
            </a>
            <button type="button" className="icon-btn sm" aria-label="คัดลอกลิงก์หน้าลูกค้า" title="คัดลอกลิงก์" onClick={() => void copyText(url)}>
              <Icon name="link" />
            </button>
          </p>
        </section>

        {/* The thing this page exists for: a switch that says what it does, not a count in a table cell. */}
        <section className="card info-block org-page-wide">
          <h2>ฟีเจอร์ของ {t.name}</h2>
          <FeatureForm tenant={t} catalogue={page.feature_catalogue ?? []} />
        </section>

        <section className="card info-block">
          <h2>พื้นที่ดิสก์</h2>
          {usage ? (
            <>
              <p className="org-page-figure">
                {bytesText(usage.used_bytes)}
                <span className="muted"> / {usage.quota_mb ? `${usage.quota_mb >= 1024 ? `${Math.round(usage.quota_mb / 1024)} GB` : `${usage.quota_mb} MB`}` : 'ยังไม่ได้กำหนด'}</span>
              </p>
              <p className="tiny muted">
                ไฟล์แนบ {bytesText(usage.storage_bytes)} · ฐานข้อมูล {bytesText(usage.database_bytes)}
                {!usage.quota_mb && ' · องค์กรที่ไม่มีโควตาใช้ดิสก์ได้ไม่จำกัด และทำให้ทุกองค์กรเขียนข้อมูลไม่ได้เมื่อดิสก์เต็ม'}
              </p>
              <button type="button" className="btn sm" onClick={() => openModal(`โควตาพื้นที่ของ ${t.name}`, <QuotaForm org={usage} />)}>
                <Icon name="settings" />
                {usage.quota_mb ? 'เปลี่ยนโควตา' : 'กำหนดโควตา'}
              </button>
            </>
          ) : (
            <p className="tiny muted">กำลังอ่านตัวเลขการใช้งาน…</p>
          )}
        </section>

        <section className="card info-block">
          <h2>รหัสองค์กร</h2>
          <p className="tiny muted">รหัสนี้อยู่ในลิงก์ที่ลูกค้าได้รับไปแล้วทั้งหมด · เปลี่ยนได้ ลิงก์เดิมยังพามาที่นี่</p>
          <p className="org-page-figure mono">{t.slug}</p>
          {t.former_slugs?.length > 0 && <p className="tiny muted">รหัสเดิมที่ยังใช้ได้: {t.former_slugs.join(', ')}</p>}
          <button type="button" className="btn sm" onClick={() => openModal(`รหัสองค์กรของ ${t.name}`, <SlugForm tenant={t} />)}>
            <Icon name="edit" />
            เปลี่ยนรหัสองค์กร
          </button>
        </section>

        <section className="card info-block">
          <h2>ผู้ดูแลองค์กร</h2>
          <div className="org-page-admins">
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
          </div>
          <button
            type="button"
            className="btn sm"
            onClick={() => openModal(`ผู้ดูแลองค์กร ${t.name}`, <TenantAdminForm id={t.id} name={t.name} canInvite={page.can_invite} />)}
          >
            <Icon name="plus" />
            {t.admins.length ? 'เพิ่มผู้ดูแล' : 'เชิญผู้ดูแล'}
          </button>
        </section>

        <section className="card info-block">
          <h2>สิทธิ์เข้าช่วยเหลือ</h2>
          <p className="tiny muted">เคสและบทสนทนาเป็นข้อมูลขององค์กร ดูได้เฉพาะเมื่อองค์กรอนุมัติ และดูได้อย่างเดียว</p>
          {'current' in access && (
            <p className="org-access">
              <Icon name="check" />
              กำลังดูอยู่ (อ่านอย่างเดียว)
            </p>
          )}
          {'pending' in access && (
            <>
              <p className="org-access org-support-pending">
                <Icon name="clock" />
                รอผู้ดูแลองค์กรอนุมัติ · ขอ {access.pending.hours} ชม.
              </p>
              <button type="button" className="btn sm subtle" onClick={() => void withdraw(access.pending, false)}>
                ยกเลิกคำขอ
              </button>
            </>
          )}
          {'canOpen' in access && (
            <button
              type="button"
              className="btn sm"
              onClick={() => switchTenant(t.id).catch((error: unknown) => toast(error instanceof Error ? error.message : String(error), true))}
            >
              <Icon name="arrow" />
              ดูแบบอ่านอย่างเดียว
            </button>
          )}
          {'noAccess' in access &&
            (access.canRequest ? (
              <button type="button" className="btn sm" onClick={() => openModal('ขอสิทธิ์ Support Access', <SupportAccessForm id={t.id} name={t.name} />)}>
                <Icon name="shield" />
                ขอเข้าช่วยเหลือ
              </button>
            ) : (
              <p className="org-access muted">
                <Icon name="lock" />
                {access.noAccess}
              </p>
            ))}
        </section>

        <section className="card info-block">
          <h2>สถานะองค์กร</h2>
          {isHome && t.status === 'active' ? (
            <p className="org-access muted">
              <Icon name="globe" />
              องค์กรหลัก · ลูกค้าทุกคนสมัครและเข้าสู่ระบบผ่านองค์กรนี้ จึงระงับไม่ได้
            </p>
          ) : t.status === 'active' ? (
            <>
              <p className="tiny muted">ระงับแล้วทีมงานและลูกค้าใช้งานไม่ได้จนกว่าจะเปิดอีกครั้ง</p>
              <button type="button" className="btn sm org-suspend" onClick={() => openModal(`ระงับองค์กร ${t.name}`, <SuspendTenantForm id={t.id} name={t.name} />)}>
                <Icon name="lock" />
                ระงับองค์กร
              </button>
            </>
          ) : (
            <>
              <p className="tiny muted">องค์กรนี้ถูกระงับอยู่ · ทีมงานเข้าพื้นที่ทำงานไม่ได้ และหน้าลูกค้าปิด</p>
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
            </>
          )}
        </section>
      </div>
    </>
  );

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
