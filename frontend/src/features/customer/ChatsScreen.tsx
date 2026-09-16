'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Icon } from '@/components/Icon';
import { customerUnread } from '@/components/shell/CustomerShell';
import { CustomerNone, EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/filters';
import { GuestClaimBanners } from '@/features/guest/components/GuestClaimBanners';
import { useSinglePane } from '@/features/inbox';
import { plainText, relative } from '@/lib/format';
import { useUiState } from '@/lib/ui-state';
import { ChatView } from './components/ChatView';
import { OrgFilter } from './components/common';
import { NewChatForm } from './components/NewChatForm';
import { useChatSession, useOrgFilter, useOrgs, useOverview } from './hooks';
import { chatState, chatView } from './labels';
import type { CustomerChat } from './types';

/* แชทของฉัน: the list on the left, the open chat (or a new one) on the right. Wide screens open the newest chat
   beside the list, the way the team's inbox does (pages/customer/customer-chats.html). */

/* Opening a chat changes the address, which builds this screen again: without this the list would start at the top
   and then jump to the open chat. Kept in memory like the other screen choices (lib/ui-state): a reload starts fresh. */
let listScroll = 0;

export function ChatsScreen({ slug, id, newChat = false, preselect = '' }: { slug?: string; id?: string; newChat?: boolean; preselect?: string }) {
  const overview = useOverview();
  const orgs = useOrgs();
  const router = useRouter();
  const singlePane = useSinglePane();
  const [orgFilter] = useOrgFilter();
  const [query, setQuery] = useUiState('customer:chatQuery', '');

  const list = overview.conversations;
  const term = query.trim().toLowerCase();
  const found = list.filter(
    (x) =>
      (!orgFilter || x.org_slug === orgFilter) &&
      (!term ||
        [x.subject, x.last_body, x.org_name, x.category, x.ticket_number ? `BD-${x.ticket_number}` : ''].some((v) =>
          String(v || '').toLowerCase().includes(term),
        )),
  );

  const fallback = !newChat && !slug && !singlePane ? found[0] : undefined;
  const openSlug = slug ?? fallback?.org_slug;
  const openId = id ?? fallback?.id;
  const session = useChatSession(newChat ? undefined : openSlug, newChat ? undefined : openId);

  // Put the newest chat in the address, so Back and reload keep it open.
  useEffect(() => {
    if (fallback) router.replace(`/customer/chats/${fallback.org_slug}/${fallback.id}`);
  }, [fallback, router]);

  // Put the list back where it was before the address changed, then (below) reveal the open chat if it is out of view.
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = listScroll;
    const remember = () => {
      listScroll = list.scrollTop;
    };
    list.addEventListener('scroll', remember, { passive: true });
    return () => list.removeEventListener('scroll', remember);
  }, []);

  useEffect(() => {
    document.querySelector('.inbox-item.selected')?.scrollIntoView({ block: 'nearest' });
  }, [openId]);

  const listed = list.find((x) => x.id === openId);
  const openState = session.data ? chatView(session.data) : undefined;
  const hasDetail = newChat || Boolean(openId);

  let detail;
  if (newChat || (!list.length && !openId)) detail = <NewChatForm key={preselect} preselect={preselect} hasChats={list.length > 0} />;
  else if (openId && openSlug) {
    if (session.data)
      detail = (
        <ChatView
          data={session.data}
          slug={openSlug}
          orgName={orgs.find((o) => o.slug === openSlug)?.name || listed?.org_name || ''}
          category={listed?.category || ''}
        />
      );
    else if (session.error) detail = session.error.status === 404 ? <PageLoading /> : <ErrorState error={session.error} onRetry={() => void session.refetch()} />;
    else detail = <PageLoading />;
  } else detail = <EmptyState title="เลือกแชทจากรายการ" description="หรือเริ่มแชทใหม่เพื่อส่งเรื่องถึงองค์กรที่ต้องการ" icon="chat" />;

  const searching = Boolean(query.trim() || orgFilter);
  return (
    <>
      <div className="page-heading inbox-heading">
        <div>
          <h1>แชทของฉัน</h1>
          <p>คุยกับทุกองค์กรที่คุณติดต่อ และติดตามทุกเรื่องที่เคยส่งไว้ในที่เดียว</p>
        </div>
      </div>
      <GuestClaimBanners />
      <section className={`card inbox-layout customer-chats${hasDetail ? ' show-detail' : ''}`}>
        <div className="inbox-list" ref={listRef}>
          <div className="inbox-tools customer-chat-tools">
            <SearchInput id="customer-chat-search" label="ค้นหาแชท" placeholder="ค้นหาแชทของฉัน" value={query} onChange={setQuery} />
            <OrgFilter id="customer-org-filter" />
            <Link className="btn customer-list-new" href="/customer/chats/new">
              <Icon name="plus" />
              เริ่มแชทใหม่
            </Link>
          </div>
          <div id="customer-chat-items">
            {found.length ? (
              found.map((x) => (
                <ChatItem key={x.id} chat={x} selected={x.id === openId} state={x.id === openId && openState ? openState : chatState(x)} />
              ))
            ) : (
              <CustomerNone
                title={searching ? 'ไม่พบแชทที่ตรงกับที่เลือก' : 'ยังไม่มีแชท'}
                hint={searching ? 'ลองคำอื่น หรือเลือก “ทุกองค์กร”' : 'กด “เริ่มแชทใหม่” เพื่อส่งเรื่องถึงองค์กรที่ต้องการ'}
              />
            )}
          </div>
        </div>
        <div className="inbox-detail" data-thread-scope="">
          {detail}
        </div>
      </section>
    </>
  );
}

/** customer-chat-item.html. The open chat's row shows the state its page reads (kept fresh by polling). */
function ChatItem({ chat: x, selected, state }: { chat: CustomerChat; selected: boolean; state: { label: string; tone: string } }) {
  const unread = customerUnread({ last_kind: x.last_kind ?? undefined, seen_at: x.seen_at, updated_at: x.updated_at });
  const reference = x.ticket_number ? `BD-${x.ticket_number}` : '';
  return (
    <Link
      className={`inbox-item customer-chat-item${selected ? ' selected' : ''}${unread ? ' needs-reply' : ''}`}
      href={`/customer/chats/${x.org_slug}/${x.id}`}
      aria-current={selected ? 'true' : undefined}
    >
      <div className="inbox-top">
        <span className="customer-org-badge" title={x.org_name}>
          {x.org_name}
        </span>
        {unread && (
          <span className="unread-dot" title="มีคำตอบใหม่">
            <span className="sr-only">มีคำตอบใหม่</span>
          </span>
        )}
        <time className="inbox-time" dateTime={x.updated_at}>
          {relative(x.updated_at)}
        </time>
      </div>
      <h3>{x.subject}</h3>
      <p className="inbox-preview">
        {x.last_kind === 'reply' ? 'ทีมงาน: ' : ''}
        {plainText(x.last_body || '').slice(0, 90)}
      </p>
      <div className="customer-chat-meta">
        <span className={`customer-state tone-${state.tone}`}>{state.label}</span>
        {x.category && <span className="customer-category-tag">{x.category}</span>}
        {reference && <span className="inbox-case">{reference}</span>}
      </div>
    </Link>
  );
}
