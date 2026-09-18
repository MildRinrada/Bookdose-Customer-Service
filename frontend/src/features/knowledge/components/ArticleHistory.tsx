'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { date, relative } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import { ARTICLE_PREFIXES, revisionsPath, saveArticle } from '../api';
import { visibilityLabels } from '../labels';
import type { Article, ArticleRevision } from '../types';

/* ประวัติการแก้ไข: the versions an article had before each change, newest first. Opening one shows what differs
   from the article now, line by line (removed in red, added in green); an owner can put that version back - which
   is itself a change, so the current version is kept in the history too. Markup: pages/knowledge (article-history). */

type Line = { kind: 'same' | 'add' | 'del'; text: string };

/** The lines of `after` against `before`: kept, added and removed (the longest common run of lines). */
export function lineDiff(before: string, after: string): Line[] {
  const a = before.split('\n');
  const b = after.split('\n');
  // Very long articles: compare only what is enough to read (the table below grows as a × b).
  if (a.length * b.length > 400_000) return [...a.map((text) => ({ kind: 'del' as const, text })), ...b.map((text) => ({ kind: 'add' as const, text }))];
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const lines: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) lines.push({ kind: 'del', text: a[i++] });
    else lines.push({ kind: 'add', text: b[j++] });
  }
  while (i < a.length) lines.push({ kind: 'del', text: a[i++] });
  while (j < b.length) lines.push({ kind: 'add', text: b[j++] });
  return lines;
}

/** Long runs of unchanged lines fold to their edges, so the changes are what one reads. */
function folded(lines: Line[]) {
  const shown: (Line | { kind: 'fold'; count: number })[] = [];
  for (let i = 0; i < lines.length; ) {
    if (lines[i].kind !== 'same') {
      shown.push(lines[i++]);
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].kind === 'same') j++;
    const run = lines.slice(i, j);
    // Two lines of context next to a change; none before the first or after the last.
    const head = i === 0 ? 0 : 2;
    const tail = j === lines.length ? 0 : 2;
    if (run.length > head + tail + 1) shown.push(...run.slice(0, head), { kind: 'fold', count: run.length - head - tail }, ...run.slice(run.length - tail));
    else shown.push(...run);
    i = j;
  }
  return shown;
}

export function ArticleHistory({ article, onRestored }: { article: Article; onRestored?: () => void }) {
  const page = useApi<{ revisions: ArticleRevision[] }>(revisionsPath(article.id));
  const work = useWork();
  const { confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const [open, setOpen] = useState<string | null>(null);
  const canRestore = work.role !== 'agent' && !work.read_only;

  if (page.isPending) return <PageLoading />;
  if (page.error) return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  const revisions = page.data.revisions;

  const restore = (r: ArticleRevision) =>
    confirm({
      title: 'กู้คืนเวอร์ชันนี้',
      message: `บทความจะกลับไปเป็นเวอร์ชันของ ${r.author} (${date(r.saved_at, true)}) · เวอร์ชันปัจจุบันจะถูกเก็บไว้ในประวัติ กลับมาได้เสมอ`,
      confirmLabel: 'กู้คืน',
      run: async () => {
        await saveArticle(article.id, { title: r.title, category: r.category, body: r.body, visibility: r.visibility });
        await refresh(...ARTICLE_PREFIXES);
        toast('กู้คืนเวอร์ชันเดิมแล้ว');
        onRestored?.();
      },
    });

  return (
    <div className="article-history">
      <div className="history-now">
        <span className="history-dot now" />
        <div>
          <strong>เวอร์ชันปัจจุบัน</strong>
          <span className="muted">
            {article.author} · {date(article.updated_at, true)}
          </span>
        </div>
      </div>
      {revisions.length ? (
        <ol className="history-list">
          {revisions.map((r, index) => {
            const newer = index ? revisions[index - 1] : article;
            const isOpen = open === r.id;
            const changed = [
              r.title !== newer.title && 'ชื่อ',
              r.category !== newer.category && 'หมวดหมู่',
              r.visibility !== newer.visibility && 'สิทธิ์การอ่าน',
              r.body !== newer.body && 'เนื้อหา',
            ].filter(Boolean);
            return (
              <li key={r.id} className={isOpen ? 'open' : ''}>
                <span className="history-dot" />
                <div className="history-entry">
                  <button type="button" className="history-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                    <span>
                      <strong>{r.replaced_by}</strong> แก้{changed.length ? changed.join(' · ') : 'บทความ'}
                    </span>
                    <span className="muted" title={date(r.replaced_at, true)}>
                      {relative(r.replaced_at)}
                    </span>
                    <Icon name="down" />
                  </button>
                  {isOpen && (
                    <div className="history-detail">
                      <p className="muted small">
                        ก่อนแก้: เวอร์ชันของ {r.author} · {date(r.saved_at, true)} · {visibilityLabels[r.visibility] ?? r.visibility}
                        {r.title !== newer.title && (
                          <>
                            {' '}
                            · ชื่อเดิม “{r.title}”
                          </>
                        )}
                      </p>
                      <pre className="history-diff" aria-label="สิ่งที่เปลี่ยนไปในการแก้ครั้งนี้">
                        {folded(lineDiff(r.body, newer.body)).map((line, i) =>
                          line.kind === 'fold' ? (
                            <span key={i} className="fold">
                              ⋯ ไม่เปลี่ยน {line.count} บรรทัด
                            </span>
                          ) : (
                            <span key={i} className={line.kind}>
                              {line.kind === 'add' ? '+ ' : line.kind === 'del' ? '− ' : '  '}
                              {line.text || ' '}
                            </span>
                          ),
                        )}
                      </pre>
                      {canRestore && (
                        <button type="button" className="btn sm" onClick={() => restore(r)}>
                          <Icon name="restore" />
                          กู้คืนเวอร์ชันก่อนแก้นี้
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <EmptyState title="ยังไม่มีประวัติการแก้ไข" description="เมื่อมีการแก้ไขบทความ ระบบจะเก็บเวอร์ชันก่อนหน้าไว้ที่นี่ (สูงสุด 50 เวอร์ชัน)" icon="history" />
      )}
    </div>
  );
}
