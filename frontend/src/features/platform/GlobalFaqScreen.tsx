'use client';

import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { FilterPill, SearchInput } from '@/components/ui/filters';
import { Form } from '@/components/ui/Form';
import { FormActions } from '@/components/ui/fields';
import { useToast } from '@/components/ui/Toast';
import { ArticleCardFrame, ArticleEditorFields } from '@/features/knowledge';
import { Markdown } from '@/features/rich/Markdown';
import { useRichEditor } from '@/features/rich/RichEditor';
import { date, relative } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { useUiState } from '@/lib/ui-state';
import { deleteGlobalArticle, GLOBAL_FAQ_PATH, PLATFORM_PREFIX, saveGlobalArticle } from './api';
import { audienceHints, audienceLabels, audiences } from './labels';
import type { GlobalArticle, GlobalAudience, GlobalFaqFilters, GlobalFaqPage } from './types';

/* Platform console, FAQ กลาง: articles written once and shown to their audience in every organization - the
   platform team (here only), the admins and staff of organizations (คู่มือจาก Bookdose), or end customers
   (คำถามที่พบบ่อย on the customer side). Markup: pages/platform/global-*.html, the knowledge base's editor pieces. */

// What else shows these articles: the staff guides and the customers' FAQ.
const FAQ_READERS = [PLATFORM_PREFIX, '/api/guides', '/api/public'];

export function GlobalFaqScreen() {
  const faq = useApi<GlobalFaqPage>(GLOBAL_FAQ_PATH);
  if (faq.isPending) return <PageLoading />;
  if (faq.error) return <ErrorState error={faq.error} onRetry={() => void faq.refetch()} />;
  return <GlobalFaqView articles={faq.data.articles} />;
}

function GlobalFaqView({ articles }: { articles: GlobalArticle[] }) {
  const [f, setFilters] = useUiState<GlobalFaqFilters>('global-faq:filters', {});
  const { openModal } = useDialogs();
  const count = (key: string) => articles.filter((a) => !key || a.audience === key).length;
  const term = (f.q || '').toLowerCase();
  const visible = articles.filter(
    (a) => (!f.audience || a.audience === f.audience) && (!term || [a.title, a.body, a.category].some((v) => String(v || '').toLowerCase().includes(term))),
  );
  const categories = [...new Set(articles.map((a) => a.category))];
  const openForm = (article?: GlobalArticle) =>
    openModal(article ? 'แก้ไขบทความ FAQ กลาง' : 'เขียนบทความ FAQ กลาง', <GlobalArticleForm article={article} categories={categories} />, { wide: true });
  const read = (article: GlobalArticle) => openModal(article.title, <GlobalArticleRead article={article} onEdit={() => openForm(article)} />);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>FAQ กลาง</h1>
          <p>เขียนครั้งเดียว แสดงให้ผู้อ่านที่เลือกในทุกองค์กร · {articles.length} บทความ</p>
        </div>
        <div className="flex">
          <button type="button" className="btn primary" onClick={() => openForm()}>
            <Icon name="plus" />
            เขียนบทความ
          </button>
        </div>
      </div>
      <div className="audience-guide">
        {audiences.map((key) => (
          <div key={key} className={`audience-item audience-${key}`}>
            <strong>
              {audienceLabels[key]}
              <span className="tag-count">{count(key)}</span>
            </strong>
            <span className="muted">{audienceHints[key]}</span>
          </div>
        ))}
      </div>
      <section className="filters knowledge-filters">
        <SearchInput
          id="global-faq-search"
          label="ค้นหาบทความ"
          placeholder="ค้นหาชื่อ เนื้อหา หรือหมวดหมู่"
          value={f.q || ''}
          onChange={(q) => setFilters({ ...f, q })}
        />
        <div className="filter-pills" role="group" aria-label="ผู้อ่านบทความ">
          {(['', ...audiences] as const).map((key) => (
            <FilterPill
              key={key}
              value={key}
              label={key ? audienceLabels[key] : 'ทั้งหมด'}
              pressed={(f.audience || '') === key}
              count={count(key)}
              onClick={(audience) => setFilters({ ...f, audience })}
            />
          ))}
        </div>
      </section>
      <div className="article-grid" id="global-faq-list">
        {visible.length ? (
          visible.map((a) => (
            <ArticleCardFrame
              key={a.id}
              id={a.id}
              title={a.title}
              category={a.category}
              badge={<span className={`badge audience-badge audience-${a.audience}`}>{audienceLabels[a.audience]}</span>}
              body={a.body}
              previewLimit={200}
              foot={
                <>
                  อัปเดต {relative(a.updated_at)} · {a.author}
                </>
              }
              onOpen={() => read(a)}
            />
          ))
        ) : (
          <EmptyState title="ไม่พบบทความ" description="ลองเปลี่ยนคำค้น หรือเลือกผู้อ่าน “ทั้งหมด”" icon="book" />
        )}
      </div>
    </>
  );
}

