'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { useToast } from '@/components/ui/Toast';
import { useApi, useInvalidate } from '@/lib/query';
import { ARTICLE_PREFIXES, TEMPLATES_PATH, useTemplate } from '../api';
import type { ArticleTemplate } from '../types';

/* คลังบทความแม่แบบ, as an organization sees it: the answers the Bookdose team has already written, ready to take.

   Taking one makes a copy in this organization's own knowledge base. From that moment it is theirs - they edit it
   into their own words, publish or delete it, and nothing the platform does to the template afterwards touches it.
   That is said on the screen, because "use a template" otherwise sounds like something that can be taken back. */

export function TemplateLibrary() {
  const page = useApi<{ templates: ArticleTemplate[] }>(TEMPLATES_PATH);
  if (page.isPending) return <PageLoading />;
  if (page.error) return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  const templates = page.data.templates;
  if (!templates.length)
    return (
      <EmptyState
        title="ยังไม่มีแม่แบบให้ใช้"
        description="ทีม Bookdose ยังไม่ได้เผยแพร่บทความแม่แบบ ระหว่างนี้เขียนบทความเองได้จากปุ่ม เขียนบทความใหม่"
        icon="book"
      />
    );
  return (
    <>
      <p className="notice">
        กดนำไปใช้แล้วบทความจะถูกคัดลอกมาเป็นของคุณทันที <strong>แก้ไขเป็นสำนวนของคุณเองได้เลย</strong> · ถ้าทีม Bookdose แก้แม่แบบภายหลัง
        บทความที่คุณนำไปใช้แล้วจะไม่เปลี่ยนตาม
      </p>
      <div className="template-list">
        {templates.map((template) => (
          <TemplateRow key={template.id} template={template} />
        ))}
      </div>
    </>
  );
}

function TemplateRow({ template }: { template: ArticleTemplate }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState(template.taken);
  const take = async (visibility: 'public' | 'internal') => {
    setBusy(true);
    try {
      await useTemplate(template.id, visibility);
      setTaken(true);
      toast(
        visibility === 'public'
          ? `นำ “${template.title}” มาใช้แล้ว · เผยแพร่ให้ลูกค้าเห็นแล้ว แก้ไขต่อได้ที่คลังความรู้`
          : `นำ “${template.title}” มาใช้แล้ว · เก็บเป็นบทความภายใน ยังไม่เผยแพร่`,
      );
      await refresh(...ARTICLE_PREFIXES);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`template-row${taken ? ' taken' : ''}`}>
      <div className="template-row-head">
        <div className="grow">
          <strong>{template.title}</strong>
          <span className="tiny muted">
            {template.category}
            {taken ? ' · นำไปใช้แล้ว' : ''}
          </span>
        </div>
        <button type="button" className="btn sm subtle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'eyeOff' : 'eye'} />
          {open ? 'ซ่อน' : 'ดูเนื้อหา'}
        </button>
        <button type="button" className="btn sm" disabled={busy} onClick={() => void take('internal')}>
          เก็บเป็นฉบับภายใน
        </button>
        <button type="button" className="btn sm primary" disabled={busy} onClick={() => void take('public')}>
          <Icon name="plus" />
          {taken ? 'นำไปใช้อีกครั้ง' : 'นำไปใช้'}
        </button>
      </div>
      {open && <p className="template-row-body">{template.body}</p>}
    </section>
  );
}

/** The button that opens the library, for the knowledge screen's heading. */
export function TemplateLibraryButton() {
  const { openModal } = useDialogs();
  return (
    <button type="button" className="btn kb-new" onClick={() => openModal('คลังบทความแม่แบบ', <TemplateLibrary />, { wide: true })}>
      <Icon name="copy" />
      ใช้แม่แบบ
    </button>
  );
}
