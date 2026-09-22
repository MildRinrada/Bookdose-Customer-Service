'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { Form } from '@/components/ui/Form';
import { Avatar, Badge, EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { FormActions, TextField } from '@/components/ui/fields';
import { FilterPill, SearchInput } from '@/components/ui/filters';
import { Pager, usePager } from '@/components/ui/Pager';
import { useToast } from '@/components/ui/Toast';
import { AuditList } from '@/features/audit';
import { useCopyText } from '@/components/ui/actions';
import { date } from '@/lib/format';
import { tenantStatusLabels } from '@/lib/labels';
import { useApi, useInvalidate } from '@/lib/query';
import { customerHomeUrl } from '@/lib/routes';
import { useBoot, useSwitchTenant, useWorkspace } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import type { Boot } from '@/lib/types';
import { PLATFORM_PREFIX, renameTenantSlug, setTenantFeature, setTenantStatus, TENANTS_PATH, withdrawSupportAccess } from './api';
import { SupportAccessForm, SuspendTenantForm, TenantAdminForm, TenantForm } from './components/TenantForms';
import type { FeatureInfo, SupportSummary, Tenant, TenantFilters, TenantsPage } from './types';

/* Platform console, จัดการองค์กร: every organization on this installation - who is running, how many people are
   inside, the link to its customer side, and suspending or reopening it. Two tabs: the list (search, pills and the
   pager every other screen uses) and the platform's own activity, paged too (?tab=activity). A link from ภาพรวมระบบ
   → ต้องจัดการ (?admin=<id>) opens that organization's "invite admin" dialog once. The sign-up email and SMS
   settings live on ตั้งค่าระบบ (/platform/settings). Markup: pages/platform/platform*.html. */

type OrgTab = 'list' | 'activity';

const BASE = '/platform/organizations';
const tabHref = (tab: OrgTab) => (tab === 'activity' ? `${BASE}?tab=activity` : BASE);
const tabOf = (tab?: string): OrgTab => (tab === 'activity' ? 'activity' : 'list');

export function OrganizationsScreen({ tab, admin }: { tab?: string; admin?: string }) {
  const tenants = useApi<TenantsPage>(TENANTS_PATH);
  if (tenants.data) return <OrganizationsView data={tenants.data} tab={tab} admin={admin} />;
  if (tenants.error) return <ErrorState error={tenants.error} onRetry={() => void tenants.refetch()} />;
  return <PageLoading />;
}

export type Access =
  | { current: true }
  | { canOpen: true }
  | { pending: SupportSummary }
  | { noAccess: string; canRequest: boolean };

/* Platform rights manage organizations, never their work: a platform admin sees an organization's cases only on a
   support access the organization approved (with an end time), and only to look. Each row says where you stand. */
export function tenantAccess(t: Tenant, boot: Boot, hasWorkspace: boolean, support: SupportSummary | undefined): Access {
  const membership = boot.memberships.find((m) => m.id === t.id);
  if (membership?.status === 'active' && t.status === 'active') return t.id === boot.tenant_id && hasWorkspace ? { current: true } : { canOpen: true };
  if (t.status !== 'active') return { noAccess: 'เปิดไม่ได้ขณะองค์กรถูกระงับ', canRequest: false };
  if (support?.status === 'pending') return { pending: support };
  return { noAccess: 'ยังไม่มีสิทธิ์', canRequest: true };
}

function OrganizationsView({ data, tab, admin }: { data: TenantsPage; tab?: string; admin?: string }) {
  const router = useRouter();
  const { openModal } = useDialogs();
  const [current, setCurrent] = useState<OrgTab>(tabOf(tab));
  // A link to ?tab=… while already here picks that tab.
  const [seenTab, setSeenTab] = useState(tab);
  if (tab !== seenTab) {
    setSeenTab(tab);
    setCurrent(tabOf(tab));
  }
  const select = (key: OrgTab) => {
    setCurrent(key);
    // Only the address changes; the screen is already showing the tab.
    window.history.replaceState(null, '', tabHref(key));
  };

  // ?admin=<id> (ภาพรวมระบบ → ต้องจัดการ → เชิญผู้ดูแล): the dialog opens once, then the address forgets it so a
  // reload does not open it again.
  const adminOpened = useRef(false);
  useEffect(() => {
    if (!admin || adminOpened.current) return;
    adminOpened.current = true;
    const t = data.tenants.find((x) => x.id === admin);
    if (t) openModal(`ผู้ดูแลองค์กร ${t.name}`, <TenantAdminForm id={t.id} name={t.name} canInvite={data.can_invite} />);
    router.replace(tabHref(tabOf(tab)), { scroll: false });
  }, [admin, tab, data.tenants, data.can_invite, openModal, router]);

  const audit = data.audit || [];
  const tabs: Array<[OrgTab, string, number]> = [
    ['list', 'รายชื่อองค์กร', data.tenants.length],
    ['activity', 'ประวัติกิจกรรม', audit.length],
  ];

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>จัดการองค์กร</h1>
          <p>
            {data.tenants.length} องค์กรบนระบบนี้ · สมาชิกที่ใช้งานรวม {data.tenants.reduce((total, t) => total + t.member_count, 0)} คน
          </p>
        </div>
        <div className="flex">
          <button type="button" className="btn primary" onClick={() => openModal('สร้างองค์กรใหม่', <TenantForm />)}>
            <Icon name="plus" />
            สร้างองค์กร
          </button>
        </div>
      </div>
      <div className="tabs platform-tabs" role="tablist" aria-label="จัดการองค์กร">
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            id={`org-tab-${key}`}
            className={`tab${current === key ? ' active' : ''}`}
            role="tab"
            aria-selected={current === key}
            aria-controls={`org-panel-${key}`}
            onClick={() => select(key)}
          >
            {label} <span>{count}</span>
          </button>
        ))}
      </div>
      <div id={`org-panel-${current}`} role="tabpanel" aria-labelledby={`org-tab-${current}`}>
        {current === 'list' ? <OrganizationsList data={data} /> : <PlatformActivity events={audit} />}
      </div>
    </>
  );
}

