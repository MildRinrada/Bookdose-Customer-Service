'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { TemplateLibraryButton } from './components/TemplateLibrary';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { FilterPill, FilterSelect, SearchInput } from '@/components/ui/filters';
import { Pager, usePager } from '@/components/ui/Pager';
import { useToast } from '@/components/ui/Toast';
import { useApi } from '@/lib/query';
import { useBoot, useStaffLogout, useSwitchTenant, useWork } from '@/lib/session';
import { useUiState } from '@/lib/ui-state';
import { ARTICLES_PATH, savePins } from './api';
import { ArticleCard } from './components/ArticleCard';
import { ArticleHistory } from './components/ArticleHistory';
import { ArticleRead } from './components/ArticleRead';
import { PinnedShelf } from './components/PinnedShelf';
import { useArticleActions } from './components/useArticleActions';
import { articleSorts, reviewReason, visibilityLabels } from './labels';
import { searchArticles } from './search';
import type { Article, ArticleSort, ArticlesPage } from './types';

/** As many pins as the server keeps (backend/modules/knowledge/model.py PINS_MAX). */
const PINS_MAX = 20;

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
      : sort === 'used'
        ? (b.uses ?? 0) - (a.uses ?? 0) || String(b.used_at ?? '').localeCompare(String(a.used_at ?? ''))
        : sort === 'title'
          ? a.title.localeCompare(b.title, 'th')
          : a.category.localeCompare(b.category, 'th') || a.title.localeCompare(b.title, 'th'),
  );
}

/** The pill that shows only the articles to look over (labels.reviewReason). */
const REVIEW = ':review';

