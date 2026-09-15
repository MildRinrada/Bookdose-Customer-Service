'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Badge, ChannelBadge, ErrorState, PageLoading, PriorityTag, PrivacyTag } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { AuditList } from '@/features/audit/components/AuditList';
import { Composer } from '@/features/inbox/components/Composer';
import { MessageThread, ThreadFilter } from '@/features/inbox/components/MessageThread';
import { useMarkMentionsSeen, useModalOpen } from '@/features/inbox/hooks';
import { date, overdue } from '@/lib/format';
import { useApi } from '@/lib/query';
import { useMemberName, useWork } from '@/lib/session';
import { ticketPath } from './api';
import { TicketSidebar } from './components/TicketSidebar';
import { escalationText } from './labels';
import type { TicketConversation, TicketDetail } from './types';

/* One case (the old ticketDetail): heading with status, SLA and escalation; each conversation with its thread and
   composer; the case history; the side column. The case is read again every 12 seconds (not while a dialog is open)
   without touching drafts, the side form or the reader's place in a thread. Markup: pages/tickets/ticket-detail,
   ticket-conversation. */

const POLL_MS = 12000;

export function TicketDetailScreen({ id }: { id: string }) {
  const toast = useToast();
  const modalOpen = useModalOpen();
  // A failed refresh stops polling until the screen is opened again (the old poll cleared its timer), and says why once.
  const [failedAt, setFailedAt] = useState(0);
  const detail = useApi<TicketDetail>(ticketPath(id), { refetchInterval: modalOpen || failedAt ? false : POLL_MS });
  useMarkMentionsSeen(detail.data?.conversations.map((c) => c.id) ?? []);

  const { error, data, errorUpdatedAt } = detail;
  if (error && data && !failedAt) setFailedAt(errorUpdatedAt || 1);
  const failure = failedAt && error ? error.message : '';
  useEffect(() => {
    if (failure) toast(failure, true);
  }, [failedAt, failure, toast]);

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
  return (
    <>
      <Link href="/tickets" className="back-link">
        <Icon name="back" />
        กลับไปเคสบริการ
      </Link>
      <div className="page-heading">
        <div>
          <h1>{t.subject}</h1>
          <p className="case-meta">
            <strong>BD-{t.number}</strong>
            <Badge status={t.status} />
            <PriorityTag value={t.priority} />
            {late && <span className="badge suspended">⚠ เกินกำหนด SLA</span>}
            {escalation && (
              <span className="badge escalated">
                <Icon name="bolt" />
                {escalation}
              </span>
            )}
            <span>
              เปิดเรื่อง {date(t.created_at, true)} · {t.category}
            </span>
            <PrivacyTag org={work.tenant.name} />
          </p>
        </div>
      </div>
      <div className="detail-layout">
        <div className="stack">
          {data.conversations.map((conv) => (
            <TicketConversationCard key={conv.id} conv={conv} contactName={c.name} />
          ))}
          <section className="card">
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

/** One conversation of the case: its channel, the thread (all messages or internal notes only) and the composer. */
function TicketConversationCard({ conv, contactName }: { conv: TicketConversation; contactName: string }) {
  const [notesOnly, setNotesOnly] = useState(false);
  return (
    <section className="card" data-thread-scope="">
      <div className="card-header conv-card-header">
        <div className="flex">
          <ChannelBadge kind={conv.channel} />
          <h2>บทสนทนากับ {contactName}</h2>
        </div>
        <Link className="btn sm" href={`/inbox/${conv.id}`} title="เปิดบทสนทนานี้ในกล่องข้อความ">
          <Icon name="inbox" />
          เปิดในกล่องข้อความ
        </Link>
      </div>
      <ThreadFilter messages={conv.messages} notesOnly={notesOnly} onChange={setNotesOnly} />
      <MessageThread messages={conv.messages} threadId={conv.id} notesOnly={notesOnly} />
      <Composer conversationId={conv.id} channel={conv.channel} manual={conv.channel === 'manual'} conversation={conv} />
    </section>
  );
}
