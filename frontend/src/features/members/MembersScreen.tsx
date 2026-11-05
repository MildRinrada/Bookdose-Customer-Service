'use client';

import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { Avatar, Badge, EmptyState } from '@/components/ui/display';
import { FilterPill, SearchInput } from '@/components/ui/filters';
import { Pager, usePager } from '@/components/ui/Pager';
import { InvitationsPanel } from '@/features/settings/components/InvitationsPanel';
import { MemberForm } from '@/features/settings/components/MemberForm';
import { SupportRequestsPanel } from '@/features/settings/components/SupportRequestsPanel';
import { TeamForm } from '@/features/settings/components/TeamForm';
import { memberStatusLabels } from '@/features/settings/labels';
import type { MemberFilters } from '@/features/settings/types';
import { date } from '@/lib/format';
import { roleLabels } from '@/lib/labels';
import { useStaffUser, useWork } from '@/lib/session';
import type { Member } from '@/lib/types';
import { useUiState } from '@/lib/ui-state';

/* ทีมและสมาชิก, a screen of its own beside ข้อมูลลูกค้า. It used to be a section inside ตั้งค่าองค์กร, which suited an
   organization of five and nobody else: the people are the work, not a setting, and an organization with fifty of
   them needs the same room a list of customers gets. ตั้งค่าองค์กร now points here.

   The list is the app's usual list: search, role pills, a table and a pager. The columns share the width they are
   given instead of forcing the page sideways, so nothing is ever cut off at the right edge. */