function GlobalArticleRead({ article: a, onEdit }: { article: GlobalArticle; onEdit: () => void }) {
  const { confirm, closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <>
      <div className="article-meta">
        <span className="badge">
          <Icon name="book" /> {a.category}
        </span>
        <span className={`badge audience-badge audience-${a.audience}`}>{audienceLabels[a.audience]}</span>
        <span className="muted">
          <Icon name="clock" /> อัปเดต {date(a.updated_at, true)}
        </span>
      </div>
      <p className="small muted">{audienceHints[a.audience]}</p>
      <Markdown className="article-content" text={a.body} />
      <div className="form-actions wrap">
        <button type="button" className="btn" onClick={onEdit}>
          <Icon name="edit" />
          แก้ไขบทความ
        </button>
        <button
          type="button"
          className="btn danger"
          onClick={() =>
            confirm({
              title: 'ลบบทความ FAQ กลาง',
              message: `“${a.title}” จะหายจาก${audienceHints[a.audience].replace('แสดงใน', '')}ทันที และกู้คืนไม่ได้`,
              cancelLabel: 'ยกเลิก',
              confirmLabel: 'ลบบทความ',
              tone: 'danger',
              run: async () => {
                await deleteGlobalArticle(a.id);
                closeModal(true);
                toast('ลบบทความแล้ว');
                await refresh(...FAQ_READERS);
              },
            })
          }
        >
          <Icon name="trash" />
          ลบบทความ
        </button>
      </div>
    </>
  );
}

function GlobalArticleForm({ article, categories }: { article?: GlobalArticle; categories: string[] }) {
  const editor = useRichEditor();
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      data-form="global-article"
      data-id={article?.id ?? ''}
      className="article-editor"
      onSubmit={async (values) => {
        const audience = (values.audience || 'customer') as GlobalAudience;
        await saveGlobalArticle(article?.id, {
          title: values.title ?? '',
          category: values.category ?? '',
          body: values.body ?? '',
          audience,
        });
        closeModal(true);
        toast(`บันทึกแล้ว · ${audienceHints[audience] ?? ''}`);
        await refresh(...FAQ_READERS);
      }}
    >
      <ArticleEditorFields
        editor={editor}
        title={article?.title}
        titlePlaceholder="เช่น วิธีเปลี่ยนรหัสผ่าน"
        category={article?.category}
        categories={categories}
        body={article?.body}
        aside={
          <div className="field">
            <label htmlFor="article-audience">ผู้อ่าน</label>
            <select id="article-audience" name="audience" defaultValue={article?.audience || 'customer'}>
              {audiences.map((key) => (
                <option key={key} value={key}>
                  {audienceLabels[key]}
                </option>
              ))}
            </select>
            <small className="muted">บทความแสดงให้ผู้อ่านนี้ในทุกองค์กรทันทีที่บันทึก</small>
          </div>
        }
      />
      <FormActions label="บันทึกบทความ" onCancel={() => closeModal()} />
    </Form>
  );
}
