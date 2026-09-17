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
import {
  deleteGlobalArticle,
  discardGlobalChanges,
  GLOBAL_FAQ_PATH,
  PLATFORM_PREFIX,
  publishGlobalArticle,
  saveGlobalArticle,
  unpublishGlobalArticle,
} from './api';
import { articleStateHints, articleStateLabels, articleStates, audienceHints, audienceLabels, audiences } from './labels';
import type { GlobalArticle, GlobalAudience, GlobalFaqFilters, GlobalFaqPage } from './types';

/* Platform console, FAQ กลาง: articles written once and shown to their audience in every organization - the
   platform team (here only), the admins and staff of organizations (คู่มือจาก Bookdose), or end customers
   (คำถามที่พบบ่อย on the customer side). A mistake would show everywhere at once, so saving keeps a draft: a new
   article reaches nobody, and changes to a published one wait beside it, until "เผยแพร่". Markup:
   pages/platform/global-*.html, the knowledge base's editor pieces. */

// What else shows these articles: the staff guides and the customers' FAQ.
const FAQ_READERS = [PLATFORM_PREFIX, '/api/guides', '/api/public', '/api/customer/faq'];

export function GlobalFaqScreen() {
  const faq = useApi<GlobalFaqPage>(GLOBAL_FAQ_PATH);
  if (faq.isPending) return <PageLoading />;
  if (faq.error) return <ErrorState error={faq.error} onRetry={() => void faq.refetch()} />;
  return <GlobalFaqView articles={faq.data.articles} />;
}

function StateBadge({ article }: { article: GlobalArticle }) {
  return <span className={`badge article-state-${article.state}`}>{articleStateLabels[article.state]}</span>;
}

function GlobalFaqView({ articles }: { articles: GlobalArticle[] }) {
  const [f, setFilters] = useUiState<GlobalFaqFilters>('global-faq:filters', {});
  const { openModal } = useDialogs();
  const count = (key: string) => articles.filter((a) => !key || a.audience === key).length;
  const term = (f.q || '').toLowerCase();
  const visible = articles.filter(
    (a) =>
      (!f.audience || a.audience === f.audience) &&
      (!f.state || a.state === f.state) &&
      (!term || [a.title, a.body, a.category].some((v) => String(v || '').toLowerCase().includes(term))),
  );
  const unpublished = articles.filter((a) => a.state !== 'published').length;
  const categories = [...new Set(articles.map((a) => a.category))];
  const openForm = (article?: GlobalArticle) =>
    openModal(article ? 'แก้ไขบทความ FAQ กลาง' : 'เขียนบทความ FAQ กลาง', <GlobalArticleForm article={article} categories={categories} />, { wide: true });
  const read = (article: GlobalArticle) => openModal(article.title, <GlobalArticleRead article={article} onEdit={() => openForm(article)} />);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>FAQ กลาง</h1>
          <p>
            เขียนครั้งเดียว แสดงให้ผู้อ่านที่เลือกในทุกองค์กรเมื่อเผยแพร่ · {articles.length} บทความ
            {unpublished ? ` · รอเผยแพร่ ${unpublished}` : ''}
          </p>
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
        <div className="filter-pills" role="group" aria-label="สถานะการเผยแพร่">
          {(['', ...articleStates] as const).map((key) => (
            <FilterPill
              key={key}
              value={key}
              label={key ? articleStateLabels[key] : 'ทุกสถานะ'}
              pressed={(f.state || '') === key}
              count={articles.filter((a) => !key || a.state === key).length}
              warning={key === 'draft' || key === 'changed'}
              onClick={(state) => setFilters({ ...f, state })}
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
              badge={
                <>
                  <span className={`badge audience-badge audience-${a.audience}`}>{audienceLabels[a.audience]}</span>
                  <StateBadge article={a} />
                </>
              }
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
          <EmptyState title="ไม่พบบทความ" description="ลองเปลี่ยนคำค้น หรือเลือกผู้อ่านและสถานะ “ทั้งหมด”" icon="book" />
        )}
      </div>
    </>
  );
}

/** Where readers find it: "ลูกค้าทุกองค์กร" and so on, from the audience hint. */
const readersOf = (audience: GlobalAudience) => audienceHints[audience].replace('แสดงใน', '');

