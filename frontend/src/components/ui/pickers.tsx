'use client';

import { Combobox } from '@/components/ui/Combobox';
import { roleLabels } from '@/lib/labels';
import { useWork } from '@/lib/session';
import type { Team, Workspace } from '@/lib/types';

/* Team and member choices (the old core.js teamOptions / memberPicker), for every form that hands work to someone:
   a new case, the case sidebar, the channel settings, the reports filter. */

/** The teams a member may hand work to: every team, or an agent's own (the old teamOptions). */
export function visibleTeams(work: Workspace): Team[] {
  return work.teams.filter((t) => work.role !== 'agent' || t.id === work.team_id);
}

/** The team a team dropdown shows first: `preferred` when it is offered, otherwise the first one offered. */
export function initialTeam(work: Workspace, preferred: string | null | undefined): string {
  const teams = visibleTeams(work);
  return teams.some((t) => t.id === preferred) ? (preferred as string) : (teams[0]?.id ?? '');
}

/** <option>s of the teams the member may choose (put inside a <select>). */
export function TeamOptions() {
  const work = useWork();
  return (
    <>
      {visibleTeams(work).map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </>
  );
}

/** The people of one team, searchable by name, with "ยังไม่มอบหมาย" as the empty choice (the old memberPicker); the
    form gets assignee_id ('' for nobody). The list follows `teamId`: a new team starts the box again from `value`
    (pass '' after the team changed, like the old refreshMemberPicker). */
export function MemberPicker(props: { id: string; teamId: string | null | undefined; value?: string | null }) {
  return <Picker key={props.teamId ?? ''} {...props} />;
}

function Picker({ id, teamId, value }: { id: string; teamId: string | null | undefined; value?: string | null }) {
  const work = useWork();
  const members = work.members.filter((m) => m.active && m.team_id === teamId);
  return (
    <Combobox
      id={id}
      name="assignee_id"
      required={false}
      placeholder="ยังไม่มอบหมาย · พิมพ์เพื่อค้นหาชื่อ"
      value={value ?? ''}
      items={[
        { value: '', label: 'ยังไม่มอบหมาย' },
        ...members.map((m) => ({
          value: m.id,
          label: m.name,
          // Someone on a break or off shift can still be chosen by hand; the list says so.
          detail: [roleLabels[m.role] || '', m.availability && !m.availability.available ? `ไม่พร้อมรับเรื่อง: ${m.availability.reason}` : '']
            .filter(Boolean)
            .join(' · '),
        })),
      ]}
    />
  );
}
