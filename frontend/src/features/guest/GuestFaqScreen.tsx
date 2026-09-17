'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { CustomerArticleRow, CustomerNone, EmptyState, ErrorState, InitialLoading } from '@/components/ui/display';
import { FilterPill, SearchInput } from '@/components/ui/filters';
import type { PublicOrgInfo } from '@/features/auth/types';
import { Markdown } from '@/features/rich/Markdown';
import { date, plainText } from '@/lib/format';
import { useApi } from '@/lib/query';
import { guestPages, publicOrgPath } from './api';
import { GuestFrame } from './components/GuestFrame';

/* /chat/<org>/faq and /chat/<org>/faq/<id>: the organization's published answers for anyone, without signing in -
   its own public articles and the platform's articles for customers (GET /api/public/<org>). The links a team sends
   in a chat ("แนะนำบทความ") open here, so a visitor without an account can read them. Markup: the signed-in
   customer's FAQ pieces (pages/customer/customer-faq.html) inside the guest page. */

type PublicArticle = { id: string; title: string; category: string; body: string; updated_at: string };
type PublicPage = PublicOrgInfo & { articles?: PublicArticle[] };

function usePublicPage(slug: string) {
  const page = useApi<PublicPage>(publicOrgPath(slug));
  const orgName = page.data?.organization.name ?? '';
  return { page, orgName, articles: page.data?.articles ?? [] };
}

function useTitle(title: string) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}

function PageState({ page }: { page: ReturnType<typeof usePublicPage>['page'] }) {
  if (page.error?.status === 404)
    return (
      <section className="card guest-closed">
        <EmptyState icon="globe" title="ไม่พบองค์กรนี้" description={page.error.message} />
      </section>
    );
  if (page.error) return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  return <InitialLoading text="กำลังเปิดคำถามที่พบบ่อย…" />;
}

/** Can't find it: ask the team in the chat, no account needed. */
function AskTeam({ slug }: { slug: string }) {
  return (
    <section className="card customer-ask">
      <div className="card-body">
        <span className="customer-ask-icon">
          <Icon name="chat" />
        </span>
        <div className="grow">
          <strong>ไม่พบคำตอบที่ต้องการ?</strong>
          <p className="muted">ส่งคำถามถึงทีมงานได้เลยโดยไม่ต้องสมัครสมาชิก แล้วกลับมาอ่านคำตอบในแชทเดิม</p>
        </div>
        <Link className="btn primary" href={guestPages.chat(slug)}>
          <Icon name="chat" />
          แชทกับทีมงาน
        </Link>
      </div>
    </section>
  );
}

export function GuestFaqScreen({ slug }: { slug: string }) {
  const { page, orgName, articles } = usePublicPage(slug);
  const [search, setSearch] = useState('');
  const [chosenCategory, setCategory] = useState('');
  useTitle(orgName ? `คำถามที่พบบ่อย · ${orgName}` : '');
  if (!page.data)
    return (
      <GuestFrame slug={slug} orgName="" current="faq">
        <PageState page={page} />
      </GuestFrame>
    );
  const categories = [...new Set(articles.map((a) => a.category))].sort((a, b) => a.localeCompare(b, 'th'));
  const category = categories.includes(chosenCategory) ? chosenCategory : '';
  const term = search.trim().toLowerCase();
  const found = articles.filter(
    (a) => (!category || a.category === category) && (!term || [a.title, a.body, a.category].some((v) => String(v || '').toLowerCase().includes(term))),
  );
  const searching = Boolean(term || category);

  return (
    <GuestFrame slug={slug} orgName={orgName} current="faq">
      <div className="page-heading">
        <div>
          <h1>คำถามที่พบบ่อย</h1>
          <p>คำตอบจาก {orgName} อ่านได้ทันทีโดยไม่ต้องเข้าสู่ระบบ</p>
        </div>
      </div>
      <section className="card customer-answers">
        <div className="card-body">
          <SearchInput id="guest-faq-search" label="ค้นหาคำตอบ" placeholder="ค้นหาคำตอบ เช่น ลืมรหัสผ่าน เปลี่ยนอีเมล" value={search} onChange={setSearch} />
          {categories.length > 1 && (
            <div className="filter-pills" role="group" aria-label="หมวดหมู่บทความ">
              {['', ...categories].map((value) => (
                <FilterPill
                  key={value}
                  label={value || 'ทุกหมวด'}
                  value={value}
                  pressed={category === value}
                  count={value ? articles.filter((a) => a.category === value).length : articles.length}
                  onClick={setCategory}
                />
              ))}
            </div>
          )}
          <p className="muted customer-article-count" role="status">
            {found.length} บทความ
          </p>
          <div className="customer-article-list" id="guest-articles">
            {found.length ? (
              found.map((a) => (
                <CustomerArticleRow
                  key={a.id}
                  href={guestPages.article(slug, a.id)}
                  title={a.title}
                  category={a.category}
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
      <AskTeam slug={slug} />
    </GuestFrame>
  );
}

export function GuestArticleScreen({ slug, id }: { slug: string; id: string }) {
  const { page, orgName, articles } = usePublicPage(slug);
  const article = articles.find((a) => a.id === id);
  useTitle(article ? `${article.title} · ${orgName}` : '');
  if (!page.data)
    return (
      <GuestFrame slug={slug} orgName="" current="faq">
        <PageState page={page} />
      </GuestFrame>
    );
  return (
    <GuestFrame slug={slug} orgName={orgName} current="faq">
      <Link href={guestPages.faq(slug)} className="back-link">
        <Icon name="back" />
        คำถามที่พบบ่อยทั้งหมด
      </Link>
      {article ? (
        <article className="card customer-article-page">
          <div className="card-body">
            <div className="article-meta">
              <span className="customer-org-badge">{orgName}</span>
              <span className="badge">{article.category}</span>
              <span>อัปเดต {date(article.updated_at)}</span>
            </div>
            <h1>{article.title}</h1>
            <Markdown className="article-content" text={article.body} />
          </div>
        </article>
      ) : (
        <section className="card">
          <EmptyState title="ไม่พบบทความนี้" description="บทความอาจถูกย้าย ลบ หรือยกเลิกการเผยแพร่ไปแล้ว" icon="book">
            <Link className="btn" href={guestPages.faq(slug)}>
              <Icon name="back" />
              กลับไปคำถามที่พบบ่อย
            </Link>
          </EmptyState>
        </section>
      )}
      <AskTeam slug={slug} />
    </GuestFrame>
  );
}
