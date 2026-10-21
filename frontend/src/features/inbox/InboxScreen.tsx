'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { moodHeat } from '@/components/ui/MoodTag';
import { StaffIssuesBanner } from '@/features/incidents/KnownIssues';
import { AllClear } from './components/AllClear';
import { FilterSelect, SearchInput } from '@/components/ui/filters';
import { channelNames } from '@/lib/labels';
import { useApi } from '@/lib/query';
import { useRealtimeInterval } from '@/lib/realtime-provider';
import { useStaffUser, useWork } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import { conversationPath } from './api';
import { ConversationAside } from './components/ConversationAside';
import { ConversationView } from './components/ConversationView';
import { InboxItem } from './components/InboxItem';
import { needsReply, useMarkMentionsSeen, useModalOpen, useRefreshFailure, useSinglePane } from './hooks';
import type { ConversationDetail, ConversationSummary } from './types';

/* The inbox (the old pages/inbox/inbox.js): every channel in one filterable list, and the open conversation beside
   it. Wide screens open the first conversation of the current tab; narrow screens show the list first. The list and
   the open conversation refresh every 12 seconds (every minute while live updates are connected) without touching the
   draft or the reader's place in the thread; a failed refresh says why once and the next round tries again.
   Markup: pages/inbox/inbox. */

const inboxFilters: Record<string, string> = { waiting: 'รอเราตอบ', open: 'เปิดอยู่', all: 'ทั้งหมด' };
const POLL_MS = 12000;

/** Where the list was left, kept across the address changes that rebuild it (reset by a full page load). */
let listScroll = 0;

