'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useDialogs } from '@/components/ui/Dialogs';
import { RequiredStar, TextField, useFieldValidation } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { RichTextField, RichToolbar, useRichEditor, type RichEditor } from '@/features/rich/RichEditor';
import type { RichFormat } from '@/features/rich/types';
import { useInvalidate } from '@/lib/query';
import { ARTICLE_PREFIXES, saveArticle } from '../api';
import { visibilityLabels, wordCountText } from '../labels';
import type { Article } from '../types';

/* The article editor (pages/knowledge/article-form). Its pieces are exported for the global FAQ editor, which
   has the same title, category and body, with "ผู้อ่าน" in place of "สิทธิ์การอ่าน". */

/** The article toolbar, in the old order. */
export const ARTICLE_TOOLS: Array<RichFormat | '|'> = ['bold', 'italic', 'underline', '|', 'h1', 'h2', 'normal', '|', 'bullet', 'number', '|', 'link', 'image', 'code'];

/** "หมวดหมู่": type a new one or pick one that exists (datalist). */
export function ArticleCategoryField({ defaultValue = 'ทั่วไป', categories }: { defaultValue?: string; categories: string[] }) {
  const { bind, errorNode } = useFieldValidation();
  return (
    <div className="field">
      <label htmlFor="article-category">
        หมวดหมู่
        <RequiredStar />
      </label>
      <input
        id="article-category"
        name="category"
        list="article-categories"
        required
        maxLength={80}
        defaultValue={defaultValue}
        placeholder="เลือกหมวดเดิมหรือพิมพ์หมวดใหม่"
        {...bind}
      />
      {errorNode}
      <datalist id="article-categories">
        {categories.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <small className="muted">พิมพ์เพื่อสร้างหมวดใหม่ หรือกดเลือกจากหมวดที่มีอยู่</small>
    </div>
  );
}

/** "เนื้อหาบทความ": toolbar, the formatted writing box (sends `body` as Markdown) and the word count. */
export function ArticleBodyField({
  editor,
  defaultValue = '',
  onChange,
}: {
  editor: RichEditor;
  defaultValue?: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="field editor-field">
      <div className="editor-head">
        <label htmlFor="article-body">เนื้อหาบทความ</label>
      </div>
      <RichToolbar editor={editor} tools={ARTICLE_TOOLS} label="จัดรูปแบบบทความ" className="editor-toolbar" role="toolbar" />
      <RichTextField
        editor={editor}
        id="article-body"
        name="body"
        defaultValue={defaultValue}
        maxLength={50000}
        label="เนื้อหาบทความ"
        placeholder="เขียนขั้นตอน วิธีแก้ปัญหา หรือคำตอบที่ทีมใช้บ่อย"
        className="article-content editor-input"
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
      <div className="editor-foot">
        <small className="muted">เลือกข้อความแล้วกดปุ่มจัดรูปแบบ · ข้อความที่เห็นคือหน้าตาที่บันทึก</small>
        <small className="muted" data-word-count="">
          {wordCountText(value)}
        </small>
      </div>
    </div>
  );
}

/** The field layout of both article editors: title, then category beside `aside` (visibility or audience), then the body. */
export function ArticleEditorFields({
  editor,
  title = '',
  titlePlaceholder,
  category,
  categories,
  body = '',
  aside,
  onBodyChange,
}: {
  editor: RichEditor;
  title?: string;
  titlePlaceholder: string;
  category?: string;
  categories: string[];
  body?: string;
  aside: ReactNode;
  onBodyChange?: (value: string) => void;
}) {
  return (
    <div className="stack">
      <TextField label="ชื่อบทความ" name="title" id="f-title" defaultValue={title} placeholder={titlePlaceholder} max={200} />
      <div className="form-grid">
        <ArticleCategoryField defaultValue={category || 'ทั่วไป'} categories={categories} />
        {aside}
      </div>
      <ArticleBodyField editor={editor} defaultValue={body} onChange={onBodyChange} />
    </div>
  );
}

const snapshot = (form: HTMLFormElement) => JSON.stringify(Object.fromEntries(new FormData(form)));

/** A new article's words written elsewhere (the overview's AI draft): filled in, saved as a new article. */
export type ArticleDraft = Pick<Article, 'title' | 'category' | 'body'> & { visibility?: Article['visibility'] };

/** Write or edit a knowledge article. Open with openModal(title, <ArticleForm/>, { wide: true }). Closing with
    unsaved words asks first, on top of the editor, so "keep writing" leaves the text where it was; a `draft` counts
    as unsaved words from the start. */
export function ArticleForm({
  article,
  draft,
  categories,
  onSaved,
}: {
  article?: Article;
  draft?: ArticleDraft;
  categories: string[];
  onSaved?: (id: string) => unknown;
}) {
  const fill = article ?? draft;
  const editor = useRichEditor();
  const { closeModal, setCloseGuard, confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const initial = useRef<string | null>(null);
  const saved = useRef(false);
  // <Form> keeps its element to itself; the body's hidden field belongs to it.
  const formOf = () => editor.sourceElement()?.form ?? null;
  const [ready, setReady] = useState(Boolean(fill?.title.trim() && fill?.body.trim()));

  // Save is only possible with a title and some content.
  const check = () => {
    const form = formOf();
    if (!form) return;
    const value = (name: string) => String((form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '').trim();
    setReady(Boolean(value('title') && value('body')));
  };

  useEffect(() => {
    const form = formOf();
    if (!form) return;
    initial.current = draft ? '' : snapshot(form);
    const dirty = () => !saved.current && initial.current !== null && initial.current !== snapshot(form);
    setCloseGuard(() => {
      if (!dirty()) return true;
      confirm({
        title: 'ยังไม่ได้บันทึกบทความ',
        message: 'เนื้อหาที่พิมพ์ไว้จะหายไปทั้งหมดหากปิดตอนนี้ ต้องการทิ้งการแก้ไขหรือไม่?',
        cancelLabel: 'กลับไปเขียนต่อ',
        confirmLabel: 'ทิ้งการแก้ไข',
        tone: 'danger',
        run: () => closeModal(true),
      });
      return false;
    });
    // Leaving the page (reload, closing the tab) with unsaved words asks the browser's own question.
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the editor opens (formOf reads the mounted field)
  }, [setCloseGuard, confirm, closeModal, editor]);

  return (
    <Form
      data-form="article"
      data-id={article?.id ?? ''}
      className="article-editor"
      onInput={check}
      onSubmit={async (values) => {
        const { id } = await saveArticle(article?.id, {
          title: values.title ?? '',
          category: values.category ?? '',
          body: values.body ?? '',
          visibility: values.visibility ?? 'internal',
        });
        saved.current = true;
        closeModal(true);
        toast('บันทึกบทความเรียบร้อยแล้ว');
        await refresh(...ARTICLE_PREFIXES);
        await onSaved?.(id);
      }}
    >
      <ArticleEditorFields
        editor={editor}
        title={fill?.title}
        titlePlaceholder="เช่น วิธีตั้งค่า Bookdose e-Library สำหรับผู้ดูแล"
        category={fill?.category}
        categories={categories}
        body={fill?.body}
        onBodyChange={check}
        aside={
          <div className="field">
            <label htmlFor="article-visibility">สิทธิ์การอ่าน</label>
            <select id="article-visibility" name="visibility" defaultValue={fill?.visibility || 'internal'}>
              <option value="internal">{visibilityLabels.internal}</option>
              <option value="public">{visibilityLabels.public}</option>
            </select>
            <small className="muted">“เผยแพร่ให้ลูกค้า” จะแสดงในหน้าลูกค้าด้วย</small>
          </div>
        }
      />
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => closeModal()}>
          ยกเลิก
        </button>
        <button className="btn primary" type="submit" disabled={!ready}>
          บันทึกบทความ
        </button>
      </div>
    </Form>
  );
}