export function MembersScreen() {
  const work = useWork();
  const { openModal } = useDialogs();
  const openMember = (member?: Member) =>
    openModal(
      member ? 'จัดการสมาชิก' : work.customer_email ? 'เชิญเพื่อนร่วมงาน' : 'เพิ่มสมาชิกใหม่',
      <MemberForm key={member?.id ?? 'new'} member={member} />,
    );
  const active = work.members.filter((m) => m.active).length;
  // จำนวนทีมงาน (backend platform/team_size.py): members and open invitations take the seats the platform gave.
  const seats = work.team_size;
  const full = seats.members + seats.invited >= seats.limit;
  // A team is a name and what it looks after, no customer in it, so a ผู้ดูแลสมาชิก keeps them as well as the
  // หัวหน้าทีม. แบบคนเดียว works as one team.
  const lead = work.role === 'admin' || work.role === 'people';
  const addsTeams = lead && !seats.solo;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>ทีมและสมาชิก</h1>
          <p>
            {work.members.length} คนในองค์กร, เปิดใช้งาน {active} คน, {work.teams.length} ทีม
          </p>
        </div>
        <div className="flex">
          {/* Adding a team lives on the team card, where the teams are. */}
          <button
            type="button"
            className="btn primary"
            data-tour="invite"
            disabled={full}
            title={full ? 'ทีมงานครบจำนวนแล้ว' : undefined}
            onClick={() => openMember()}
          >
            <Icon name={work.customer_email ? 'mail' : 'plus'} />
            {work.customer_email ? 'เชิญสมาชิก' : 'เพิ่มสมาชิก'}
          </button>
        </div>
      </div>
      <SeatsNotice />
      {/* The list first. The invitations and the platform's requests are usually empty, and two empty boxes at the
          top pushed the thing the screen is for below the fold. */}
      <section className="card" data-tour="members">
        <div className="card-header">
          <div>
            <h2>สมาชิกในองค์กร</h2>
          </div>
        </div>
        <div id="members-panel">
          <MembersList onEdit={openMember} />
        </div>
      </section>
      <section className="card" data-tour="teams">
        <div className="card-header">
          <div>
            <h2>ทีมในองค์กร</h2>
          </div>
          {addsTeams && (
            <button type="button" className="btn" onClick={() => openModal('เพิ่มทีมใหม่', <TeamForm />)}>
              <Icon name="plus" />
              เพิ่มทีม
            </button>
          )}
        </div>
        <div className="card-body">
          <div className="team-grid">
            {work.teams.map((t) => (
              <div className="team-card" key={t.id}>
                <span className="team-icon">
                  <Icon name="users" />
                </span>
                <div className="grow">
                  <strong className="truncate">{t.name}</strong>
                  <span className="muted">{work.members.filter((m) => m.active && m.team_id === t.id).length} สมาชิก</span>
                  {t.description ? <span className="tiny muted team-about">{t.description}</span> : null}
                </div>
                {/* A name given once was a name for good: editing keeps the team's id, so nothing it owns moves. */}
                {lead && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`แก้ไขทีม ${t.name}`}
                  title="แก้ไขทีม"
                  onClick={() => openModal('แก้ไขทีม', <TeamForm key={t.id} team={t} />)}
                >
                  <Icon name="edit" />
                </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
      <InvitationsPanel quiet />
      <SupportRequestsPanel quiet />
    </>
  );
}

/** จำนวนทีมงาน: how many of the seats the platform gave are taken, and what to do when none is left. */
function SeatsNotice() {
  const { team_size: s } = useWork();
  const taken = s.members + s.invited;
  if (s.solo)
    return (
      <div className="notice">
        องค์กรนี้ใช้แบบคนเดียว คุณตอบลูกค้าทุกเรื่องเอง และเคสใหม่เป็นของคุณทันที ถ้าต้องการเพิ่มทีมงาน ติดต่อผู้ดูแลแพลตฟอร์มเพื่อเปลี่ยนเป็นแบบหลายคน
      </div>
    );
  return (
    <div className={`notice${taken >= s.limit ? ' warning' : ''}`}>
      ทีมงาน {taken} จาก {s.limit} คน
      {s.invited ? ` (รวมคำเชิญที่ยังไม่ตอบรับ ${s.invited} คน)` : ''}
      {taken >= s.limit ? ' ครบจำนวนแล้ว ปิดบัญชีสมาชิกที่ไม่ใช้ หรือยกเลิกคำเชิญ จึงจะเพิ่มคนใหม่ได้' : ''}
    </div>
  );
}

function MembersList({ onEdit }: { onEdit: (member: Member) => void }) {
  const work = useWork();
  const me = useStaffUser().id;
  const [f, setFilters] = useUiState<MemberFilters>('settings:members', {});
  const all = work.members;
  const term = (f.q || '').toLowerCase();
  const visible = all.filter(
    (m) => (!f.role || m.role === f.role) && (!term || [m.name, m.email].some((v) => String(v || '').toLowerCase().includes(term))),
  );
  const slice = usePager('members', visible, { size: 25 });
  const counts = (role: string) => all.filter((m) => !role || m.role === role).length;
  // A new search or role starts the list again from its first page.
  const update = (next: MemberFilters) => {
    setFilters(next);
    slice.setPage(1);
  };
  const pills = [['', 'ทั้งหมด'] as const, ...Object.entries(roleLabels)].filter(([key]) => !key || counts(key) || f.role === key);

  return (
    <>
      <div className="card-body member-filters">
        <SearchInput
          id="member-search"
          label="ค้นหาสมาชิก"
          placeholder="ค้นหาชื่อหรืออีเมล"
          value={f.q || ''}
          onChange={(q) => update({ ...f, q })}
        />
        <div className="filter-pills" role="group" aria-label="บทบาท">
          {pills.map(([key, label]) => (
            <FilterPill
              key={key}
              value={key}
              label={label}
              pressed={(f.role || '') === key}
              count={counts(key)}
              onClick={(role) => update({ ...f, role })}
            />
          ))}
        </div>
        <span className="muted article-count" role="status">
          {visible.length} จาก {all.length} คน
        </span>
      </div>
      {visible.length ? (
        <>
          <div className="table-scroll member-table">
            <table>
              <colgroup>
                <col className="col-person" />
                <col className="col-email" />
                <col className="col-role" />
                <col className="col-team" />
                <col className="col-state" />
                <col className="col-manage" />
              </colgroup>
              <thead>
                <tr>
                  <th>สมาชิก</th>
                  <th>อีเมล</th>
                  <th>บทบาท</th>
                  <th>ทีม</th>
                  <th>สถานะ</th>
                  <th>
                    <span className="sr-only">จัดการ</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {slice.shown.map((m, i) => {
                  const status = m.active ? 'active' : 'suspended';
                  return (
                    <tr key={m.id} className={m.active ? '' : 'member-suspended'}>
                      <td>
                        <div className="flex">
                          <Avatar name={m.name} index={slice.start + i} />
                          <span className="truncate" title={m.name}>
                            {m.name}
                          </span>
                        </div>
                      </td>
                      <td className="muted member-email" title={m.email}>
                        {m.email}
                      </td>
                      <td className="member-cell">
                        {roleLabels[m.role]}
                        {m.expires_at && m.active ? <span className="tiny muted support-member"> Support ถึง {date(m.expires_at, true)}</span> : null}
                      </td>
                      <td className="member-cell" title={work.teams.find((t) => t.id === m.team_id)?.name || ''}>
                        {work.teams.find((t) => t.id === m.team_id)?.name || '-'}
                      </td>
                      <td>
                        <Badge status={status} label={memberStatusLabels[status]} />
                        {/* Only an admin's list says it (backend organization/service.py): the notice was shown, not answered. */}
                        {m.privacy_ok === false && m.active ? (
                          <span className="tiny member-privacy" title="ยังไม่ได้กดรับทราบประกาศความเป็นส่วนตัวฉบับที่ใช้อยู่ ระบบจะถามเขาตอนเข้าใช้งาน">
                            ยังไม่รับทราบประกาศ
                          </span>
                        ) : null}
                      </td>
                      <td className="member-manage">
                        {/* A ผู้ดูแลสมาชิก changes neither a หัวหน้าทีม nor themselves (backend organization/service.py). */}
                        {work.role !== 'people' || (m.role !== 'admin' && m.id !== me) ? (
                          <button type="button" className="btn sm subtle" data-id={m.id} onClick={() => onEdit(m)}>
                            <Icon name="edit" />
                            จัดการ
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card-body">
            <Pager slice={slice} unit="สมาชิก" sizes={[25, 50, 100]} />
          </div>
        </>
      ) : (
        <div className="card-body">
          <EmptyState title="ไม่พบสมาชิกที่ค้นหา" icon="users" />
        </div>
      )}
    </>
  );
}