export function InboxScreen({ id }: { id?: string }) {
  const router = useRouter();
  const work = useWork();
  const user = useStaffUser();
  const admin = work.role === 'admin' && !work.read_only;
  const singlePane = useSinglePane();
  const modalOpen = useModalOpen();
  const interval = useRealtimeInterval(modalOpen ? false : POLL_MS);
  const list = useApi<{ conversations: ConversationSummary[] }>('/api/conversations', { refetchInterval: interval });
  const [filter, setFilter] = useUiState('inbox:filter', 'open');
  const [query, setQuery] = useUiState('inbox:query', '');
  const [channel, setChannel] = useUiState('inbox:channel', '');

  const conversations = list.data?.conversations ?? [];
  const matches = (c: ConversationSummary, f = filter, text = query) => {
    const q = text.trim().toLowerCase();
    return (
      (f === 'all' || (f === 'open' && c.status === 'open') || (f === 'waiting' && needsReply(c))) &&
      (!channel || c.channel === channel) &&
      (!q ||
        [c.contact_name, c.company, c.subject, c.preview, c.ticket_number ? `BD-${c.ticket_number}` : ''].some((v) =>
          String(v || '').toLowerCase().includes(q),
        ))
    );
  };
  // An upset customer waiting for us comes first (ai/mood.py): most upset first, the rest in the order they came.
  // A chat a colleague took (รับเคส) goes below the rest: it is in hand, and not this member's to answer.
  const heat = (c: ConversationSummary) => (c.status !== 'closed' && needsReply(c) ? moodHeat(c) : 0);
  const taken = (c: ConversationSummary) => (c.ticket_assignee_id && c.ticket_assignee_id !== user.id ? 1 : 0);
  const shown = conversations.filter((c) => matches(c)).sort((a, b) => taken(a) - taken(b) || heat(b) - heat(a));

  // Wide screens open a conversation from the current tab beside the list.
  const fallback = !id && !singlePane && list.data ? (shown[0] ?? conversations[0])?.id : undefined;
  const selectedId = id ?? fallback;
  const detail = useApi<ConversationDetail>(selectedId ? conversationPath(selectedId) : null, { refetchInterval: interval });

  useRefreshFailure(list);
  useRefreshFailure(detail);
  useMarkMentionsSeen(detail.data ? [detail.data.conversation.id] : []);

  // Put the default conversation in the address, so clicking it again does not open it anew (and drop a draft).
  useEffect(() => {
    if (!id && fallback) router.replace(`/inbox/${fallback}`);
  }, [id, fallback, router]);

  // Opening another conversation is a change of address, so the list is built again and starts at the top. Putting it
  // back where it was keeps the row that was just clicked under the pointer; without this, the "scroll the least"
  // below would drag it down to the bottom edge of the box every single time. The box is the rows alone - the search
  // and the filters are above it and do not scroll.
  const listBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listBox.current;
    if (!el) return;
    if (listScroll) el.scrollTop = listScroll;
    const remember = () => {
      listScroll = el.scrollTop;
    };
    el.addEventListener('scroll', remember, { passive: true });
    return () => el.removeEventListener('scroll', remember);
  }, []);

  // Only when the open conversation is out of sight (a link opened from elsewhere, or the keyboard moved past the
  // edge): bring it to the middle, not flush against an edge.
  const listReady = Boolean(list.data);
  useEffect(() => {
    if (!listReady) return;
    const row = document.querySelector('.inbox-item.selected');
    const box = listBox.current;
    if (!row || !box) return;
    const seen = row.getBoundingClientRect();
    const frame = box.getBoundingClientRect();
    if (seen.top < frame.top || seen.bottom > frame.bottom) row.scrollIntoView({ block: 'center' });
  }, [listReady, selectedId]);

  // One pane at a time: the open conversation is read from its newest message, at the bottom of the page.
  const detailReady = Boolean(detail.data);
  useEffect(() => {
    if (!detailReady || !singlePane) return;
    const end = () => window.scrollTo(0, document.documentElement.scrollHeight);
    end();
    const frame = requestAnimationFrame(end);
    return () => cancelAnimationFrame(frame);
  }, [detailReady, singlePane, selectedId]);

  // Alt+↑ / Alt+↓ moves to the previous / next conversation in the list.
  const order = useRef<{ ids: string[]; selected?: string }>({ ids: [] });
  useEffect(() => {
    order.current = { ids: shown.map((c) => c.id), selected: selectedId };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || !['ArrowDown', 'ArrowUp'].includes(event.key) || document.querySelector('#modal[open]')) return;
      const { ids, selected } = order.current;
      const current = selected ? ids.indexOf(selected) : -1;
      const next = ids[event.key === 'ArrowDown' ? current + 1 : Math.max(0, current - 1)];
      if (next && next !== selected) {
        event.preventDefault();
        router.push(`/inbox/${next}`);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [router]);

  if (list.error && !list.data) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  if (!list.data) return <PageLoading />;

  const items = shown.length ? (
    shown.map((c) => <InboxItem key={c.id} c={c} selected={c.id === selectedId} />)
  ) : !conversations.length ? (
    <EmptyState title="ยังไม่มีข้อความ" icon="chat" />
  ) : query.trim() ? (
    <EmptyState title="ไม่พบบทสนทนาที่ค้นหา" icon="search" />
  ) : !channel && filter !== 'all' ? (
    // Nobody is waiting (or nothing is open) on any channel: the team has cleared the inbox.
    <AllClear seed={conversations.length} />
  ) : (
    <EmptyState
      title={filter === 'waiting' ? 'ตอบครบทุกบทสนทนาแล้ว' : 'ไม่มีบทสนทนาที่เปิดอยู่'}
      icon="checkCircle"
    />
  );

  let pane;
  if (!selectedId)
    pane = conversations.length ? (
      <EmptyState title="เลือกบทสนทนาเพื่อเริ่มดูแล" icon="chat" />
    ) : (
      /* Nothing has come in yet (a new organization): where customers come from, and for its admin the link to give them. */
      <EmptyState title="ยังไม่มีลูกค้าทักเข้ามา" description="ส่งลิงก์แชทขององค์กรให้ลูกค้า ข้อความจะขึ้นที่นี่" icon="chat">
        {admin && (
          <Link className="btn small" href="/settings?tab=webchat">
            ดูลิงก์และ QR
          </Link>
        )}
      </EmptyState>
    );
  else if (detail.error && !detail.data) pane = <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  else if (!detail.data) pane = <PageLoading />;
  else pane = <ConversationView key={detail.data.conversation.id} data={detail.data} />;

  return (
    <>
      <div className="page-heading inbox-heading">
        <div>
          <h1>กล่องข้อความ</h1>
        </div>
      </div>
      <StaffIssuesBanner />
      <section className={`card inbox-layout staff-chats${selectedId ? ' show-detail' : ''}${detail.data ? ' has-aside' : ''}`}>
        <div className="inbox-list">
          {/* The customer's list has a search box and one choice under it; the team's has two choices side by side. */}
          <div className="inbox-tools customer-chat-tools staff-chat-tools">
            <SearchInput id="inbox-search" label="ค้นหาบทสนทนา" placeholder="ค้นหาชื่อ เรื่อง หรือเลขเคส" value={query} onChange={setQuery} />
            <div className="inbox-tabs" role="group" aria-label="แสดงบทสนทนา">
              {Object.entries(inboxFilters).map(([key, label]) => (
                <button key={key} type="button" className="inbox-tab" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                  {label}
                  <span className="inbox-tab-count">{conversations.filter((c) => matches(c, key, '')).length}</span>
                </button>
              ))}
            </div>
            <div className="staff-chat-filters">
              <FilterSelect
                id="inbox-channel"
                label="กรองตามช่องทาง"
                value={channel}
                onChange={setChannel}
                any="ทุกช่องทาง"
                options={Object.entries(channelNames).map(([key, label]) => ({
                  value: key,
                  label: `${label} (${conversations.filter((c) => c.channel === key).length})`,
                }))}
              />
            </div>
          </div>
          <div className="inbox-items" id="inbox-items" ref={listBox}>
            {items}
          </div>
        </div>
        <div className="inbox-detail" data-thread-scope="">
          {pane}
        </div>
        {detail.data && (
          <ConversationAside
            data={detail.data}
            others={conversations.filter((c) => c.contact_id === detail.data!.contact.id && c.id !== detail.data!.conversation.id)}
          />
        )}
      </section>
    </>
  );
}
