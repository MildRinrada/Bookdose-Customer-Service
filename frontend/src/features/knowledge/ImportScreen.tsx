'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { Markdown } from '@/features/rich/Markdown';
import { useApi, useInvalidate } from '@/lib/query';
import { ARTICLE_PREFIXES, ARTICLES_PATH, discardImport, IMPORTS_PATH, importPath, rewriteDraft, saveDrafts, setDraft, skipImportAi, type DraftAction } from './api';
import { ArticleForm } from './components/ArticleEditor';
import { ArticlePreview } from './components/ArticlePreview';
import { rewriteErrors, visibilityLabels } from './labels';
import type { ArticleImport, ArticlesPage, ImportDraft } from './types';

/* ตรวจร่างจากไฟล์ (/knowledge/import/<id>): the drafts a file made (backend/modules/knowledge/importer.py), each
   checked, edited, rewritten by the AI on request, saved or left out. The page asks again every two seconds while the
   AI is at work. Saving the last draft ends the import and goes back to the knowledge page. */

const busy = (found: ArticleImport | undefined) =>
  Boolean(found && (found.ai.state === 'grouping' || found.drafts.some((d) => d.rewrite?.status === 'pending')));

/** Ticked to begin with: what reads as an article of its own, whole, and new to the knowledge base. */
const pickedFirst = (d: ImportDraft) => d.state === 'open' && !d.duplicate && !d.suggest_skip && !d.unknown;

