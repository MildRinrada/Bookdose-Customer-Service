'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { FilterPill, FilterSelect, SearchInput } from '@/components/ui/filters';
import { Pager, usePager } from '@/components/ui/Pager';
import { useApi } from '@/lib/query';
import { useBoot, useStaffLogout, useSwitchTenant, useWork } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import { ARTICLES_PATH } from './api';
import { ArticleCard } from './components/ArticleCard';
import { ArticleRead } from './components/ArticleRead';
import { useArticleActions } from './components/useArticleActions';
import { articleSorts, visibilityLabels } from './labels';
import type { Article, ArticleSort, ArticlesPage } from './types';

/* คลังความรู้: the team's articles with search, visibility, sort and category filters; reading, writing and deleting
   happen in the modal. /knowledge/<id> opens that article over the list; ?tenant=<id> (the copied link) first
   switches to the article's organization when the member belongs to it. Markup: pages/knowledge/knowledge. */

export function KnowledgeScreen({ id, tenant }: { id?: string; tenant?: string }) {
  const boot = useBoot().data;
  if (tenant && boot && tenant !== boot.tenant_id) return <TenantSwitch tenant={tenant} next={id ? `/knowledge/${encodeURIComponent(id)}` : '/knowledge'} />;
  return <KnowledgeList openId={id} />;
}

/** A link to an article of another organization: switch to it (then the address loses ?tenant), or say why not. */
function TenantSwitch({ tenant, next }: { tenant: string; next: string }) {
  const boot = useBoot().data;
  const switchTenant = useSwitchTenant();
  const logout = useStaffLogout();
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1);
  const member = Boolean(boot?.memberships.some((m) => m.id === tenant && m.status === 'active'));

  useEffect(() => {
    // Once per attempt (React may run effects twice in development).
    if (!member || started.current === attempt) return;
    started.current = attempt;
    switchTenant(tenant, next).catch((reason: unknown) => setError(reason instanceof Error ? reason : new Error(String(reason))));
  }, [member, tenant, next, attempt, switchTenant]);

  const failure = member ? error : new Error('ไม่มีสิทธิ์เข้าถึงองค์กรของบทความนี้');
  if (!failure) return <PageLoading />;
  return (
    <ErrorState
      title="เปิดพื้นที่ทำงานไม่สำเร็จ"
      error={failure}
      onRetry={() => {
        setError(null);
        setAttempt((n) => n + 1);
      }}
    >
      <button type="button" className="btn" onClick={() => void logout()}>
        ออกจากระบบ
      </button>
    </ErrorState>
  );
}

function sortArticles(list: Article[], sort: ArticleSort): Article[] {
  return list.sort((a, b) =>
    sort === 'updated'
      ? String(b.updated_at).localeCompare(String(a.updated_at))
      : sort === 'title'
        ? a.title.localeCompare(b.title, 'th')
        : a.category.localeCompare(b.category, 'th') || a.title.localeCompare(b.title, 'th'),
  );
}

