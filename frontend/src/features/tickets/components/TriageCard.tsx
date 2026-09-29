'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { decideTriage } from '@/features/ai/api';
import { priorityLabels } from '@/lib/labels';
import { useInvalidate } from '@/lib/query';
import { TICKET_PREFIXES } from '../api';
import { tagsOf, useCaseTags } from '../tags';
import type { Ticket, TriageProposal } from '../types';

/* ข้อเสนอของ AI on the case screen (backend ai/triage.py): the priority, team and tags the AI read a new case as
   needing. Nothing changes until a member presses ใช้ (with the parts they leave ticked) or ไม่ใช้; either way the
   card goes away. Markup: pages/tickets (triage-card). */

type Part = 'priority' | 'team' | 'tags';

export function TriageCard({ ticket }: { ticket: Ticket }) {
  const proposal = ticket.triage;
  if (!proposal) return null;
  // A fresh card (fresh ticks) for each proposal.
  return <Proposal key={JSON.stringify(proposal)} ticketId={ticket.id} proposal={proposal} />;
}

function Proposal({ ticketId, proposal }: { ticketId: string; proposal: TriageProposal }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const tagList = useCaseTags();
  const [busy, setBusy] = useState(false);
  const parts: Array<[Part, string, string]> = [
    ...(proposal.priority ? [['priority', 'ความเร่งด่วน', priorityLabels[proposal.priority] ?? proposal.priority] as [Part, string, string]] : []),
    ...(proposal.team_id ? [['team', 'ย้ายไปทีม', proposal.team_name] as [Part, string, string]] : []),
    ...(proposal.tags.length ? [['tags', 'ติดป้าย', tagsOf(proposal.tags, tagList).map((t) => t.name).join(', ')] as [Part, string, string]] : []),
  ];
  const [picked, setPicked] = useState<Part[]>(() => parts.map(([key]) => key));

  const decide = async (use: Part[]) => {
    setBusy(true);
    try {
      await decideTriage(ticketId, use);
      await refresh(...TICKET_PREFIXES);
      toast(use.length ? 'ใช้ข้อเสนอของ AI แล้ว' : 'ไม่ใช้ข้อเสนอนี้แล้ว');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card info-block triage-card" aria-labelledby={`triage-${ticketId}`}>
      <h3 id={`triage-${ticketId}`}>
        <Icon name="sparkle" />
        AI เสนอสำหรับเคสนี้
      </h3>
      {proposal.reason && <p className="triage-reason">{proposal.reason}</p>}
      <ul className="triage-parts">
        {parts.map(([key, label, value]) => (
          <li key={key}>
            <label className="check">
              <input
                type="checkbox"
                checked={picked.includes(key)}
                onChange={(e) => setPicked((list) => (e.target.checked ? [...list, key] : list.filter((k) => k !== key)))}
              />
              <span>
                {label}: <strong>{value}</strong>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="triage-actions">
        <button
          type="button"
          className="btn primary sm"
          disabled={busy}
          onClick={() => (picked.length ? void decide(picked) : toast('ติ๊กเลือกอย่างน้อย 1 ข้อ หรือกดไม่ใช้', true))}
        >
          ใช้ที่เลือก
        </button>
        <button type="button" className="btn sm" disabled={busy} onClick={() => void decide([])}>
          ไม่ใช้
        </button>
      </div>
    </section>
  );
}