export function ImportScreen({ id }: { id: string }) {
  const path = importPath(id);
  const page = useApi<ArticleImport>(path, { refetchInterval: (data) => (busy(data as ArticleImport | undefined) ? 2000 : false) });
  const articles = useApi<ArticlesPage>(ARTICLES_PATH);
  const client = useQueryClient();
  const refresh = useInvalidate();
  const router = useRouter();
  const toast = useToast();
  const { confirm, openModal } = useDialogs();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  if (page.isPending) return <PageLoading />;
  if (page.error)
    return page.error.status === 404 ? (
      <EmptyState title="ไม่พบไฟล์ที่นำเข้านี้" description={page.error.message} icon="file">
        <Link className="btn" href="/knowledge">
          กลับไปคลังความรู้
        </Link>
      </EmptyState>
    ) : (
      <ErrorState error={page.error} onRetry={() => void page.refetch()} />
    );

  const found = page.data;
  const grouping = found.ai.state === 'grouping';
  const open = found.drafts.filter((d) => d.state === 'open');
  const isPicked = (d: ImportDraft) => d.state === 'open' && (picked[d.id] ?? pickedFirst(d));
  const chosen = open.filter(isPicked);
  const lost = open.reduce((sum, d) => sum + d.unknown, 0);
  const categories = [...new Set((articles.data?.articles ?? []).map((a) => a.category))];
  const keep = (next: ArticleImport) => client.setQueryData([path], next);
  const fail = (error: unknown) => toast(error instanceof Error ? error.message : String(error), true);

  const afterSave = async (finished: boolean, count: number) => {
    toast(`บันทึก ${count} บทความแล้ว`);
    await refresh(...ARTICLE_PREFIXES, IMPORTS_PATH);
    if (finished) router.push('/knowledge');
  };

  const saveChosen = async () => {
    setSaving(true);
    try {
      const answer = await saveDrafts(id, chosen.map((d) => ({ draft_id: d.id })));
      await afterSave(answer.finished, answer.saved.length);
    } catch (error) {
      fail(error);
    } finally {
      setSaving(false);
    }
  };

  const act = (draft: ImportDraft, action: DraftAction) => setDraft(id, draft.id, action).then(keep, fail);

  return (
    <>
      <Link className="back-link" href="/knowledge">
        <Icon name="back" />
        คลังความรู้
      </Link>
      <div className="page-heading">
        <div>
          <h1>ตรวจร่างจากไฟล์</h1>
          <p>
            {found.file_name}, {found.drafts.length} ร่าง, เหลือตรวจ {open.length} ร่าง
          </p>
        </div>
        <div className="flex">
          <button
            type="button"
            className="btn danger"
            onClick={() =>
              confirm({
                title: 'ทิ้งการนำเข้านี้?',
                message: 'ร่างที่ยังไม่ได้บันทึกจะหายไปทั้งหมด บทความที่บันทึกจากไฟล์นี้แล้วยังอยู่ในคลังความรู้',
                confirmLabel: 'ทิ้งการนำเข้า',
                cancelLabel: 'กลับไปตรวจต่อ',
                tone: 'danger',
                run: async () => {
                  await discardImport(id);
                  await refresh(IMPORTS_PATH);
                  router.push('/knowledge');
                },
              })
            }
          >
            <Icon name="trash" />
            ทิ้งการนำเข้านี้
          </button>
        </div>
      </div>

      <ImportStatus found={found} onSkip={() => void skipImportAi(id).then(keep, fail)} />
      {found.notes.images > 0 && (
        <div className="notice">
          ไฟล์มีรูป {found.notes.images} รูป ระบบนำรูปเข้าไม่ได้ ใส่รูปเองจากลิงก์ HTTPS ได้ในหน้าแก้ไขของแต่ละบทความ
        </div>
      )}
      {lost > 0 && !grouping && (
        <div className="notice warning">
          มีตัวอักษรที่ไฟล์ทำหาย {lost} จุด แสดงเป็น � แก้ในหน้าแก้ไขก่อนบันทึก ร่างที่มีจุดนี้จึงไม่ได้เลือกไว้ให้
        </div>
      )}

      {!grouping && (
        <>
          <div className="import-toolbar">
            <span className="muted" role="status">
              เลือก {chosen.length} จาก {open.length} ร่าง
            </span>
            <button type="button" className="btn sm subtle" onClick={() => setPicked(Object.fromEntries(open.map((d) => [d.id, true])))}>
              เลือกทั้งหมด
            </button>
            <button type="button" className="btn sm subtle" onClick={() => setPicked(Object.fromEntries(open.map((d) => [d.id, false])))}>
              ไม่เลือกเลย
            </button>
            <button type="button" className="btn primary" disabled={!chosen.length || saving} onClick={() => void saveChosen()}>
              <Icon name="check" />
              {saving ? 'กำลังบันทึก…' : `บันทึก ${chosen.length} บทความที่เลือก`}
            </button>
          </div>
          <div className="import-drafts">
            {found.drafts.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                aiReady={found.ai.available}
                picked={isPicked(draft)}
                onPick={(value) => setPicked((now) => ({ ...now, [draft.id]: value }))}
                onAction={(action) => void act(draft, action)}
                onRewrite={() => void rewriteDraft(id, draft.id).then(keep, fail)}
                onEdit={() =>
                  openModal(
                    'ตรวจและแก้ไขร่าง',
                    <ArticleForm
                      draft={{ title: draft.title, category: draft.category, body: draft.body, visibility: draft.visibility }}
                      categories={categories}
                      save={async (input) => {
                        const answer = await saveDrafts(id, [{ draft_id: draft.id, ...input }]);
                        void afterSave(answer.finished, answer.saved.length);
                        return { id: answer.saved[0]?.article_id ?? '' };
                      }}
                    />,
                    { wide: true },
                  )
                }
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** What the AI did, is doing, or why it did not. */
function ImportStatus({ found, onSkip }: { found: ArticleImport; onSkip: () => void }) {
  const { state, note, progress } = found.ai;
  if (state === 'grouping') {
    const where = !progress
      ? 'กำลังส่งให้ AI'
      : progress.ahead
        ? `รอคิว AI อีก ${progress.ahead} งาน`
        : progress.running_seconds !== null
          ? `AI อ่านมาแล้ว ${progress.running_seconds} วินาที (นานสุด ${progress.limit_seconds} วินาที)`
          : 'รอ AI เริ่มอ่าน';
    return (
      <div className="notice import-status" role="status">
        <span>
          AI กำลังจัดกลุ่ม ตั้งชื่อ และเลือกหมวดให้ {found.notes.sections} ส่วนของไฟล์ {where}
        </span>
        <button type="button" className="btn sm" onClick={onSkip}>
          ไม่รอ AI
        </button>
      </div>
    );
  }
  if (state === 'done')
    return (
      <div className="notice" role="status">
        AI จัดกลุ่ม ตั้งชื่อ และเลือกหมวดให้แล้ว เนื้อหาเป็นคำในไฟล์ทุกคำ
        {found.notes.fixed ? ` และเติมวรรณยุกต์ที่ไฟล์ทำหายให้ ${found.notes.fixed} คำ ตรวจคำเหล่านั้นด้วย` : ''}
      </div>
    );
  return note ? <div className="notice">{note}</div> : null;
}

function DraftCard({
  draft,
  aiReady,
  picked,
  onPick,
  onAction,
  onRewrite,
  onEdit,
}: {
  draft: ImportDraft;
  aiReady: boolean;
  picked: boolean;
  onPick: (value: boolean) => void;
  onAction: (action: DraftAction) => void;
  onRewrite: () => void;
  onEdit: () => void;
}) {
  const rewrite = draft.rewrite;
  const done = draft.state !== 'open';
  const titleId = `draft-${draft.id}-title`;

  return (
    <section className={`card import-draft${done ? ' is-done' : ''}`} aria-labelledby={titleId}>
      <div className="import-draft-head">
        {!done && (
          <input type="checkbox" checked={picked} onChange={(e) => onPick(e.currentTarget.checked)} aria-labelledby={titleId} />
        )}
        <div className="grow">
          <h2 id={titleId}>{draft.title}</h2>
          <div className="import-draft-meta muted">
            <span>{draft.category}</span>
            <span>{visibilityLabels[draft.visibility]}</span>
            <span>จาก {draft.source}</span>
          </div>
          <div className="import-badges">
            {draft.state === 'saved' && <span className="badge resolved">บันทึกแล้ว</span>}
            {draft.state === 'skipped' && <span className="badge closed">ข้ามแล้ว</span>}
            {draft.duplicate && (
              <span className="badge pending_customer">
                อาจซ้ำกับ <Link href={`/knowledge/${draft.duplicate.id}`}>{draft.duplicate.title}</Link>
              </span>
            )}
            {draft.suggest_skip && draft.state === 'open' && <span className="badge closed">AI เห็นว่าไม่ใช่เนื้อหาบทความ</span>}
            {draft.unknown > 0 && <span className="badge suspended">อ่านไม่ออก {draft.unknown} จุด</span>}
            {draft.source_body && <span className="badge open">ใช้ฉบับที่ AI เรียบเรียง</span>}
          </div>
        </div>
      </div>

      {rewrite?.status === 'done' && !draft.source_body && draft.state === 'open' ? (
        <div className="import-compare">
          <div>
            <h3>คำในไฟล์</h3>
            <Markdown className="article-content" text={draft.body} />
          </div>
          <div>
            <h3>ฉบับที่ AI เรียบเรียง</h3>
            <Markdown className="article-content" text={rewrite.body} />
          </div>
          <div className="import-compare-actions">
            <button type="button" className="btn primary sm" onClick={() => onAction('use_rewrite')}>
              ใช้ฉบับที่ AI เรียบเรียง
            </button>
            <button type="button" className="btn sm" onClick={() => onAction('drop_rewrite')}>
              ใช้คำในไฟล์
            </button>
          </div>
        </div>
      ) : (
        <ArticlePreview body={draft.body} limit={420} />
      )}

      {rewrite?.status === 'pending' && (
        <p className="muted" role="status">
          AI กำลังเรียบเรียงร่างนี้…
        </p>
      )}
      {rewrite?.status === 'failed' && draft.state === 'open' && (
        <p className="file-error" role="alert">
          เรียบเรียงไม่สำเร็จ: {rewriteErrors[rewrite.error] ?? 'ส่งให้ AI ไม่สำเร็จ'} ร่างยังเป็นคำในไฟล์
        </p>
      )}

      <div className="import-draft-actions">
        {draft.state === 'saved' && draft.article_id ? (
          <Link className="btn sm" href={`/knowledge/${draft.article_id}`}>
            เปิดบทความ
          </Link>
        ) : draft.state === 'skipped' ? (
          <button type="button" className="btn sm" onClick={() => onAction('keep')}>
            เอากลับมา
          </button>
        ) : (
          <>
            <button type="button" className="btn sm" onClick={onEdit}>
              <Icon name="edit" />
              ตรวจและแก้ไข
            </button>
            {aiReady && !draft.source_body && rewrite?.status !== 'pending' && rewrite?.status !== 'done' && (
              <button type="button" className="btn sm" onClick={onRewrite}>
                <Icon name="sparkle" />
                ให้ AI เรียบเรียง
              </button>
            )}
            {draft.source_body && (
              <button type="button" className="btn sm" onClick={() => onAction('use_source')}>
                กลับไปใช้คำในไฟล์
              </button>
            )}
            <button type="button" className="btn sm subtle" onClick={() => onAction('skip')}>
              ข้าม
            </button>
          </>
        )}
      </div>
    </section>
  );
}