function GlobalArticleRead({ article: a, onEdit }: { article: GlobalArticle; onEdit: () => void }) {
  const { confirm, closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const act = (options: { title: string; message: string; confirmLabel: string; danger?: boolean; done: string; run: () => Promise<unknown> }) =>
    confirm({
      title: options.title,
      message: options.message,
      cancelLabel: 'ยกเลิก',
      confirmLabel: options.confirmLabel,
      tone: options.danger ? 'danger' : 'primary',
      run: async () => {
        await options.run();
        closeModal(true);
        toast(options.done);
        await refresh(...FAQ_READERS);
      },
    });
  const publish = () =>
    act({
      title: a.state === 'changed' ? 'เผยแพร่การแก้ไข' : 'เผยแพร่บทความ',
      message: `“${a.title}” จะ${audienceHints[a.audience]}ทันที ตรวจเนื้อหาและผู้อ่านให้ถูกต้องก่อนเผยแพร่`,
      confirmLabel: 'เผยแพร่',
      done: `เผยแพร่แล้ว · ${audienceHints[a.audience]}`,
      run: () => publishGlobalArticle(a.id),
    });
  return (
    <>
      <div className="article-meta">
        <span className="badge">
          <Icon name="book" /> {a.category}
        </span>
        <span className={`badge audience-badge audience-${a.audience}`}>{audienceLabels[a.audience]}</span>
        <StateBadge article={a} />
        <span className="muted">
          <Icon name="clock" /> อัปเดต {date(a.updated_at, true)}
          {a.published_at ? ` · เผยแพร่ ${date(a.published_at, true)}` : ''}
        </span>
      </div>
      <div className={`notice article-state-note${a.state === 'published' ? '' : ' warning'}`}>{articleStateHints[a.state]}</div>
      <p className="small muted">{audienceHints[a.audience]}</p>
      <Markdown className="article-content" text={a.body} />
      {a.live && (
        <details className="article-live">
          <summary>ฉบับที่ผู้อ่านเห็นอยู่ตอนนี้</summary>
          <p className="small muted">
            {a.live.title} · {a.live.category} · {audienceLabels[a.live.audience]}
          </p>
          <Markdown className="article-content" text={a.live.body} />
        </details>
      )}
      <div className="form-actions wrap">
        {a.state !== 'published' && (
          <button type="button" className="btn primary" onClick={publish}>
            <Icon name="send" />
            {a.state === 'changed' ? 'เผยแพร่การแก้ไข' : 'เผยแพร่'}
          </button>
        )}
        <button type="button" className="btn" onClick={onEdit}>
          <Icon name="edit" />
          แก้ไขบทความ
        </button>
        {a.state === 'changed' && (
          <button
            type="button"
            className="btn"
            onClick={() =>
              act({
                title: 'ทิ้งการแก้ไข',
                message: `การแก้ไขที่ยังไม่เผยแพร่ของ “${a.live?.title ?? a.title}” จะหายไป ผู้อ่านยังเห็นฉบับเดิม`,
                confirmLabel: 'ทิ้งการแก้ไข',
                danger: true,
                done: 'ทิ้งการแก้ไขแล้ว กลับเป็นฉบับที่เผยแพร่อยู่',
                run: () => discardGlobalChanges(a.id),
              })
            }
          >
            <Icon name="restore" />
            ทิ้งการแก้ไข
          </button>
        )}
        {a.state !== 'draft' && (
          <button
            type="button"
            className="btn"
            onClick={() =>
              act({
                title: 'ยกเลิกการเผยแพร่',
                message: `“${a.title}” จะหายจาก${readersOf(a.live?.audience ?? a.audience)}ทันที และกลับเป็นร่าง${a.state === 'changed' ? ' พร้อมการแก้ไขล่าสุด' : ''}`,
                confirmLabel: 'ยกเลิกการเผยแพร่',
                danger: true,
                done: 'ยกเลิกการเผยแพร่แล้ว บทความกลับเป็นร่าง',
                run: () => unpublishGlobalArticle(a.id),
              })
            }
          >
            <Icon name="eyeOff" />
            ยกเลิกการเผยแพร่
          </button>
        )}
        <button
          type="button"
          className="btn danger"
          onClick={() =>
            act({
              title: 'ลบบทความ FAQ กลาง',
              message:
                a.state === 'draft'
                  ? `ร่าง “${a.title}” จะถูกลบ และกู้คืนไม่ได้`
                  : `“${a.title}” จะหายจาก${readersOf(a.live?.audience ?? a.audience)}ทันที และกู้คืนไม่ได้`,
              confirmLabel: 'ลบบทความ',
              danger: true,
              done: 'ลบบทความแล้ว',
              run: () => deleteGlobalArticle(a.id),
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
  const published = Boolean(article?.published_at);
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
        toast(published ? 'บันทึกการแก้ไขแล้ว · ผู้อ่านยังเห็นฉบับเดิมจนกว่าจะกดเผยแพร่' : 'บันทึกร่างแล้ว · ยังไม่มีใครเห็นจนกว่าจะกดเผยแพร่');
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
            <small className="muted">
              {published ? 'การแก้ไขเก็บเป็นร่าง ผู้อ่านยังเห็นฉบับเดิมจนกว่าจะกดเผยแพร่การแก้ไข' : 'บันทึกเป็นร่างก่อน ผู้อ่านจะเห็นเมื่อกดเผยแพร่'}
            </small>
          </div>
        }
      />
      <FormActions label={published ? 'บันทึกการแก้ไข (ยังไม่เผยแพร่)' : 'บันทึกร่าง'} onCancel={() => closeModal()} />
    </Form>
  );
}