function KnowledgeList({ openId }: { openId?: string }) {
  const page = useApi<ArticlesPage>(ARTICLES_PATH);
  const work = useWork();
  const client = useQueryClient();
  const toast = useToast();
  const { openModal } = useDialogs();
  const { edit: openEditor, remove } = useArticleActions();
  const [query, setQuery] = useUiState('knowledge:query', '');
  const [category, setCategory] = useUiState('knowledge:category', '');
  const [visibility, setVisibility] = useUiState('knowledge:visibility', '');
  const [sort, setSort] = useUiState<ArticleSort>('knowledge:sort', 'updated');
  const readOnly = Boolean(work.read_only);

  const articles = page.data?.articles ?? [];
  const filtered = articles.filter(
    (a) => (!category || (category === REVIEW ? Boolean(reviewReason(a)) : a.category === category)) && (!visibility || a.visibility === visibility),
  );
  // A search lists the best answers first; otherwise the chosen order.
  const hits = searchArticles(filtered, query);
  const hitOf = new Map(hits?.map((h) => [h.article.id, h]));
  const visible = hits ? hits.map((h) => h.article) : sortArticles(filtered, sort);
  const slice = usePager('knowledge', visible, { size: 12 });
  const canWrite = work.role !== 'agent' && !readOnly;
  const pins = articles.filter((a) => a.pin_order).sort((a, b) => (a.pin_order ?? 0) - (b.pin_order ?? 0));

  const categoriesOf = (list: Article[]) => [...new Set(list.map((a) => a.category))];

  // The words the current search matched in each article, for the reader to mark.
  const matched = useRef(new Map<string, string[]>());
  useEffect(() => {
    matched.current = new Map([...hitOf].map(([id, h]) => [id, h.words]));
  });

  const arrange = useCallback(
    (ids: string[]) =>
      savePins(client, ids).catch((error: unknown) => toast(error instanceof Error ? error.message : String(error), true)),
    [client, toast],
  );
  const togglePin = useCallback(
    (article: Article) => {
      const current = (client.getQueryData<ArticlesPage>([ARTICLES_PATH])?.articles ?? [])
        .filter((a) => a.pin_order)
        .sort((a, b) => (a.pin_order ?? 0) - (b.pin_order ?? 0))
        .map((a) => a.id);
      if (current.includes(article.id)) return void arrange(current.filter((id) => id !== article.id));
      if (current.length >= PINS_MAX) return toast(`ปักหมุดได้สูงสุด ${PINS_MAX} บทความ เลิกปักหมุดบางบทความก่อน`, true);
      void arrange([...current, article.id]);
      toast(`ปักหมุด “${article.title}” ไว้บนสุดแล้ว`);
    },
    [arrange, client, toast],
  );

  // Reading, editing and deleting open over one another in the modal, as before; the functions refer to each other.
  const actions = useRef<{ read: (a: Article) => void; edit: (a?: Article) => void; remove: (a: Article) => void }>(null!);
  const history = useCallback(
    (article: Article) =>
      openModal(`ประวัติการแก้ไข · ${article.title}`, <ArticleHistory article={article} />, { wide: true }),
    [openModal],
  );
  const read = useCallback(
    (article: Article) =>
      openModal(
        article.title,
        <ArticleRead
          article={article}
          highlight={matched.current.get(article.id)}
          onEdit={(a) => actions.current.edit(a)}
          onDelete={(a) => actions.current.remove(a)}
          onPin={togglePin}
          onHistory={history}
        />,
      ),
    [openModal, togglePin, history],
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
  const toReview = articles.filter((a) => reviewReason(a)).length;
  const uses = articles.reduce((sum, a) => sum + (a.uses ?? 0), 0);
  const helpful = articles.reduce((sum, a) => sum + (a.helpful ?? 0), 0);
  const votes = helpful + articles.reduce((sum, a) => sum + (a.unhelpful ?? 0), 0);
  const top = [...articles].sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0))[0];
  const browsing = !query.trim() && !category;

  return (
    <>
      <section className="kb-hero" aria-labelledby="kb-title">
        <div className="kb-hero-main">
          <div className="kb-hero-head">
            <div>
              <h1 id="kb-title">คลังความรู้</h1>
              <p>คู่มือที่ทีมใช้ตอบคำถามและช่วยเหลือลูกค้า</p>
            </div>
            {canWrite && (
              <div className="kb-hero-actions">
                {/* The answers every organization needs anyway, written once by the Bookdose team: taking one is a
                    copy this organization owns and edits (features/knowledge/components/TemplateLibrary). */}
                <TemplateLibraryButton />
                <button type="button" className="btn kb-new primary" onClick={() => edit()}>
                  <Icon name="plus" />
                  เขียนบทความใหม่
                </button>
              </div>
            )}
          </div>
          <div className="kb-search-box">
            <SearchInput
              id="article-search"
              label="ค้นหาบทความ"
              placeholder="พิมพ์แบบที่ลูกค้าถาม เช่น “ลืมรหัสทำยังไง”"
              value={query}
              onChange={(value) => {
                setQuery(value);
                slice.setPage(1);
              }}
            />
            <span className="kb-search-hint">
              <Icon name="sparkle" />
              ค้นหาอัจฉริยะ: เข้าใจคำพูดทั่วไปและคำพ้อง แล้วไฮไลต์ส่วนที่ตอบได้
            </span>
          </div>
        </div>
        <dl className="kb-hero-stats">
          <div>
            <dt>บทความ</dt>
            <dd>{articles.length}</dd>
          </div>
          <div>
            <dt>ใช้ตอบลูกค้า</dt>
            <dd>
              {uses.toLocaleString('th-TH')}
              <small>ครั้ง</small>
            </dd>
          </div>
          <div>
            <dt>ทีมบอกว่าช่วยได้</dt>
            <dd>{votes ? `${Math.round((helpful / votes) * 100)}%` : <small className="kb-stat-empty">ยังไม่มีโหวต</small>}</dd>
          </div>
          <div className={toReview ? 'warn' : ''}>
            <dt>ควรตรวจทาน</dt>
            <dd>{toReview}</dd>
          </div>
          {top?.uses ? (
            <div className="kb-hero-top">
              <dt>ใช้บ่อยที่สุด</dt>
              <dd>
                <button type="button" onClick={() => read(top)}>
                  {top.title}
                </button>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>
      <section className="filters knowledge-filters">
        <FilterSelect
          id="article-filter-visibility"
          label="สิทธิ์การอ่านบทความ"
          any="ทุกสิทธิ์"
          value={visibility}
          onChange={setVisibility}
          options={Object.entries(visibilityLabels).map(([value, label]) => ({ value, label }))}
        />
        {hits ? (
          <span className="kb-relevance">
            <Icon name="sparkle" />
            เรียงตามความตรงกับคำค้น
          </span>
        ) : (
          <FilterSelect
            id="article-sort"
            label="เรียงลำดับบทความ"
            value={sort}
            onChange={(value) => setSort(value as ArticleSort)}
            options={Object.entries(articleSorts).map(([value, label]) => ({ value, label }))}
          />
        )}
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
        {toReview > 0 && (
          <FilterPill
            value={REVIEW}
            label="⚠ ควรตรวจทาน"
            warning
            pressed={category === REVIEW}
            count={toReview}
            onClick={(next) => {
              setCategory(category === next ? '' : next);
              slice.setPage(1);
            }}
          />
        )}
      </div>
      {browsing && pins.length > 0 && !readOnly && <PinnedShelf pins={pins} onOpen={read} onArrange={(ids) => void arrange(ids)} onUnpin={togglePin} />}
      <div className="article-grid" id="articles-grid">
        {slice.shown.length ? (
          slice.shown.map((a) => <ArticleCard key={a.id} article={a} hit={hitOf.get(a.id)} readOnly={readOnly} onOpen={read} onPin={togglePin} />)
        ) : (
          <EmptyState
            title="ไม่พบบทความ"
            description={query.trim() ? `ยังไม่มีบทความที่ตอบ “${query.trim()}” ลองใช้คำอื่น หรือเขียนบทความใหม่เรื่องนี้` : 'ลองเปลี่ยนคำค้นหรือเลือกหมวด “ทั้งหมด”'}
            icon="book"
          />
        )}
      </div>
      <div id="articles-pager">
        <Pager slice={slice} unit="บทความ" sizes={[12, 24, 48]} />
      </div>
    </>
  );
}
