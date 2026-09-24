'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { ChannelBadge, ErrorState, PageLoading } from '@/components/ui/display';
import { MoodTag, moodHeat, type Mood } from '@/components/ui/MoodTag';
import { AuditList } from '@/features/audit/components/AuditList';
import { ColleaguesHere } from '@/features/inbox/components/ColleaguesHere';
import { ConversationSummary } from '@/features/ai/components/ConversationSummary';
import { Composer } from '@/features/inbox/components/Composer';
import { MessageThread, ThreadFilter } from '@/features/inbox/components/MessageThread';
import { useMarkMentionsSeen, useModalOpen, useRefreshFailure } from '@/features/inbox/hooks';
import { isDone, overdue } from '@/lib/format';
import { useApi } from '@/lib/query';
import { useRealtimeInterval } from '@/lib/realtime-provider';
import { useMemberName, useWork } from '@/lib/session';
import { ticketPath } from './api';
import { CaseHero } from './components/CaseHero';
import { TicketSidebar } from './components/TicketSidebar';
import { escalationText } from './labels';
import type { TicketConversation, TicketDetail } from './types';

/* One case (the old ticketDetail): heading with status, SLA and escalation; each conversation with its thread and
   composer; the case history; the side column. The case is read again every 12 seconds (every minute while live
   updates are connected; not while a dialog is open) without touching drafts, the side form or the reader's place in
   a thread. A failed refresh says why once and the next round tries again. Markup: pages/tickets/ticket-detail, ticket-conversation. */

const POLL_MS = 12000;

export function TicketDetailScreen({ id }: { id: string }) {
  const modalOpen = useModalOpen();
  const interval = useRealtimeInterval(modalOpen ? false : POLL_MS);
  const detail = useApi<TicketDetail>(ticketPath(id), { refetchInterval: interval });
  useMarkMentionsSeen(detail.data?.conversations.map((c) => c.id) ?? []);
  useRefreshFailure(detail);

  if (detail.error && !detail.data) return <ErrorState title="เปิดพื้นที่ทำงานไม่สำเร็จ" error={detail.error} onRetry={() => void detail.refetch()} />;
  if (!detail.data) return <PageLoading />;
  return <TicketDetailView key={id} data={detail.data} />;
}

function TicketDetailView({ data }: { data: TicketDetail }) {
  const work = useWork();
  const memberName = useMemberName();
  const { ticket: t, contact: c } = data;
  const escalation = escalationText(data.automation?.escalation, memberName);
  const late = overdue(t);
  // The most upset customer of the case's conversations (ai/mood.py), for its heading; nothing once it is finished.
  const moods = data.conversations.map(asMood).filter((m): m is Mood => m !== null);
  const mood = isDone(t) ? null : (moods.sort((a, b) => moodHeat(b) - moodHeat(a))[0] ?? null);
  return (
    <>
      <Link href="/tickets" className="back-link">
        <Icon name="back" />
        กลับไปเคสบริการ
      </Link>
      <CaseHero ticket={t} org={work.tenant.name} escalation={escalation} late={late} mood={mood} />
      <div className="detail-layout">
        <div className="stack">
          {data.conversations.map((conv) => (
            <TicketConversationCard key={conv.id} conv={conv} contactName={c.name} caseNumber={t.number} />
          ))}
          <section className="card case-history">
            <div className="card-header">
              <h2>ประวัติเคส</h2>
            </div>
            <div className="card-body">
              <AuditList events={data.events} />
            </div>
          </section>
        </div>
        <TicketSidebar data={data} />
      </div>
    </>
  );
}

/** A conversation's reading in the shape the tag takes, or null before the customer has written. */
function asMood(conv: TicketConversation): Mood | null {
  const m = conv.mood;
  return m ? { mood_level: m.level, mood_urgent: m.urgent, mood_reason: m.reason, mood_source: m.source } : null;
}

/** One conversation of the case: its channel, the thread (all messages or internal notes only) and the composer. */
function TicketConversationCard({ conv, contactName, caseNumber }: { conv: TicketConversation; contactName: string; caseNumber: number }) {
  const [notesOnly, setNotesOnly] = useState(false);
  return (
    <section className="card case-conversation" data-thread-scope="">
      <div className="card-header conv-card-header">
        <div className="flex">
          <ChannelBadge kind={conv.channel} />
          <h2>บทสนทนากับ {contactName}</h2>
          {conv.status !== 'closed' && asMood(conv) && <MoodTag mood={asMood(conv) as Mood} />}
        </div>
        <div className="conv-card-tools">
          <ThreadFilter messages={conv.messages} notesOnly={notesOnly} onChange={setNotesOnly} />
          <Link className="btn sm" href={`/inbox/${conv.id}`} title="เปิดบทสนทนานี้ในกล่องข้อความ">
            <Icon name="inbox" />
            เปิดในกล่องข้อความ
          </Link>
        </div>
      </div>
      <ConversationSummary conversationId={conv.id} messageCount={conv.messages.length} />
      <MessageThread messages={conv.messages} threadId={conv.id} notesOnly={notesOnly} readAt={conv.customer_read_at} />
      <ColleaguesHere conversationId={conv.id} />
      <Composer conversationId={conv.id} channel={conv.channel} manual={conv.channel === 'manual'} conversation={conv} recipient={contactName} caseNumber={caseNumber} />
    </section>
  );
}
