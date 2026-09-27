'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/display';
import { useDialogs } from '@/components/ui/Dialogs';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { FollowupsPanel, MacroButtons, SurveySummary } from '@/features/automation';
import type { TicketAutomation } from '@/features/automation/types';
import { AUDIT_PATH } from '@/features/audit/api';
import { ContactHeadsUp } from '@/features/contacts/components/ContactProfileParts';
import { GuestBadge } from '@/features/inbox/components/GuestBadge';
import { TRASH_PATH } from '@/features/trash/api';
import { priorityLabels, statusLabels } from '@/lib/labels';
import { useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import { deleteTicket, TICKET_PREFIXES, TICKETS_PATH, updateTicket } from '../api';
import type { TicketDetail } from '../types';
import { SnoozeCard } from './SnoozeCard';
import { TicketFieldsCard } from './TicketFieldsCard';
import { TicketTagsCard } from './TicketTagsCard';
import { initialTeam, MemberPicker, TeamOptions } from '@/components/ui/pickers';

/* The case screen's side column (pages/tickets/ticket-detail, aside), one card each: the customer, managing the case,
   the organization's own fields, tags, follow-up reminders, macros and the CSAT result. The SLA clocks are in the
   case's head (CaseHero). */

const noAutomation: TicketAutomation = { followups: [], escalation: null, survey: null };

export function TicketSidebar({ data }: { data: TicketDetail }) {
  const { ticket: t, contact: c } = data;
  const extra = data.automation ?? noAutomation;
  // Saving draws the form again from the saved case (the old screen was drawn again after saving).
  const [formKey, setFormKey] = useState(0);
  return (
    <aside className="detail-sidebar">
      <section className="card info-block case-customer-card">
        <div className="case-customer">
          <Avatar name={c.name} index={2} />
          <div>
            <strong>{c.name}</strong>
            {c.company && <span className="muted">{c.company}</span>}
          </div>
        </div>
        <ContactHeadsUp contactId={c.id} className="case-headsup" />
        {c.guest && (
          <p className="guest-reach">
            <GuestBadge guest={c.guest} detail />
          </p>
        )}
        {c.email && (
          <a className="case-contact-line" href={`mailto:${c.email}`}>
            <Icon name="mail" />
            <span>{c.email}</span>
          </a>
        )}
        {c.phone && (
          <a className="case-contact-line" href={`tel:${String(c.phone).replace(/[^\d+]/g, '')}`}>
            <Icon name="phone" />
            <span>{c.phone}</span>
          </a>
        )}
        <Link className="btn sm case-customer-link" href={`/tickets?contact=${c.id}`}>
          <Icon name="ticket" />
          ดูเคสทั้งหมดของลูกค้ารายนี้
        </Link>
      </section>
      <TicketUpdateForm key={formKey} data={data} onSaved={() => setFormKey((k) => k + 1)} />
      <TicketFieldsCard ticket={t} />
      <TicketTagsCard ticket={t} />
      <SnoozeCard ticket={t} />
      <section className="card info-block">
        <h3>เตือนติดตามผล</h3>
        <FollowupsPanel ticketId={t.id} followups={extra.followups} />
      </section>
      <section className="card info-block">
        <h3>ปุ่มลัด (Macro)</h3>
        <MacroButtons kind="ticket" targetId={t.id} />
      </section>
      {extra.survey && (
        <section className="card info-block">
          <h3>ความพึงพอใจ (CSAT)</h3>
          <SurveySummary survey={extra.survey} />
        </section>
      )}
    </aside>
  );
}

/** Status, priority, team and owner; admins may also move the case to the recycle bin. */
function TicketUpdateForm({ data, onSaved }: { data: TicketDetail; onSaved: () => void }) {
  const t = data.ticket;
  const work = useWork();
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();
  const refresh = useInvalidate();
  const { confirmDelete } = useDialogs();
  const [team, setTeam] = useState(() => initialTeam(work, t.team_id));
  const [teamChanged, setTeamChanged] = useState(false);

  const remove = () => {
    const number = `BD-${t.number}`;
    const conversations = data.conversations.length;
    confirmDelete({
      title: `ลบเคส ${number}`,
      warning: `${number} “${t.subject}” จะถูกย้ายไปถังขยะ`,
      effects: [
        'เคสนี้จะหายไปจากรายการเคส รายงาน และการนับ SLA ทันที',
        conversations ? `บทสนทนา ${conversations} รายการจะยังอยู่ในกล่องข้อความ แต่จะไม่ผูกกับเคสนี้อีก` : 'เคสนี้ยังไม่มีบทสนทนาที่ผูกอยู่',
        'กู้คืนได้จากเมนูถังขยะภายใน 30 วัน หลังจากนั้นระบบจะลบถาวร',
        'การลบจะถูกบันทึกในประวัติการทำงานพร้อมหมายเลขเคส',
      ],
      word: number,
      confirmLabel: 'ย้ายเคสไปถังขยะ',
      run: async () => {
        await deleteTicket(t.id);
        toast(`ย้าย ${number} ไปถังขยะแล้ว · กู้คืนได้ที่เมนูถังขยะ`);
        router.push('/tickets');
        // Not the deleted case itself: asking for it again would only answer "not found" on the way out.
        await Promise.all([
          client.invalidateQueries({ queryKey: [TICKETS_PATH], exact: true }),
          refresh('/api/conversations', '/api/automation', TRASH_PATH, AUDIT_PATH),
        ]);
      },
    });
  };

  return (
    <Form
      className="card info-block"
      onSubmit={async (values) => {
        await updateTicket(t.id, values, t);
        toast('บันทึกเคสเรียบร้อยแล้ว');
        await refresh(...TICKET_PREFIXES);
        onSaved();
      }}
    >
      <h3>จัดการเคส</h3>
      <div className="field">
        <label htmlFor="case-status">สถานะ</label>
        <select id="case-status" name="status" defaultValue={t.status}>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="case-priority">ความเร่งด่วน</label>
        <select id="case-priority" name="priority" defaultValue={t.priority}>
          {Object.entries(priorityLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="case-team">ทีมรับผิดชอบ</label>
        <select
          id="case-team"
          name="team_id"
          value={team}
          onChange={(e) => {
            setTeam(e.target.value);
            setTeamChanged(true);
          }}
        >
          <TeamOptions />
        </select>
      </div>
      <div className="field">
        <label htmlFor="case-assignee">ผู้รับผิดชอบ</label>
        <MemberPicker id="case-assignee" teamId={team} value={teamChanged ? '' : (t.assignee_id ?? '')} />
      </div>
      <button className="btn primary" type="submit">
        บันทึกการเปลี่ยนแปลง
      </button>
      {work.role === 'admin' && (
        <button className="btn subtle danger-link" type="button" onClick={remove}>
          <Icon name="close" />
          ลบเคสนี้
        </button>
      )}
    </Form>
  );
}
