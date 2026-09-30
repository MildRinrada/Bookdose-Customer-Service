'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { EmptyState, ErrorState, PageLoading } from '@/components/ui/display';
import { FormActions, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { deleteArticleTemplate, publishArticleTemplate, saveArticleTemplate, TEMPLATES_PATH } from './api';
import type { ArticleTemplate } from './types';

/* Platform console, คลังบทความแม่แบบ.

   Every organization is asked the same handful of questions - opening hours, how to reach a person, how long a reply
   takes - and every one of them was writing those answers from nothing. Written once here, an organization takes a
   copy with one click and edits it into its own words.

   A copy is a copy, not a link: the moment an organization takes one, the article is theirs. Changing a template
   afterwards leaves every copy alone, and deleting one leaves them alone too. Nothing written here can reach into an
   organization's knowledge base later, which is what makes taking one safe. */

export function TemplatesScreen() {
  const page = useApi<{ templates: ArticleTemplate[] }>(TEMPLATES_PATH);
  const { openModal } = useDialogs();
  if (page.isPending) return <PageLoading />;
  if (page.error) return <ErrorState error={page.error} onRetry={() => void page.refetch()} />;
  const templates = page.data.templates;
  const live = templates.filter((t) => t.published).length;

  return (
    <>
      <Link href="/platform/faq" className="back-link">
        <Icon name="back" />
        FAQ กลาง
      </Link>
      <div className="page-heading">
        <div>
          <h1>คลังบทความแม่แบบ</h1>
          <p>
            เขียนคำตอบพื้นฐานไว้ครั้งเดียว องค์กรกดนำไปใช้แล้วแก้เป็นสำนวนของตัวเองได้ · เผยแพร่แล้ว {live} จาก {templates.length} แม่แบบ
          </p>
        </div>
        <div className="flex">
          <button type="button" className="btn primary" onClick={() => openModal('เพิ่มแม่แบบ', <TemplateForm />)}>
            <Icon name="plus" />
            เพิ่มแม่แบบ
          </button>
        </div>
      </div>
      <p className="notice">
        องค์กรเห็นเฉพาะแม่แบบที่เผยแพร่แล้ว · เมื่อองค์กรกดนำไปใช้ บทความจะกลายเป็นของเขาทันที แก้ไขหรือลบเองได้ และ
        <strong>การแก้หรือลบแม่แบบภายหลังจะไม่ไปแตะบทความที่เขานำไปใช้แล้ว</strong>
      </p>
      {templates.length ? (
        <div className="template-stack">
          {templates.map((template) => (
            <TemplateCard key={template.id} template={template} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="ยังไม่มีแม่แบบ"
          description="เริ่มจากคำถามที่ทุกองค์กรต้องตอบอยู่แล้ว เช่น เวลาทำการ ช่องทางติดต่อ และระยะเวลาที่ใช้ตอบกลับ"
          icon="book"
        />
      )}
    </>
  );
}

function TemplateCard({ template }: { template: ArticleTemplate }) {
  const { openModal, confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const published = Boolean(template.published);
  return (
    <section className={`card template-card${published ? '' : ' draft'}`}>
      <div className="card-header">
        <div>
          <h2>{template.title}</h2>
          <p>
            {template.category} · แก้ไขล่าสุด {date(template.updated_at, true)} โดย {template.author}
          </p>
        </div>
        <span className={`badge${published ? '' : ' muted'}`}>{published ? 'เผยแพร่แล้ว' : 'ฉบับร่าง'}</span>
      </div>
      <div className="card-body">
        <p className="template-body">{template.body}</p>
        <div className="settings-row-actions">
          <button type="button" className="btn sm" onClick={() => openModal('แก้ไขแม่แบบ', <TemplateForm template={template} />)}>
            <Icon name="edit" />
            แก้ไข
          </button>
          <button
            type="button"
            className={`btn sm${published ? '' : ' primary'}`}
            onClick={() =>
              void (async () => {
                await publishArticleTemplate(template.id, !published);
                toast(published ? 'เอาออกจากคลังแล้ว องค์กรจะไม่เห็นแม่แบบนี้' : 'เผยแพร่แล้ว องค์กรนำไปใช้ได้ทันที');
                await refresh(TEMPLATES_PATH);
              })()
            }
          >
            <Icon name={published ? 'eyeOff' : 'check'} />
            {published ? 'เอาออกจากคลัง' : 'เผยแพร่ให้องค์กรใช้'}
          </button>
          <button
            type="button"
            className="btn sm danger"
            onClick={() =>
              confirm({
                title: 'ลบแม่แบบ',
                message: 'องค์กรจะไม่เห็นแม่แบบนี้อีก · บทความที่องค์กรนำไปใช้แล้วยังอยู่ครบและไม่ถูกแตะต้อง',
                confirmLabel: 'ลบแม่แบบ',
                tone: 'danger',
                run: async () => {
                  await deleteArticleTemplate(template.id);
                  toast('ลบแม่แบบแล้ว');
                  await refresh(TEMPLATES_PATH);
                },
              })
            }
          >
            <Icon name="trash" />
            ลบ
          </button>
        </div>
      </div>
    </section>
  );
}

function TemplateForm({ template }: { template?: ArticleTemplate }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      data-form="article-template"
      onSubmit={async (values) => {
        await saveArticleTemplate(template?.id ?? null, {
          title: values.title ?? '',
          category: values.category ?? '',
          body: values.body ?? '',
        });
        closeModal();
        toast(template ? 'บันทึกแม่แบบแล้ว' : 'เพิ่มแม่แบบแล้ว · กด เผยแพร่ให้องค์กรใช้ เมื่อพร้อม');
        await refresh(TEMPLATES_PATH);
      }}
    >
      <TextField label="หัวข้อ" name="title" max={200} defaultValue={template?.title} />
      <TextField label="หมวด" name="category" max={80} defaultValue={template?.category} hint="เช่น ทั่วไป การใช้งาน การคืนสินค้า" />
      <div className="field">
        <label htmlFor="template-body">เนื้อหา</label>
        <textarea
          id="template-body"
          name="body"
          rows={10}
          maxLength={50000}
          required
          defaultValue={template?.body}
          placeholder="เขียนให้เป็นกลาง องค์กรจะแก้เป็นสำนวนและรายละเอียดของตัวเองต่อ เช่น เวลาทำการ ช่องทางติดต่อ หรือระยะเวลาที่ใช้ตอบกลับ"
        />
      </div>
      <FormActions label={template ? 'บันทึก' : 'เพิ่มแม่แบบ'} onCancel={() => closeModal()} />
    </Form>
  );
}
