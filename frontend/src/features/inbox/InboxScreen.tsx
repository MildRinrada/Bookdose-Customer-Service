'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { FilterPill, FilterSelect, SearchInput } from '@/components/ui/filters';
import { useToast } from '@/components/ui/Toast';
import type { ApiError } from '@/lib/api/client';
import { channelNames } from '@/lib/labels';
import { useApi } from '@/lib/query';
import { useUiState } from '@/lib/ui-state';
import { conversationPath } from './api';
import { ConversationView } from './components/ConversationView';
import { InboxItem } from './components/InboxItem';
import { needsReply, useMarkMentionsSeen, useModalOpen, useSinglePane } from './hooks';
import type { ConversationDetail, ConversationSummary } from './types';

/* The inbox (the old pages/inbox/inbox.js): every channel in one filterable list, and the open conversation beside
   it. Wide screens open the first conversation of the current tab; narrow screens show the list first. The list and
   the open conversation refresh every 12 seconds without touching the draft or the reader's place in the thread.
   Markup: pages/inbox/inbox. */

const inboxFilters: Record<string, string> = { waiting: 'รอตอบ', open: 'เปิดอยู่', all: 'ทั้งหมด' };
const POLL_MS = 12000;

/** A refresh that fails while the screen shows older data says so once, in red (the old poll's toast). */
function usePollError(query: { error: ApiError | null; data: unknown; errorUpdatedAt: number }, onFail: () => void) {
  const toast = useToast();
  const { error, data, errorUpdatedAt } = query;
  useEffect(() => {
    if (error && data) {
      toast(error.message, true);
      onFail();
    }
    // Only a new failure is reported.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorUpdatedAt]);
}

export function InboxScreen({ id }: { id?: string }) {
  const router = useRouter();
  const singlePane = useSinglePane();
  const modalOpen = useModalOpen();
  // A failed refresh stops polling until the screen is opened again (the old poll cleared its timer).
  const [pollFailed, setPollFailed] = useState(false);
  const interval = modalOpen || pollFailed ? false : POLL_MS;
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
  const shown = conversations.filter((c) => matches(c));

  // Wide screens open a conversation from the current tab beside the list.
  const fallback = !id && !singlePane && list.data ? (conversations.find((c) => matches(c)) ?? conversations[0])?.id : undefined;
  const selectedId = id ?? fallback;
  const detail = useApi<ConversationDetail>(selectedId ? conversationPath(selectedId) : null, { refetchInterval: interval });

  const stopPolling = () => setPollFailed(true);
  usePollError(list, stopPolling);
  usePollError(detail, stopPolling);
  useMarkMentionsSeen(detail.data ? [detail.data.conversation.id] : []);

  // Put the default conversation in the address, so clicking it again does not open it anew (and drop a draft).
  useEffect(() => {
    if (!id && fallback) router.replace(`/inbox/${fallback}`);
  }, [id, fallback, router]);

  const listReady = Boolean(list.data);
  useEffect(() => {
    if (listReady) document.querySelector('.inbox-item.selected')?.scrollIntoView({ block: 'nearest' });
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
    <EmptyState title="ยังไม่มีข้อความ" description="แชร์หน้าลูกค้าเพื่อเริ่มรับเรื่องจากลูกค้า" icon="chat" />
  ) : query.trim() ? (
    <EmptyState title="ไม่พบบทสนทนาที่ค้นหา" description="ลองใช้ชื่อลูกค้า เรื่อง หรือหมายเลขเคส" icon="search" />
  ) : (
    <EmptyState
      title={filter === 'waiting' ? 'ตอบครบทุกบทสนทนาแล้ว' : 'ไม่มีบทสนทนาที่เปิดอยู่'}
      description="เลือก “ทั้งหมด” เพื่อดูบทสนทนาที่ปิดแล้ว"
      icon="checkCircle"
    />
  );

  let pane;
  if (!selectedId) pane = <EmptyState title="เลือกบทสนทนาเพื่อเริ่มดูแล" description="เมื่อมีลูกค้าส่งเรื่อง ข้อความจะแสดงทางด้านซ้าย" icon="chat" />;
  else if (detail.error && !detail.data) pane = <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  else if (!detail.data) pane = <PageLoading />;
  else pane = <ConversationView key={detail.data.conversation.id} data={detail.data} />;

  return (
    <>
      <div className="page-heading inbox-heading">
        <h1>กล่องข้อความ</h1>
      </div>
      <section className={`card inbox-layout${selectedId ? ' show-detail' : ''}`}>
        <div className="inbox-list">
          <div className="inbox-tools">
            <SearchInput id="inbox-search" label="ค้นหาบทสนทนา" placeholder="ค้นหาชื่อ เรื่อง หรือเลขเคส" value={query} onChange={setQuery} />
            <div className="inbox-filter-row">
              <div className="inbox-tabs" role="group" aria-label="แสดงบทสนทนา">
                {Object.entries(inboxFilters).map(([key, label]) => (
                  <FilterPill
                    key={key}
                    value={key}
                    label={label}
                    pressed={filter === key}
                    count={conversations.filter((c) => matches(c, key, '')).length}
                    onClick={setFilter}
                  />
                ))}
              </div>
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
          <div id="inbox-items">{items}</div>
        </div>
        <div className="inbox-detail" data-thread-scope="">
          {pane}
        </div>
      </section>
    </>
  );
}