function KnowledgeList({ openId }: { openId?: string }) {
  const page = useApi<ArticlesPage>(ARTICLES_PATH);
  const work = useWork();
  const client = useQueryClient();
  const { openModal } = useDialogs();
  const { edit: openEditor, remove } = useArticleActions();
  const [query, setQuery] = useUiState('knowledge:query', '');
  const [category, setCategory] = useUiState('knowledge:category', '');
  const [visibility, setVisibility] = useUiState('knowledge:visibility', '');
  const [sort, setSort] = useUiState<ArticleSort>('knowledge:sort', 'updated');

  const articles = page.data?.articles ?? [];
  const term = query.toLowerCase();
  const visible = sortArticles(
    articles.filter(
      (a) =>
        (!category || a.category === category) &&
        (!visibility || a.visibility === visibility) &&
        (!term || [a.title, a.body, a.category].some((s) => s.toLowerCase().includes(term))),
    ),
    sort,
  );
  const slice = usePager('knowledge', visible, { size: 12 });
  const canWrite = work.role !== 'agent';

  const categoriesOf = (list: Article[]) => [...new Set(list.map((a) => a.category))];

  // Reading, editing and deleting open over one another in the modal, as before; the functions refer to each other.
  const actions = useRef<{ read: (a: Article) => void; edit: (a?: Article) => void; remove: (a: Article) => void }>(null!);
  const read = useCallback(
    (article: Article) =>
      openModal(article.title, <ArticleRead article={article} onEdit={(a) => actions.current.edit(a)} onDelete={(a) => actions.current.remove(a)} />),
    [openModal],
  );
  // The article of the address, from the freshest list (after saving, the old router opened it again).
  const reopen = useCallback(() => {
    if (!openId) return;
    // An editor kept open by its unsaved-changes guard (Back was refused) must not be replaced by the reader.
    if (document.querySelector('#modal[open] form[data-form="article"]')) return;
    const found = client.getQueryData<ArticlesPage>([ARTICLES_PATH])?.articles.find((a) => a.id === openId);
    if (found) read(found);
  }, [client, openId, read]);
  const edit = useCallback((article?: Article) => openEditor(article, reopen), [openEditor, reopen]);
  useEffect(() => {
    actions.current = { read, edit, remove };
  }, [read, edit, remove]);

  // /knowledge/<id>: open the article once the list is here. A frame later, because the dialogs close whatever was
  // open when the address changes, in the same commit.
  const opened = useRef(false);
  const loaded = Boolean(page.data);
  useEffect(() => {
    if (!loaded || opened.current || !openId) return;
    opened.current = true;
    const frame = requestAnimationFrame(reopen);
    return () => {
      cancelAnimationFrame(frame);
      opened.current = false;
    };
  }, [loaded, openId, reopen]);

  if (page.isPending) return <PageLoading />;
  if (page.error) return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;

  const counts = new Map<string, number>();
  articles.forEach((a) => counts.set(a.category, (counts.get(a.category) || 0) + 1));
  const pills = ['', ...categoriesOf(articles)].sort((a, b) => (a ? (b ? a.localeCompare(b, 'th') : 1) : -1));

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>คลังความรู้</h1>
          <p>คู่มือที่ทีมใช้ตอบคำถามและช่วยเหลือลูกค้า</p>
        </div>
        <div className="flex">
          {canWrite && (
            <button type="button" className="btn primary" onClick={() => edit()}>
              <Icon name="plus" />
              เขียนบทความใหม่
            </button>
          )}
        </div>
      </div>
      <section className="filters knowledge-filters">
        <SearchInput
          id="article-search"
          label="ค้นหาบทความ"
          placeholder="ค้นหาชื่อบทความ เนื้อหา หรือหมวดหมู่"
          value={query}
          onChange={(value) => {
            setQuery(value);
            slice.setPage(1);
          }}
        />
        <FilterSelect
          id="article-filter-visibility"
          label="สิทธิ์การอ่านบทความ"
          any="ทุกสิทธิ์"
          value={visibility}
          onChange={setVisibility}
          options={Object.entries(visibilityLabels).map(([value, label]) => ({ value, label }))}
        />
        <FilterSelect
          id="article-sort"
          label="เรียงลำดับบทความ"
          value={sort}
          onChange={(value) => setSort(value as ArticleSort)}
          options={Object.entries(articleSorts).map(([value, label]) => ({ value, label }))}
        />
        <span className="muted article-count" role="status">
          {visible.length} บทความ
        </span>
      </section>
      <div className="filter-pills knowledge-tags" role="group" aria-label="หมวดหมู่บทความ">
        {pills.map((value) => (
          <FilterPill
            key={value || '*'}
            value={value}
            label={value || 'ทั้งหมด'}
            pressed={category === value}
            count={value ? counts.get(value) : articles.length}
            onClick={(next) => {
              setCategory(next);
              slice.setPage(1);
            }}
          />
        ))}
      </div>
      <div className="article-grid" id="articles-grid">
        {slice.shown.length ? (
          slice.shown.map((a) => <ArticleCard key={a.id} article={a} onOpen={read} />)
        ) : (
          <EmptyState title="ไม่พบบทความ" description="ลองเปลี่ยนคำค้นหรือเลือกหมวด “ทั้งหมด”" icon="book" />
        )}
      </div>
      <div id="articles-pager">
        <Pager slice={slice} unit="บทความ" sizes={[12, 24, 48]} />
      </div>
    </>
  );
}