/** The platform's own activity (organizations, support access, the admin team, FAQ กลาง): the server sends the
    latest 100, shown a page at a time so the tab has an end. */
function PlatformActivity({ events }: { events: TenantsPage['audit'] }) {
  const slice = usePager('platform-activity', events, { size: 25 });
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>ประวัติแพลตฟอร์ม</h2>
          <p>การสร้างองค์กร Support Access ทีมผู้ดูแล และ FAQ กลาง · {events.length} รายการล่าสุด</p>
        </div>
        <Icon name="shield" />
      </div>
      <div className="card-body">
        <AuditList events={slice.shown} />
        {events.length > 0 && <Pager slice={slice} unit="กิจกรรม" sizes={[25, 50, 100]} />}
      </div>
    </section>
  );
}

function OrganizationsList({ data }: { data: TenantsPage }) {
  const withoutAdmin = data.tenants.filter((t) => t.status === 'active' && !t.admins.length);
  const [f, setFilters] = useUiState<TenantFilters>('platform:filters', {});
  const all = data.tenants;
  const term = (f.q || '').toLowerCase();
  const visible = all
    .filter((t) => (!f.status || t.status === f.status) && (!term || [t.name, t.slug].some((v) => String(v || '').toLowerCase().includes(term))))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const slice = usePager('platform', visible, { size: 25 });
  const counts = (status: string) => all.filter((t) => !status || t.status === status).length;
  // A new search or filter starts the list again from its first page.
  const update = (next: TenantFilters) => {
    setFilters(next);
    slice.setPage(1);
  };

  return (
    <>
      {withoutAdmin.length > 0 && (
        <p className="notice warning" role="status">
          {withoutAdmin.map((t) => t.name).join(', ')} ยังไม่มีผู้ดูแลองค์กร เรื่องจากลูกค้าจะรอโดยไม่มีใครรับ กด “เชิญผู้ดูแล” ในแถวขององค์กรนั้น
        </p>
      )}
      <section className="card">
        <div className="filters platform-filters">
          <SearchInput
            id="platform-search"
            label="ค้นหาองค์กร"
            placeholder="ค้นหาชื่อหรือรหัสองค์กร"
            value={f.q || ''}
            onChange={(q) => update({ ...f, q })}
          />
          <div className="filter-pills" role="group" aria-label="สถานะองค์กร">
            {[['', 'ทั้งหมด'], ...Object.entries(tenantStatusLabels)].map(([status, label]) => (
              <FilterPill
                key={status}
                value={status}
                label={label}
                pressed={(f.status || '') === status}
                count={counts(status)}
                warning={status === 'suspended'}
                onClick={(value) => update({ ...f, status: value })}
              />
            ))}
          </div>
        </div>
        <div id="platform-organizations">
          {visible.length ? (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>องค์กร</th>
                      <th>หน้าลูกค้า</th>
                      <th>ผู้ดูแลองค์กร</th>
                      <th>สมาชิก</th>
                      <th>ฟีเจอร์</th>
                      <th>สถานะ</th>
                      <th>สิทธิ์เข้าช่วยเหลือ</th>
                      <th>
                        <span className="sr-only">จัดการสถานะ</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {slice.shown.map((t, i) => (
                      <TenantRow
                        key={t.id}
                        tenant={t}
                        index={slice.start + i}
                        support={data.support?.[t.id]}
                        canInvite={data.can_invite}
                        catalogue={data.feature_catalogue ?? []}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card-body">
                <Pager slice={slice} unit="องค์กร" sizes={[25, 50, 100]} />
              </div>
            </>
          ) : (
            <div className="card-body">
              <EmptyState title="ไม่พบองค์กรตามตัวกรอง" description="ลองเปลี่ยนคำค้น หรือเลือกสถานะ “ทั้งหมด”" icon="globe" />
            </div>
          )}
        </div>
      </section>
      {/* The rule behind the "ขอเข้าช่วยเหลือ" column, under the list so the list comes first. */}
      <p className="muted platform-note">
        <Icon name="lock" />
        <span>
          ผู้ดูแลแพลตฟอร์มดูแลระบบเท่านั้น ไม่รับเคสและไม่ตอบลูกค้า แต่ละองค์กรมีผู้ดูแลองค์กรของตัวเอง (เชิญได้จากคอลัมน์ “ผู้ดูแลองค์กร”)
          เคสและบทสนทนาเป็นข้อมูลขององค์กร ดูได้เฉพาะเมื่อองค์กรอนุมัติสิทธิ์เข้าช่วยเหลือ และดูได้อย่างเดียว
        </span>
      </p>
    </>
  );
}

function TenantRow({
  tenant: t,
  index,
  support,
  canInvite,
  catalogue,
}: {
  tenant: Tenant;
  index: number;
  support?: SupportSummary;
  canInvite: boolean;
  catalogue: FeatureInfo[];
}) {
  const boot = useBoot().data!;
  const { data: work } = useWorkspace();
  const switchTenant = useSwitchTenant();
  const copyText = useCopyText();
  const toast = useToast();
  const { openModal, confirm } = useDialogs();
  const refresh = useInvalidate();
  const url = customerHomeUrl(t.slug, boot.home?.slug);
  const access = tenantAccess(t, boot, Boolean(work), support);
  const inForce = support?.status === 'approved' && support.expires_at ? support : null;
  const withdraw = (summary: SupportSummary, leaving: boolean) =>
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

  return (
    <tr className={t.status === 'active' ? '' : 'org-suspended'}>
      <td>
        <div className="org-cell">
          <Avatar name={t.name} index={index} />
          <div className="org-text">
            {/* The name is the way in: everything about one organization is on its own page, not in these cells. */}
            <Link className="truncate" href={`${BASE}/${t.id}`} title={`ตั้งค่า ${t.name}`}>
              <strong>{t.name}</strong>
            </Link>
            <span className="muted">สร้าง {date(t.created_at)}</span>
          </div>
        </div>
      </td>
      <td>
        <div className="org-portal">
          <a href={url} target="_blank" rel="noopener" title={`เปิดหน้าลูกค้าของ ${t.name} ในแท็บใหม่`}>
            {url.slice(window.location.origin.length)}
          </a>
          <button
            type="button"
            className="icon-btn sm"
            aria-label={`คัดลอกลิงก์หน้าลูกค้าของ ${t.name}`}
            title="คัดลอกลิงก์"
            onClick={() => void copyText(url)}
          >
            <Icon name="link" />
          </button>
          {/* The code is in every link this organization's customers were given; a typo at creation used to be for
              good. Changing it keeps the old code leading here, so nothing already sent out breaks. */}
          <button
            type="button"
            className="icon-btn sm"
            aria-label={`แก้ไขรหัสองค์กรของ ${t.name}`}
            title="แก้ไขรหัสองค์กร"
            onClick={() => openModal(`รหัสองค์กรของ ${t.name}`, <SlugForm tenant={t} />)}
          >
            <Icon name="edit" />
          </button>
        </div>
        {t.former_slugs?.length > 0 && (
          <span className="tiny muted org-former" title="รหัสเดิมที่ยังใช้เปิดหน้านี้ได้">
            เดิม: {t.former_slugs.join(', ')}
          </span>
        )}
      </td>
      <td className="org-admins">
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
        <button
          type="button"
          className="btn sm"
          onClick={() => openModal(`ผู้ดูแลองค์กร ${t.name}`, <TenantAdminForm id={t.id} name={t.name} canInvite={canInvite} />)}
        >
          <Icon name="plus" />
          {t.admins.length ? 'เพิ่มผู้ดูแล' : 'เชิญผู้ดูแล'}
        </button>
      </td>
      <td className="org-members">{t.member_count}</td>
      <td>
        <FeatureCell tenant={t} catalogue={catalogue} />
      </td>
      <td>
        <Badge status={t.status} />
      </td>
      <td>
        {'current' in access && (
          <span className="org-access">
            <Icon name="check" />
            กำลังดูอยู่ (อ่านอย่างเดียว)
          </span>
        )}
        {'pending' in access && (
          <span className="org-access org-support-pending">
            <Icon name="clock" />
            <span>รอผู้ดูแลองค์กรอนุมัติ · ขอ {access.pending.hours} ชม.</span>
            <button type="button" className="btn sm subtle" onClick={() => withdraw(access.pending, false)}>
              ยกเลิกคำขอ
            </button>
          </span>
        )}
        {inForce && 'canOpen' in access && (
          <span className="tiny muted org-support-until">
            Support ถึง {date(inForce.expires_at, true)} ·{' '}
            <button type="button" className="link-btn" onClick={() => withdraw(inForce, true)}>
              ออกก่อนเวลา
            </button>
          </span>
        )}
        {'canOpen' in access && (
          <button
            type="button"
            className="btn sm"
            title={`ดูข้อมูลของ ${t.name} แบบอ่านอย่างเดียว`}
            onClick={() => switchTenant(t.id).catch((error: unknown) => toast(error instanceof Error ? error.message : String(error), true))}
          >
            <Icon name="arrow" />
            ดูแบบอ่านอย่างเดียว
          </button>
        )}
        {'noAccess' in access &&
          (access.canRequest ? (
            <button
              type="button"
              className="btn sm"
              title="ส่งคำขอให้ผู้ดูแลองค์กรอนุมัติ พร้อมเหตุผลและระยะเวลา · เมื่ออนุมัติจะดูข้อมูลได้อย่างเดียว"
              onClick={() => openModal('ขอสิทธิ์ Support Access', <SupportAccessForm id={t.id} name={t.name} />)}
            >
              <Icon name="shield" />
              ขอเข้าช่วยเหลือ
            </button>
          ) : (
            <span className="org-access muted" title="ดูเคสและบทสนทนาได้เมื่อองค์กรอนุมัติสิทธิ์เข้าช่วยเหลือเท่านั้น">
              <Icon name="lock" />
              {access.noAccess}
            </span>
          ))}
      </td>
      <td className="org-status-action">
        {t.status === 'active' && t.slug === boot.home?.slug ? (
          // The platform's own organization: every customer signs up and signs in through it (the server refuses too).
          <span className="org-access muted" title="ลูกค้าทุกคนสมัครและเข้าสู่ระบบผ่านองค์กรนี้ จึงระงับไม่ได้">
            <Icon name="globe" />
            องค์กรหลัก
          </span>
        ) : t.status === 'active' ? (
          <button
            type="button"
            className="btn sm org-suspend"
            title={`ระงับ ${t.name}: ทีมงานและลูกค้าใช้งานไม่ได้จนกว่าจะเปิดอีกครั้ง`}
            onClick={() => openModal(`ระงับองค์กร ${t.name}`, <SuspendTenantForm id={t.id} name={t.name} />)}
          >
            <Icon name="lock" />
            ระงับ
          </button>
        ) : (
          <button
            type="button"
            className="btn sm"
            title={`เปิดใช้งาน ${t.name} อีกครั้ง`}
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
        )}
      </td>
    </tr>
  );
}

/* Which features this organization has, and the way to change them. Something new is added to the registry
   (backend platform/model.py FEATURES) switched off, turned on for one organization here, and only made everyone's
   default once it has been lived with. */
function FeatureCell({ tenant: t, catalogue }: { tenant: Tenant; catalogue: FeatureInfo[] }) {
  if (!catalogue.length) return <span className="muted">-</span>;
  const on = catalogue.filter((f) => t.features?.[f.key] ?? f.default).length;
  const off = catalogue.filter((f) => !(t.features?.[f.key] ?? f.default));
  return (
    <Link className="feature-cell" href={`${BASE}/${t.id}`} title={`เปิด ${on} จาก ${catalogue.length} ฟีเจอร์ · เปิดหน้าตั้งค่าของ ${t.name}`}>
      <Icon name="bolt" />
      {/* What is off is the news; a count on its own says nothing anybody acts on. */}
      {off.length ? <span className="feature-off">ปิด {off.map((f) => f.label).join(', ')}</span> : `ครบทั้ง ${catalogue.length}`}
    </Link>
  );
}

export function FeatureForm({ tenant: t, catalogue }: { tenant: Tenant; catalogue: FeatureInfo[] }) {
  const toast = useToast();
  const refresh = useInvalidate();
  // The switches answer one at a time: each is its own decision, and a half-saved form would be worse than none.
  const [busy, setBusy] = useState('');
  const [state, setState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(catalogue.map((f) => [f.key, t.features?.[f.key] ?? f.default])),
  );
  const flip = async (feature: FeatureInfo, next: boolean) => {
    setBusy(feature.key);
    try {
      const answer = await setTenantFeature(t.id, feature.key, next);
      setState((current) => ({ ...current, ...answer.features }));
      toast(`${next ? 'เปิด' : 'ปิด'} “${feature.label}” ให้ ${t.name} แล้ว`);
      await refresh(PLATFORM_PREFIX);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy('');
    }
  };
  return (
    <>
      <p className="notice">
        เปิดหรือปิดได้ทีละองค์กร ใช้ลองฟีเจอร์ใหม่กับบางองค์กรก่อนแล้วค่อยเปิดให้ทุกที่ · มีผลกับหน้าจอของทีมงานองค์กรนี้ตั้งแต่โหลดหน้าถัดไป
        องค์กรอื่นไม่เปลี่ยน
      </p>
      <div className="feature-list">
        {catalogue.map((f) => {
          const on = state[f.key];
          return (
            <label className="check feature-row" key={f.key}>
              <input type="checkbox" className="switch" checked={on} disabled={busy === f.key} onChange={(e) => void flip(f, e.target.checked)} />
              <span>
                {f.label}
                <span className="tiny muted block">{f.detail}</span>
                {on !== f.default && <span className="tiny muted block">ต่างจากค่าเริ่มต้น (ปกติ{f.default ? 'เปิด' : 'ปิด'})</span>}
              </span>
            </label>
          );
        })}
      </div>
    </>
  );
}

/* Correcting the code an organization is reached by. The code sits in the help-centre address, in every follow link
   already emailed or texted, and in the widget on the organization's own website, so the old one keeps leading here
   for good and is never handed to anyone else. What changes is the address given out from now on. */
export function SlugForm({ tenant: t }: { tenant: Tenant }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      data-form="tenant-slug"
      onSubmit={async (values) => {
        const answer = await renameTenantSlug(t.id, (values.slug ?? '').trim());
        closeModal();
        toast(`เปลี่ยนรหัสองค์กรของ ${t.name} เป็น ${answer.slug} แล้ว`);
        await refresh(PLATFORM_PREFIX, '/api/bootstrap');
      }}
    >
      <p className="notice">
        รหัสเดิม <strong>{t.slug}</strong> จะยังเปิดหน้าลูกค้าขององค์กรนี้ได้ตลอดไป ลิงก์ที่ส่งไปแล้วทางอีเมลหรือ SMS และวิดเจ็ตที่ฝังบนเว็บไซต์ขององค์กร
        จึงไม่พัง · รหัสที่เคยใช้จะไม่ถูกยกให้องค์กรอื่นเด็ดขาด
      </p>
      <TextField label="รหัสองค์กรใหม่" name="slug" defaultValue={t.slug} max={60} hint="a-z, 0-9 และขีดกลาง เช่น bookdose-support" />
      {t.former_slugs?.length > 0 && <p className="tiny muted">รหัสเดิมที่ยังใช้ได้อยู่: {t.former_slugs.join(', ')}</p>}
      <FormActions label="เปลี่ยนรหัสองค์กร" onCancel={() => closeModal()} />
    </Form>
  );
}
