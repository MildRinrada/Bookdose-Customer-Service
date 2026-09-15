'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { CustomerArticleRow, CustomerNone, ErrorState, PageLoading } from '@/components/ui/display';
import { FilterPill, SearchInput } from '@/components/ui/filters';
import { plainText } from '@/lib/format';
import { useApi } from '@/lib/query';
import { useUiState } from '@/lib/ui-state';
import { GUIDES_PATH } from './api';
import type { Guide, GuidesPage } from './types';

/* คู่มือจาก Bookdose: the platform's articles for the admins and staff of every organization. Read-only; the platform
   team writes them in its console (FAQ กลาง). Markup: old-frontend/pages/guides/guides.html. */

export function GuidesScreen() {
  const page = useApi<GuidesPage>(GUIDES_PATH);
  if (page.isPending) return <PageLoading />;
  if (page.error) return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  return <GuidesView articles={page.data.articles} />;
}

function GuidesView({ articles }: { articles: Guide[] }) {
  const [query, setQuery] = useUiState('guides:query', '');
  const [chosen, setCategory] = useUiState('guides:category', '');
  const categories = [...new Set(articles.map((a) => a.category))].sort((a, b) => a.localeCompare(b, 'th'));
  // A category that no longer has guides falls back to all of them.
  const category = categories.includes(chosen) ? chosen : '';
  const term = query.toLowerCase();
  const shown = articles.filter(
    (a) => (!category || a.category === category) && (!term || [a.title, a.body, a.category].some((v) => String(v || '').toLowerCase().includes(term))),
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>คู่มือจาก Bookdose</h1>
          <p>คำแนะนำการใช้งานระบบสำหรับแอดมินและทีมงานองค์กร จากทีม Bookdose</p>
        </div>
      </div>
      <section className="card customer-answers">
        <div className="card-body">
          <SearchInput id="guide-search" label="ค้นหาคู่มือ" placeholder="ค้นหาคู่มือ เช่น LINE รายงาน การกระจายเคส" value={query} onChange={setQuery} />
          {categories.length > 1 && (
            <div className="filter-pills" role="group" aria-label="หมวดคู่มือ">
              {['', ...categories].map((value) => (
                <FilterPill
                  key={value}
                  value={value}
                  label={value || 'ทั้งหมด'}
                  pressed={category === value}
                  count={value ? articles.filter((a) => a.category === value).length : articles.length}
                  onClick={setCategory}
                />
              ))}
            </div>
          )}
          <p className="muted customer-article-count" id="guides-count" role="status">
            {shown.length} คู่มือ
          </p>
          <div className="customer-article-list" id="guides-list">
            {shown.length ? (
              shown.map((a) => (
                <CustomerArticleRow key={a.id} href={`/guides/${a.id}`} title={a.title} category={a.category} excerpt={plainText(a.body).slice(0, 140)} />
              ))
            ) : (
              <CustomerNone
                title={articles.length ? 'ไม่พบคู่มือที่ตรงกับที่ค้นหา' : 'ยังไม่มีคู่มือ'}
                hint={articles.length ? 'ลองใช้คำอื่น หรือเลือกหมวด “ทั้งหมด”' : 'ทีม Bookdose ยังไม่ได้เผยแพร่คู่มือสำหรับองค์กร'}
              />
            )}
          </div>
        </div>
      </section>
      <p className="muted guides-note">
        <Icon name="book" />
        <span>
          คู่มือของทีมคุณเองอยู่ที่เมนู <Link href="/knowledge">คลังความรู้</Link> ถ้าต้องการความช่วยเหลือเพิ่ม ติดต่อทีม Bookdose
          ผ่านช่องทางที่ได้รับตอนเปิดใช้ระบบ
        </span>
      </p>
    </>
  );
}
