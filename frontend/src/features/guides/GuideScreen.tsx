'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { Markdown } from '@/features/rich/Markdown';
import { date } from '@/lib/format';
import { useApi } from '@/lib/query';
import { GUIDES_PATH } from './api';
import type { GuidesPage } from './types';

/* One Bookdose guide, read in full. Markup: old-frontend/pages/guides/guide-read.html. */

export function GuideScreen({ id }: { id: string }) {
  const page = useApi<GuidesPage>(GUIDES_PATH);
  if (page.isPending) return <PageLoading />;
  if (page.error) return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  const a = page.data.articles.find((x) => x.id === id);
  if (!a)
    return (
      <EmptyState title="ไม่พบคู่มือนี้" description="คู่มืออาจถูกย้ายหรือลบไปแล้ว" icon="file">
        <Link className="btn" href="/guides">
          <Icon name="back" />
          กลับไปคู่มือจาก Bookdose
        </Link>
      </EmptyState>
    );
  return (
    <>
      <Link href="/guides" className="back-link">
        <Icon name="back" />
        คู่มือจาก Bookdose ทั้งหมด
      </Link>
      <article className="card customer-article-page">
        <div className="card-body">
          <div className="article-meta">
            <span className="badge">{a.category}</span>
            <span>อัปเดต {date(a.updated_at)}</span>
          </div>
          <h1>{a.title}</h1>
          <Markdown className="article-content" text={a.body} />
        </div>
      </article>
    </>
  );
}
