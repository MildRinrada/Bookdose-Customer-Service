'use client';

import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { useRunAction } from '@/components/ui/actions';
import { Markdown } from '@/features/rich/Markdown';
import { date } from '@/lib/format';
import { useBoot, useWork } from '@/lib/session';
import { visibilityLabels } from '../labels';
import type { Article } from '../types';

/* An article opened from the knowledge base, in the modal. Markup: pages/knowledge/article-read.
   "แทรกในช่องร่างข้อความ" shows only when a composer is there to take it (onInsert). */

export function ArticleRead({
  article,
  onEdit,
  onDelete,
  onInsert,
}: {
  article: Article;
  onEdit: (article: Article) => void;
  onDelete: (article: Article) => void;
  onInsert?: (article: Article) => void;
}) {
  const toast = useToast();
  const run = useRunAction();
  const boot = useBoot();
  const work = useWork();
  const canEdit = work.role !== 'agent';
  const tenantId = boot.data?.tenant_id ?? work.tenant.id;
  return (
    <>
      <div className="article-meta">
        <span className="badge">
          <Icon name="book" /> {article.category}
        </span>
        <span className="badge">{visibilityLabels[article.visibility] || visibilityLabels.internal}</span>
        <span className="muted">
          <Icon name="clock" /> อัปเดต {date(article.updated_at, true)}
        </span>
      </div>
      <Markdown className="article-content" text={article.body} />
      <div className="form-actions wrap">
        <button
          type="button"
          className="btn"
          onClick={() =>
            run(async () => {
              await navigator.clipboard.writeText(article.body);
              toast('คัดลอกเนื้อหาแล้ว');
            })
          }
        >
          คัดลอกเนื้อหา
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            run(async () => {
              // Opening the link switches to this organization first when the reader belongs to it.
              await navigator.clipboard.writeText(`${window.location.origin}/knowledge/${article.id}?tenant=${tenantId}`);
              toast('คัดลอกลิงก์สำหรับผู้มีสิทธิ์เข้าองค์กรแล้ว');
            })
          }
        >
          คัดลอกลิงก์
        </button>
        {onInsert && (
          <button type="button" className="btn primary" onClick={() => run(() => onInsert(article))}>
            แทรกในช่องร่างข้อความ
          </button>
        )}
        {canEdit && (
          <>
            <button type="button" className="btn" onClick={() => onEdit(article)}>
              <Icon name="edit" />
              แก้ไขบทความ
            </button>
            <button type="button" className="btn danger" onClick={() => onDelete(article)}>
              <Icon name="close" />
              ลบบทความ
            </button>
          </>
        )}
      </div>
    </>
  );
}
