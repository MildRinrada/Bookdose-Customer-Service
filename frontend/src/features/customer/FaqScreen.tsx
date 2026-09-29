'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { CustomerArticleRow, CustomerNone, EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { FilterPill, SearchInput } from '@/components/ui/filters';
import { Markdown } from '@/features/rich/Markdown';
import { date, plainText } from '@/lib/format';
import { useApi } from '@/lib/query';
import { useUiState } from '@/lib/ui-state';
import { FAQ_PATH } from './api';
import { ArticleFeedback } from './components/ArticleFeedback';
import { CustomerAsk } from './components/common';
import type { CustomerArticle } from './types';

/* คำถามที่พบบ่อย: the public articles of every organization the customer can contact, and the platform's own
   (pages/customer/customer-faq.html, customer-article-read.html). */

export function FaqScreen() {
  const query = useApi<{ articles: CustomerArticle[] }>(FAQ_PATH);
  const [search, setSearch] = useUiState('customer:faqQuery', '');
  const [faqOrg, setFaqOrg] = useUiState('customer:faqOrg', '');
  const [chosenCategory, setCategory] = useUiState('customer:faqCategory', '');
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <PageLoading />;
  const articles = query.data.articles;
  const orgs = [...new Map(articles.map((a) => [a.org_slug, a.org_name])).entries()];
  const categories = [...new Set(articles.filter((a) => !faqOrg || a.org_slug === faqOrg).map((a) => a.category))].sort((a, b) => a.localeCompare(b, 'th'));
  // A category of another organization no longer applies.
  const category = categories.includes(chosenCategory) ? chosenCategory : '';
  const term = search.trim().toLowerCase();
  const found = articles.filter(
    (a) =>
      (!faqOrg || a.org_slug === faqOrg) &&
      (!category || a.category === category) &&
      (!term || [a.title, a.body, a.category, a.org_name].some((v) => String(v || '').toLowerCase().includes(term))),
  );
  const searching = Boolean(search.trim() || category || faqOrg);
  const many = new Set(articles.map((a) => a.org_slug)).size > 1;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>คำถามที่พบบ่อย</h1>
          <p>คำตอบจากทุกองค์กรที่คุณติดต่อ อ่านได้ทันทีโดยไม่ต้องรอ</p>
        </div>
      </div>
      <section className="card customer-answers">
        <div className="card-body">
          <SearchInput id="customer-faq-search" label="ค้นหาคำตอบ" placeholder="ค้นหาคำตอบ เช่น ลืมรหัสผ่าน เปลี่ยนอีเมล" value={search} onChange={setSearch} />
          {orgs.length > 1 && (
            <div className="filter-pills" role="group" aria-label="องค์กร">
              {[['', 'ทุกองค์กร'] as [string, string], ...orgs].map(([value, label]) => (
                <FilterPill
                  key={value}
                  label={label}
                  value={value}
                  pressed={faqOrg === value}
                  count={value ? articles.filter((a) => a.org_slug === value).length : articles.length}
                  onClick={(v) => {
                    setFaqOrg(v);
                    setCategory('');
                  }}
                />
              ))}
            </div>
          )}
          {categories.length > 1 && (
            <div className="filter-pills" role="group" aria-label="หมวดหมู่บทความ">
              {['', ...categories].map((value) => (
                <FilterPill key={value} label={value || 'ทุกหมวด'} value={value} pressed={category === value} onClick={setCategory} />
              ))}
            </div>
          )}
          <p className="muted customer-article-count" id="customer-article-count" role="status">
            {found.length} บทความ
          </p>
          <div className="customer-article-list" id="customer-articles">
            {found.length ? (
              found.map((a) => (
                <CustomerArticleRow
                  key={`${a.org_slug}:${a.id}`}
                  href={`/customer/faq/${a.id}`}
                  title={a.title}
                  category={many ? `${a.org_name} · ${a.category}` : a.category}
                  excerpt={plainText(a.body).slice(0, 140)}
                />
              ))
            ) : (
              <CustomerNone
                title={searching ? 'ไม่พบบทความที่ตรงกับที่ค้นหา' : 'ยังไม่มีบทความ'}
                hint={searching ? 'ลองใช้คำอื่น หรือถามทีมงานในแชทได้เลย' : 'ถามทีมงานในแชทได้เลย เรายินดีช่วยคุณ'}
              />
            )}
          </div>
        </div>
      </section>
      <CustomerAsk />
    </>
  );
}

export function ArticleScreen({ id }: { id: string }) {
  const query = useApi<{ articles: CustomerArticle[] }>(FAQ_PATH);
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <PageLoading />;
  const a = query.data.articles.find((x) => x.id === id);
  if (!a)
    return (
      <EmptyState title="ไม่พบบทความนี้" description="บทความอาจถูกย้ายหรือลบไปแล้ว" icon="book">
        <Link className="btn" href="/customer/faq">
          <Icon name="back" />
          กลับไปคำถามที่พบบ่อย
        </Link>
      </EmptyState>
    );
  return (
    <>
      <Link href="/customer/faq" className="back-link">
        <Icon name="back" />
        คำถามที่พบบ่อยทั้งหมด
      </Link>
      <article className="card customer-article-page">
        <div className="card-body">
          <div className="article-meta">
            <span className="customer-org-badge">{a.org_name}</span>
            <span className="badge">{a.category}</span>
            <span>อัปเดต {date(a.updated_at)}</span>
          </div>
          <h1>{a.title}</h1>
          <Markdown className="article-content" text={a.body} />
          {!a.global && <ArticleFeedback slug={a.org_slug} articleId={a.id} />}
        </div>
      </article>
      <CustomerAsk />
    </>
  );
}
