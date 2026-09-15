'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { useDialogs } from '@/components/ui/Dialogs';
import { FormActions, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useOrgs, useOverview } from '@/features/customer/hooks';
import type { CustomerInvitation } from '@/features/customer/types';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { useUiState } from '@/lib/ui-state';
import {
  acceptInvite,
  declineInvite,
  flowsPath,
  inviteMember,
  removeMember,
  saveFlows,
  teamPath,
  updateMember,
  type MemberBody,
} from './api';
import { FlowEditor } from './components/FlowEditor';
import { capabilityLabels, flowKindHints, flowKindLabels, memberStatusLabels, memberStatusTones } from './labels';
import type { FlowKind, FlowsView, MemberRole, RoleInfo, TeamMember, TeamProject, TeamView } from './types';

/* ทีมของฉัน: the people the customer lets into their contracts and projects with one organization (a preset role on
   all or some projects), their default approval flows there, the teams they belong to, and the invitations waiting
   for them in any organization (/api/public/<org>/team, overview.invitations). Markup: pages/team.css. */

const FLOW_KINDS: FlowKind[] = ['delivery', 'contract'];

export function TeamScreen() {
  const orgs = useOrgs();
  const overview = useOverview();
  // Where the team is managed: the organization chosen, else the first one where the customer owns a contract.
  const owned = overview.contracts.find((c) => c.role === 'owner')?.org_slug;
  const [chosen, setChosen] = useUiState('team:org', '');
  const slug = orgs.some((o) => o.slug === chosen) ? chosen : owned || orgs.find((o) => !o.home)?.slug || orgs[0]?.slug || '';
  const org = orgs.find((o) => o.slug === slug);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>ทีมของฉัน</h1>
          <p>เชิญเจ้าหน้าที่ในองค์กรของคุณมาช่วยตรวจรับงาน ดูแลเอกสาร หรือชำระเงิน โดยกำหนดบทบาทและโครงการที่เห็นได้</p>
        </div>
        {orgs.length > 1 && (
          <div className="team-org">
            <label className="sr-only" htmlFor="team-org">
              ทีมกับองค์กร
            </label>
            <select id="team-org" className="customer-org-filter" value={slug} onChange={(e) => setChosen(e.target.value)}>
              {orgs.map((o) => (
                <option key={o.slug} value={o.slug}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="team-page">
        {overview.invitations.length > 0 && <Invitations invitations={overview.invitations} />}
        {slug ? (
          <OrgTeam key={slug} slug={slug} orgName={org?.name ?? ''} />
        ) : (
          <section className="card">
            <EmptyState title="ยังไม่ได้ติดต่อองค์กรใด" description="เพิ่มองค์กรในตั้งค่าบัญชีก่อน แล้วจึงเชิญทีมเข้าร่วมโครงการกับองค์กรนั้น" icon="users" />
          </section>
        )}
      </div>
    </>
  );
}

/** Invitations waiting for the customer's email, in any organization. */
function Invitations({ invitations }: { invitations: CustomerInvitation[] }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const { confirm } = useDialogs();
  const [busy, setBusy] = useState('');
  const run = async (id: string, action: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try {
      await action();
      toast(done);
      // Accepting also connects the account with the organization.
      await refresh('/api/customer/', '/api/public/');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy('');
    }
  };
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>คำเชิญเข้าร่วมทีม</h2>
          <p>รับคำเชิญแล้วจะเห็นสัญญาและโครงการที่ได้รับมอบหมายในเมนูสัญญาและโครงการ</p>
        </div>
      </div>
      <div className="card-body">
        <ul className="team-invites">
          {invitations.map((i) => (
            <li key={`${i.org_slug}:${i.id}`} className="team-invite">
              <Icon name="mail" />
              <span className="grow">
                <strong>
                  คุณ{i.owner_name || 'ลูกค้า'} เชิญคุณเป็น{i.role_label}
                </strong>
                <span className="muted">
                  โครงการกับ {i.org_name} · เชิญเมื่อ {date(i.invited_at, true)}
                </span>
              </span>
              <button
                type="button"
                className="btn primary sm"
                disabled={busy === i.id}
                onClick={() => void run(i.id, () => acceptInvite(i.org_slug, i.id), `เข้าร่วมทีมของคุณ${i.owner_name} แล้ว`)}
              >
                <Icon name="check" />
                รับคำเชิญ
              </button>
              <button
                type="button"
                className="btn sm"
                disabled={busy === i.id}
                onClick={() =>
                  confirm({
                    title: 'ปฏิเสธคำเชิญ',
                    message: `ปฏิเสธคำเชิญของคุณ${i.owner_name} กับ ${i.org_name}? เจ้าของทีมเชิญใหม่ได้ภายหลัง`,
                    confirmLabel: 'ปฏิเสธคำเชิญ',
                    cancelLabel: 'ยังไม่ตัดสินใจ',
                    tone: 'danger',
                    run: () => run(i.id, () => declineInvite(i.org_slug, i.id), 'ปฏิเสธคำเชิญแล้ว'),
                  })
                }
              >
                ปฏิเสธ
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function scopeText(all: boolean, ids: string[], projects: TeamProject[]): string {
  if (all) return 'ทุกโครงการ (รวมโครงการใหม่)';
  const names = ids.map((id) => projects.find((p) => p.id === id)?.reference).filter(Boolean);
  return names.length ? names.join(', ') : `${ids.length} โครงการ`;
}

function OrgTeam({ slug, orgName }: { slug: string; orgName: string }) {
  const q = useApi<TeamView>(teamPath(slug));
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <PageLoading />;
  const data = q.data;
  return (
    <>
      <Members slug={slug} orgName={orgName} data={data} />
      <DefaultFlows slug={slug} />
      <Memberships data={data} orgName={orgName} />
    </>
  );
}

function Members({ slug, orgName, data }: { slug: string; orgName: string; data: TeamView }) {
  const { openModal, confirmDelete } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const { members, projects } = data.mine;
  const current = members.filter((m) => m.status === 'invited' || m.status === 'active');
  const past = members.filter((m) => m.status === 'declined' || m.status === 'removed');
  const open = (member: TeamMember | null) =>
    openModal(
      member ? `แก้ไขสิทธิ์ของ ${member.name || member.email}` : `เชิญสมาชิกเข้าทีม · ${orgName}`,
      <MemberForm slug={slug} member={member} roles={data.roles} projects={projects} />,
      { wide: true },
    );
  const remove = (m: TeamMember) =>
    confirmDelete({
      title: m.status === 'invited' ? 'ยกเลิกคำเชิญ' : 'นำสมาชิกออกจากทีม',
      warning:
        m.status === 'invited'
          ? `คำเชิญถึง ${m.email} จะใช้ไม่ได้อีก`
          : `${m.name || m.email} จะเปิดสัญญาและโครงการของคุณไม่ได้อีกตั้งแต่คำขอถัดไป`,
      effects:
        m.status === 'invited'
          ? ['เชิญอีเมลนี้ใหม่ได้ภายหลัง']
          : ['ถูกนำออกจากขั้นตอนอนุมัติทั้งหมด รวมถึงขั้นที่ยังไม่ได้ตรวจในงานที่กำลังตรวจอยู่', 'ผลการตรวจที่ทำไปแล้วและข้อความเดิมยังเก็บไว้เป็นประวัติ'],
      confirmLabel: m.status === 'invited' ? 'ยกเลิกคำเชิญ' : 'นำออกจากทีม',
      run: async () => {
        await removeMember(slug, m.id);
        toast(m.status === 'invited' ? 'ยกเลิกคำเชิญแล้ว' : 'นำสมาชิกออกจากทีมแล้ว');
        await refresh(teamPath(slug));
      },
    });
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>สมาชิกในทีมของฉัน · {orgName}</h2>
          <p>คนที่คุณให้เข้าถึงสัญญาและโครงการของคุณกับองค์กรนี้ แต่ละคนเห็นและทำได้ตามบทบาท</p>
        </div>
        <button type="button" className="btn primary sm" onClick={() => open(null)}>
          <Icon name="plus" />
          เชิญสมาชิก
        </button>
      </div>
      {current.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>สมาชิก</th>
                <th>บทบาท</th>
                <th>โครงการที่เห็น</th>
                <th>สถานะ</th>
                <th>
                  <span className="sr-only">จัดการ</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {current.map((m) => (
                <tr key={m.id}>
                  <td>
                    <span className="team-member">
                      <strong>{m.name || m.email}</strong>
                      {m.name && <span className="muted">{m.email}</span>}
                    </span>
                  </td>
                  <td>{m.role_label}</td>
                  <td className="team-scope">{scopeText(m.all_projects, m.projects, projects)}</td>
                  <td>
                    <span className={`customer-state tone-${memberStatusTones[m.status]}`}>{memberStatusLabels[m.status]}</span>
                    <span className="tiny muted">
                      {' '}
                      {m.accepted_at ? `ตั้งแต่ ${date(m.accepted_at)}` : `เชิญเมื่อ ${date(m.invited_at)}`}
                    </span>
                  </td>
                  <td>
                    <span className="team-actions">
                      <button type="button" className="btn sm subtle" onClick={() => open(m)}>
                        <Icon name="edit" />
                        แก้ไข
                      </button>
                      <button type="button" className="btn sm subtle" onClick={() => remove(m)}>
                        <Icon name="close" />
                        {m.status === 'invited' ? 'ยกเลิกคำเชิญ' : 'นำออก'}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="ยังไม่มีสมาชิกในทีม"
          description={
            projects.length
              ? 'เชิญผู้ตรวจรับงาน ฝ่ายการเงิน หรือฝ่าย IT ของคุณ ให้ช่วยดูแลโครงการกับองค์กรนี้'
              : 'คุณยังไม่มีสัญญาหรือโครงการกับองค์กรนี้ เชิญล่วงหน้าได้โดยให้เห็นทุกโครงการ'
          }
          icon="users"
        />
      )}
      {past.length > 0 && (
        <details className="card-body">
          <summary className="muted">คำเชิญที่ปฏิเสธและสมาชิกที่นำออกแล้ว ({past.length})</summary>
          <ul className="team-invites">
            {past.map((m) => (
              <li key={m.id} className="team-member">
                <strong>{m.name || m.email}</strong>
                <span className="muted">
                  {m.role_label} · {memberStatusLabels[m.status]} · เชิญใหม่ได้ด้วยอีเมลเดิม
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Invite (no member) or change a member's role and projects. */
function MemberForm({ slug, member, roles, projects }: { slug: string; member: TeamMember | null; roles: RoleInfo[]; projects: TeamProject[] }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const [role, setRole] = useState<MemberRole>(member?.role ?? 'approver');
  const [all, setAll] = useState(member ? member.all_projects : true);
  return (
    <Form
      onSubmit={async (values, form) => {
        const picked = new FormData(form).getAll('projects').map(String);
        if (!all && !picked.length) throw new Error('กรุณาเลือกโครงการอย่างน้อย 1 โครงการ หรือเลือกทุกโครงการ');
        const body: MemberBody = { role, all_projects: all, projects: all ? [] : picked };
        if (member) await updateMember(slug, member.id, body);
        else await inviteMember(slug, { ...body, email: values.email ?? '' });
        closeModal(true);
        toast(member ? 'บันทึกสิทธิ์แล้ว มีผลตั้งแต่คำขอถัดไปของสมาชิก' : 'ส่งคำเชิญแล้ว ผู้ได้รับเชิญรับคำเชิญได้ที่หน้าทีมของฉัน');
        await refresh(teamPath(slug));
      }}
    >
      {!member && (
        <TextField
          label="อีเมลของผู้ที่จะเชิญ"
          name="email"
          type="email"
          max={254}
          placeholder="name@company.com"
          hint="ผู้ได้รับเชิญเข้าสู่ระบบ (หรือสมัคร) ด้วยอีเมลนี้ แล้วกดรับคำเชิญ"
        />
      )}
      <fieldset className="role-choices">
        <legend>บทบาท</legend>
        {roles.map((r) => (
          <label key={r.key} className="role-choice">
            <input type="radio" name="role" value={r.key} checked={role === r.key} onChange={() => setRole(r.key)} />
            <span className="grow">
              <strong>{r.label}</strong>
              <ul className="role-can">
                {r.can.map((c) => (
                  <li key={c}>{capabilityLabels[c]}</li>
                ))}
              </ul>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="role-choices">
        <legend>โครงการที่เห็น</legend>
        <label className="check">
          <input type="radio" name="scope" checked={all} onChange={() => setAll(true)} />
          <span>ทุกโครงการของฉันกับองค์กรนี้ รวมโครงการที่จะมีในอนาคต</span>
        </label>
        <label className="check">
          <input type="radio" name="scope" checked={!all} onChange={() => setAll(false)} disabled={!projects.length} />
          <span>เลือกเฉพาะบางโครงการ{projects.length ? '' : ' (ยังไม่มีโครงการ)'}</span>
        </label>
        {!all && (
          <div className="scope-projects">
            {projects.map((p) => (
              <label key={p.id} className="check">
                <input type="checkbox" name="projects" value={p.id} defaultChecked={member?.projects.includes(p.id)} />
                <span>
                  {p.reference} · {p.title}
                </span>
              </label>
            ))}
            <p className="tiny muted">สัญญา MA ของโครงการที่เลือกจะเห็นได้ด้วย</p>
          </div>
        )}
      </fieldset>
      <FormActions label={member ? 'บันทึกสิทธิ์' : 'ส่งคำเชิญ'} onCancel={() => closeModal()} />
    </Form>
  );
}

/** The owner's default approval flows in this organization (all their projects, unless a project has its own). */
function DefaultFlows({ slug }: { slug: string }) {
  const q = useApi<FlowsView>(flowsPath(slug));
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <PageLoading />;
  return <DefaultFlowsForm key={q.dataUpdatedAt} slug={slug} data={q.data} />;
}

function DefaultFlowsForm({ slug, data }: { slug: string; data: FlowsView }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const [flows, setFlows] = useState<Record<FlowKind, string[]>>({ delivery: data.delivery, contract: data.contract });
  const changed = FLOW_KINDS.some((k) => flows[k].join() !== data[k].join());
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>ขั้นตอนอนุมัติเริ่มต้น</h2>
          <p>ผู้ตรวจตามลำดับก่อนการตัดสินใจขั้นสุดท้าย ใช้กับทุกโครงการของคุณกับองค์กรนี้ (ตั้งเฉพาะโครงการได้ในแท็บงวดงานของโครงการ)</p>
        </div>
      </div>
      <Form
        className="card-body"
        onSubmit={async () => {
          await saveFlows(slug, flows);
          toast('บันทึกขั้นตอนอนุมัติแล้ว ใช้กับงานที่ส่งมาหลังจากนี้');
          await refresh(flowsPath(slug));
        }}
      >
        <div className="flow-kinds">
          {FLOW_KINDS.map((kind) => (
            <div key={kind} className="flow-kind">
              <h3>{flowKindLabels[kind]}</h3>
              <p className="tiny muted">{flowKindHints[kind]}</p>
              <FlowEditor
                label={flowKindLabels[kind]}
                reviewers={data.reviewers}
                value={flows[kind]}
                onChange={(steps) => setFlows((f) => ({ ...f, [kind]: steps }))}
              />
            </div>
          ))}
        </div>
        {data.reviewers.length < 2 && (
          <p className="tiny muted">เชิญสมาชิกบทบาทผู้ตรวจรับ/อนุมัติ หรือผู้ดูแลร่วม เพื่อเพิ่มเป็นผู้ตรวจในขั้นตอน</p>
        )}
        <p className="tiny muted">งานที่กำลังตรวจอยู่ใช้ขั้นตอนเดิมจนจบ</p>
        <div>
          <button className="btn primary" type="submit" disabled={!changed}>
            <Icon name="check" />
            บันทึกขั้นตอนอนุมัติ
          </button>
        </div>
      </Form>
    </section>
  );
}

/** Teams of other owners the customer belongs to here. */
function Memberships({ data, orgName }: { data: TeamView; orgName: string }) {
  if (!data.memberships.length) return null;
  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>ทีมที่ฉันเป็นสมาชิก · {orgName}</h2>
          <p>สัญญาและโครงการของเจ้าของทีมเหล่านี้อยู่ในเมนูสัญญาและโครงการ ตามบทบาทที่ได้รับ</p>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>เจ้าของทีม</th>
              <th>บทบาทของฉัน</th>
              <th>โครงการ</th>
              <th>เข้าร่วมเมื่อ</th>
            </tr>
          </thead>
          <tbody>
            {data.memberships.map((m) => (
              <tr key={m.owner_id}>
                <td>คุณ{m.owner_name}</td>
                <td>{m.role_label}</td>
                <td className="team-scope">{m.all_projects ? 'ทุกโครงการ' : `${m.projects.length} โครงการ`}</td>
                <td>{date(m.accepted_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
