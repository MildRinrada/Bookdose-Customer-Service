'use client';

import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { date } from '@/lib/format';
import { roleLabels } from '@/lib/labels';
import { useBoot, useSwitchTenant } from '@/lib/session';

/* ตั้งค่าบัญชี → องค์กรของฉัน: every organization the account is a member of, with its role there, and switching to
   one (as a customer's องค์กรที่ติดต่อได้). Joining one is by an invitation from its admin, so there is no form to
   add one here. Markup: pages/org-links.css (.org-role). */

export function OrganizationsSettings() {
  const boot = useBoot().data!;
  const switchTenant = useSwitchTenant();
  const toast = useToast();
  const home = boot.home?.slug;

  return (
    <div className="account-section">
      <section className="card">
        <div className="card-header">
          <div>
            <h2>องค์กรของฉัน</h2>
            <p>บัญชีเดียวทำงานได้ทุกองค์กรที่ได้รับเชิญ สลับองค์กรได้จากที่นี่หรือจากเมนูด้านซ้าย</p>
          </div>
        </div>
        <div className="card-body">
          {boot.memberships.length === 0 ? (
            <p className="muted">
              {boot.user?.platform_admin
                ? 'บัญชีนี้ยังไม่ได้เป็นทีมงานขององค์กรใด ดูแลทุกองค์กรได้จากคอนโซลระบบกลาง'
                : 'บัญชีนี้ยังไม่ได้เป็นทีมงานขององค์กรใด ติดต่อผู้ดูแลองค์กรเพื่อขอคำเชิญ'}
            </p>
          ) : (
            <ul className="org-role-list">
              {boot.memberships.map((m, index) => {
                const current = m.id === boot.tenant_id;
                const usable = m.status === 'active';
                return (
                  <li key={m.id} className="org-role">
                    <div className="org-role-head">
                      <Avatar name={m.name} index={m.slug === home ? 1 : index + 2} />
                      <span className="grow">
                        <strong>{m.name}</strong>
                        <span className="muted">
                          {roleLabels[m.role] ?? m.role} · รหัส {m.slug}
                          {m.expires_at ? ` · สิทธิ์ช่วยดูแลถึง ${date(m.expires_at, true)}` : ''}
                        </span>
                      </span>
                      {current && usable ? (
                        <span className="badge resolved">
                          <Icon name="check" />
                          กำลังใช้งาน
                        </span>
                      ) : usable ? (
                        <button
                          className="btn sm"
                          type="button"
                          onClick={() => void switchTenant(m.id).catch((error: Error) => toast(error.message, true))}
                        >
                          <Icon name="arrow" />
                          สลับไปองค์กรนี้
                        </button>
                      ) : (
                        <span className="badge muted">ระงับใช้งาน</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="small muted">
            เข้าร่วมองค์กรอื่น: ให้ผู้ดูแลขององค์กรนั้นเชิญอีเมล {boot.user?.email} ที่ ตั้งค่าองค์กร → ทีมและสมาชิก แล้วเปิดลิงก์ในอีเมลเชิญ
          </p>
        </div>
      </section>
    </div>
  );
}
