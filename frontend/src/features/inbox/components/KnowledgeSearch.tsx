'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { SearchInput } from '@/components/ui/filters';
import { ARTICLES_PATH, Highlighted, helpfulRate, recordUse, searchArticles, type Article, type ArticlesPage } from '@/features/knowledge';
import { plainText } from '@/lib/format';
import { channelNames } from '@/lib/labels';
import { useApi } from '@/lib/query';

/* Knowledge search from the composer: find an article and send its public link in one click, or put its text in
   the draft. Typed the way a customer asks ("ลืมรหัสทำยังไง"), it finds the article that answers and shows the
   sentence that does. Before typing: the member's pins, then what the team uses most. Sending or inserting counts
   as a use of the article. Markup: pages/inbox/knowledge-search, knowledge-row. */

export function KnowledgeSearch({
  channel,
  onSendLink,
  onInsert,
  onRead,
}: {
  channel: string;
  onSendLink: (article: Article) => Promise<void>;
  onInsert: (article: Article) => void;
  onRead: (article: Article, words: string[]) => void;
}) {
  const articles = useApi<ArticlesPage>(ARTICLES_PATH);
  const client = useQueryClient();
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const run = useRunAction();
  const canReply = channel !== 'manual';

  useEffect(() => {
    // After the dialog opens (it focuses its close button first), start in the search box.
    const frame = requestAnimationFrame(() => document.getElementById('kb-search')?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const list = articles.data?.articles ?? [];
  const hits = searchArticles(list, query);
  const found = hits
    ? hits.slice(0, 30)
    : [...list]
        .sort(
          (a, b) =>
            (a.pin_order || 99) - (b.pin_order || 99) ||
            (b.uses ?? 0) - (a.uses ?? 0) ||
            Number(b.visibility === 'public') - Number(a.visibility === 'public'),
        )
        .slice(0, 30)
        .map((article) => ({ article, words: [] as string[], passage: '' }));
  const via = channelNames[channel] || '';

  return (
    <div className="kb-search">
      <SearchInput id="kb-search" label="ค้นหาบทความ" placeholder="พิมพ์แบบที่ลูกค้าถาม เช่น “ลืมรหัสทำยังไง”" value={query} onChange={setQuery} />
      <p className="tiny muted">
        “ส่งลิงก์ให้ลูกค้า” ส่งทันทีในบทสนทนานี้{via && `ผ่าน ${via}`} ใช้ได้กับบทความที่เผยแพร่ให้ลูกค้า ลูกค้าเปิดอ่านได้ในหน้าลูกค้าโดยไม่ต้องเข้าสู่ระบบ
      </p>
      <div id="kb-results" className="kb-list">
        {articles.error ? (
          <ErrorState error={articles.error} onRetry={() => void articles.refetch()} />
        ) : !articles.data ? (
          <PageLoading />
        ) : found.length ? (
          found.map(({ article: a, words, passage }) => {
            const isPublic = a.visibility === 'public';
            const rate = helpfulRate(a);
            return (
              <article className="kb-row" key={a.id}>
                <div className="grow">
                  <div className="kb-title">
                    {a.pin_order ? <Icon name="pin" className="kb-pinned" /> : null}
                    <strong>
                      <Highlighted text={a.title} words={words} />
                    </strong>
                    <span className="badge article-category">{a.category}</span>
                    {isPublic ? <span className="badge resolved">เผยแพร่ให้ลูกค้า</span> : <span className="badge closed">ภายในองค์กร</span>}
                  </div>
                  <p className="kb-excerpt">
                    {passage ? <Highlighted text={passage} words={words} /> : plainText(a.body).slice(0, 160)}
                  </p>
                  {a.uses || rate !== null ? (
                    <span className="kb-stats">
                      {a.uses ? `ใช้ตอบ ${a.uses} ครั้ง` : ''}
                      {a.uses && rate !== null ? ' · ' : ''}
                      {rate !== null ? `ช่วยได้ ${rate}%` : ''}
                    </span>
                  ) : null}
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
                            recordUse(client, a.id, 'link');
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
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() =>
                      run(async () => {
                        await onInsert(a);
                        recordUse(client, a.id, 'insert');
                      })
                    }
                  >
                    <Icon name="file" />
                    แทรกเนื้อหา
                  </button>
                  <button type="button" className="btn sm subtle" onClick={() => onRead(a, words)}>
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
