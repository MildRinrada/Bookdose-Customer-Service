'use client';

import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { Avatar, Badge, EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { FilterPill, SearchInput } from '@/components/ui/filters';
import { Pager, usePager } from '@/components/ui/Pager';
import { useToast } from '@/components/ui/Toast';
import { AuditList } from '@/features/audit';
import { RegistrationSettingsPanel } from '@/features/auth/components/RegistrationSettingsPanel';
import type { RegistrationConfig } from '@/features/auth/types';
import { useCopyText } from '@/components/ui/actions';
import { date } from '@/lib/format';
import { tenantStatusLabels } from '@/lib/labels';
import { useApi } from '@/lib/query';
import { customerHomeUrl } from '@/lib/routes';
import { useBoot, useSwitchTenant, useWorkspace } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import type { Boot } from '@/lib/types';
import { REGISTRATION_PATH, TENANTS_PATH } from './api';
import { SupportAccessForm, TenantForm } from './components/TenantForms';
import type { Tenant, TenantFilters, TenantsPage } from './types';

/* Platform console, จัดการองค์กร: every organization on this installation - who is running, how many people are
   inside, and the link to its customer side. (Suspending is not offered on screen.) One list with the search, pills
   and pager every other screen uses, the platform's own activity underneath, then the sign-up email settings.
   Markup: pages/platform/platform*.html. */

export function OrganizationsScreen() {
  const tenants = useApi<TenantsPage>(TENANTS_PATH);
  const registration = useApi<RegistrationConfig>(REGISTRATION_PATH);
  const error = tenants.error ?? registration.error;
  if (tenants.data && registration.data)
    return (
      <>
        <OrganizationsView data={tenants.data} />
        <RegistrationSettingsPanel config={registration.data} />
      </>
    );
  if (error)
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void tenants.refetch();
          void registration.refetch();
        }}
      />
    );
  return <PageLoading />;
}

type Access =
  | { current: true }
  | { canOpen: true }
  | { noAccess: string; canRequest: boolean };

/* Platform rights manage organizations; reading their cases needs a membership. Each row says which applies to you. */
function tenantAccess(t: Tenant, boot: Boot, hasWorkspace: boolean): Access {
  const membership = boot.memberships.find((m) => m.id === t.id);
  if (membership?.status === 'active' && t.status === 'active') return t.id === boot.tenant_id && hasWorkspace ? { current: true } : { canOpen: true };
  if (!membership) return { noAccess: 'ไม่ได้เป็นสมาชิก', canRequest: t.status === 'active' };
  return { noAccess: t.status === 'active' ? 'ผู้ดูแลองค์กรปิดสิทธิ์ของคุณไว้' : 'เปิดไม่ได้ขณะองค์กรถูกระงับ', canRequest: false };
}

function OrganizationsView({ data }: { data: TenantsPage }) {
  const [f, setFilters] = useUiState<TenantFilters>('platform:filters', {});
  const { openModal } = useDialogs();
  const all = data.tenants;
  const term = (f.q || '').toLowerCase();
  const visible = all
    .filter((t) => (!f.status || t.status === f.status) && (!term || [t.name, t.slug].some((v) => String(v || '').toLowerCase().includes(term))))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const slice = usePager('platform', visible, { size: 25 });
  const counts = (status: string) => all.filter((t) => !status || t.status === status).length;
  const members = all.reduce((total, t) => total + t.member_count, 0);
  // A new search or filter starts the list again from its first page.
  const update = (next: TenantFilters) => {
    setFilters(next);
    slice.setPage(1);
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>จัดการองค์กร</h1>
          <p>
            {all.length} องค์กรบนระบบนี้ · สมาชิกที่ใช้งานรวม {members} คน
          </p>
        </div>
        <div className="flex">
          <button type="button" className="btn primary" onClick={() => openModal('สร้างองค์กรใหม่', <TenantForm />)}>
            <Icon name="plus" />
            สร้างองค์กร
          </button>
        </div>
      </div>
      <p className="muted platform-note">
        <Icon name="lock" />
        <span>
          หน้านี้ทำงานระดับแพลตฟอร์ม ใช้สร้างองค์กรลูกค้าต้นทางและเข้าไปช่วยดูแล เคสและบทสนทนาเป็นข้อมูลของแต่ละองค์กร จึงเปิดได้เฉพาะองค์กรที่คุณเป็นสมาชิก
          ดูได้ในคอลัมน์ “พื้นที่ทำงานของคุณ”
        </span>
      </p>
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
                      <th>สมาชิก</th>
                      <th>สถานะ</th>
                      <th>พื้นที่ทำงานของคุณ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slice.shown.map((t, i) => (
                      <TenantRow key={t.id} tenant={t} index={slice.start + i} />
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
      <section className="card mt">
        <div className="card-header">
          <div>
            <h2>ประวัติแพลตฟอร์ม</h2>
            <p>การสร้างองค์กร Support Access ทีมผู้ดูแล และ FAQ กลาง 30 รายการล่าสุด</p>
          </div>
          <Icon name="shield" />
        </div>
        <div className="card-body">
          <AuditList events={(data.audit || []).slice(0, 30)} />
        </div>
      </section>
    </>
  );
}

function TenantRow({ tenant: t, index }: { tenant: Tenant; index: number }) {
  const boot = useBoot().data!;
  const { data: work } = useWorkspace();
  const switchTenant = useSwitchTenant();
  const copyText = useCopyText();
  const toast = useToast();
  const { openModal } = useDialogs();
  const url = customerHomeUrl(t.slug, boot.home?.slug);
  const access = tenantAccess(t, boot, Boolean(work));

  return (
    <tr className={t.status === 'active' ? '' : 'org-suspended'}>
      <td>
        <div className="org-cell">
          <Avatar name={t.name} index={index} />
          <div className="org-text">
            <strong className="truncate">{t.name}</strong>
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
        </div>
      </td>
      <td className="org-members">{t.member_count}</td>
      <td>
        <Badge status={t.status} />
      </td>
      <td>
        {'current' in access && (
          <span className="org-access">
            <Icon name="check" />
            ใช้งานอยู่ตอนนี้
          </span>
        )}
        {'canOpen' in access && (
          <button
            type="button"
            className="btn sm"
            title={`สลับไปทำงานในองค์กร ${t.name}`}
            onClick={() => switchTenant(t.id).catch((error: unknown) => toast(error instanceof Error ? error.message : String(error), true))}
          >
            <Icon name="arrow" />
            เปิดพื้นที่ทำงาน
          </button>
        )}
        {'noAccess' in access &&
          (access.canRequest ? (
            <button
              type="button"
              className="btn sm"
              title="คุณยังไม่ได้เป็นสมาชิก · ขอเข้าองค์กรเพื่อ Support พร้อมบันทึกเหตุผล"
              onClick={() => openModal('ขอสิทธิ์ Support Access', <SupportAccessForm id={t.id} name={t.name} />)}
            >
              <Icon name="shield" />
              ขอ Support Access
            </button>
          ) : (
            <span className="org-access muted" title="ต้องเป็นสมาชิกขององค์กรนี้จึงจะอ่านเคสและบทสนทนาได้">
              <Icon name="lock" />
              {access.noAccess}
            </span>
          ))}
      </td>
    </tr>
  );
}
