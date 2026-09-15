'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/filters';
import { ARTICLES_PATH, type Article, type ArticlesPage } from '@/features/knowledge';
import { plainText } from '@/lib/format';
import { channelNames } from '@/lib/labels';
import { useApi } from '@/lib/query';

/* Knowledge search from the composer: find an article and send its public link in one click, or put its text in
   the draft. Markup: pages/inbox/knowledge-search, knowledge-row. */

export function KnowledgeSearch({
  channel,
  onSendLink,
  onInsert,
  onRead,
}: {
  channel: string;
  onSendLink: (article: Article) => Promise<void>;
  onInsert: (article: Article) => void;
  onRead: (article: Article) => void;
}) {
  const articles = useApi<ArticlesPage>(ARTICLES_PATH);
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const run = useRunAction();
  const canReply = channel !== 'manual';

  useEffect(() => {
    // After the dialog opens (it focuses its close button first), start in the search box.
    const frame = requestAnimationFrame(() => document.getElementById('kb-search')?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const q = query.trim().toLowerCase();
  const found = (articles.data?.articles ?? [])
    .filter((a) => !q || [a.title, a.body, a.category].some((v) => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => Number(b.visibility === 'public') - Number(a.visibility === 'public'))
    .slice(0, 30);
  const via = channelNames[channel] || '';

  return (
    <div className="kb-search">
      <SearchInput id="kb-search" label="ค้นหาบทความ" placeholder="ค้นหาชื่อบทความ เนื้อหา หรือหมวดหมู่" value={query} onChange={setQuery} />
      <p className="tiny muted">
        “ส่งลิงก์ให้ลูกค้า” ส่งทันทีในบทสนทนานี้{via && `ผ่าน ${via}`} ใช้ได้กับบทความที่เผยแพร่ให้ลูกค้า ลูกค้าเปิดอ่านได้ในหน้าลูกค้าโดยไม่ต้องเข้าสู่ระบบ
      </p>
      <div id="kb-results" className="kb-list">
        {articles.error ? (
          <ErrorState error={articles.error} onRetry={() => void articles.refetch()} />
        ) : !articles.data ? (
          <PageLoading />
        ) : found.length ? (
          found.map((a) => {
            const isPublic = a.visibility === 'public';
            return (
              <article className="kb-row" key={a.id}>
                <div className="grow">
                  <div className="kb-title">
                    <strong>{a.title}</strong>
                    <span className="badge article-category">{a.category}</span>
                    {isPublic ? <span className="badge resolved">เผยแพร่ให้ลูกค้า</span> : <span className="badge closed">ภายในองค์กร</span>}
                  </div>
                  <p className="kb-excerpt">{plainText(a.body).slice(0, 160)}</p>
                </div>
                <div className="kb-actions">
                  {canReply && isPublic && (
                    <button
                      type="button"
                      className="btn sm primary"
                      disabled={sending === a.id}
                      onClick={() =>
                        run(async () => {
                          setSending(a.id);
                          try {
                            await onSendLink(a);
                          } finally {
                            setSending(null);
                          }
                        })
                      }
                    >
                      <Icon name="send" />
                      ส่งลิงก์ให้ลูกค้า
                    </button>
                  )}
                  <button type="button" className="btn sm" onClick={() => run(() => onInsert(a))}>
                    <Icon name="file" />
                    แทรกเนื้อหา
                  </button>
                  <button type="button" className="btn sm subtle" onClick={() => onRead(a)}>
                    อ่าน
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <EmptyState title="ไม่พบบทความ" description="ลองคำค้นอื่น หรือเพิ่มบทความในคลังความรู้" icon="book" />
        )}
      </div>
    </div>
  );
}
