'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { safeURL } from './markdown-core';
import { installRichSelection, richCommand, richFill, richInsertLink, richInsertText, richValue } from './richtext';
import type { RichFormat } from './types';

/* The formatted writing box of the reply composer, the article editors and the contract editors.

     const editor = useRichEditor();
     <RichToolbar editor={editor} tools={['bold', 'italic', '|', 'link']} label="จัดรูปแบบบทความ" />
     <RichTextField editor={editor} id="article-body" name="body" defaultValue={article.body} ... />

   The form sends the hidden <textarea name> (Markdown), so <Form> values carry it like any field. Text put in by a
   tool (a canned reply, an AI draft, an inserted article) goes through editor.setValue(); code that writes the
   textarea itself and fires an input event (the old way) is picked up as well. Ctrl+Enter submits the form,
   Ctrl+B/I/U/K press the matching toolbar button in the same form, pasting keeps plain text only. */

type Sheets = { openSheet: (title: ReactNode, content: ReactNode) => void; closeSheet: () => void };

// Keeps the two in step without either one echoing the other back.
function writeSource(source: HTMLTextAreaElement, value: string) {
  source.dataset.richBusy = '1';
  source.value = value;
  source.dispatchEvent(new Event('input', { bubbles: true }));
  delete source.dataset.richBusy;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** What useRichEditor() returns: give it to <RichTextField> and the toolbar, and call its methods from tools. */
export class RichEditor {
  private area: HTMLDivElement | null = null;
  private source: HTMLTextAreaElement | null = null;
  private listener: ((value: string) => void) | undefined;
  private readonly sheets: Sheets;

  constructor(sheets: Sheets) {
    this.sheets = sheets;
  }

  /** Callback refs used by <RichTextField>. */
  readonly bindArea = (node: HTMLDivElement | null) => {
    this.area = node;
  };
  readonly bindSource = (node: HTMLTextAreaElement | null) => {
    this.source = node;
  };
  /** Used by <RichTextField> to report changes to its onChange. */
  readonly setListener = (listener: ((value: string) => void) | undefined) => {
    this.listener = listener;
  };
  readonly notify = (value: string) => this.listener?.(value);

  /** The editable area and the hidden field (null before they are on the screen). */
  readonly element = () => this.area;
  readonly sourceElement = () => this.source;

  /** Copy what the editable area shows into the hidden field. */
  readonly sync = () => {
    if (!this.area || !this.source) return;
    const value = richValue(this.area);
    writeSource(this.source, value);
    this.notify(value);
  };

  /** Run a toolbar command (link and image open the address sheet). */
  readonly command = (kind: RichFormat) => {
    const editor = this.area;
    if (!editor) return;
    if (kind === 'link' || kind === 'image') {
      editor.focus();
      this.askForURL(editor, kind);
      return;
    }
    richCommand(editor, kind);
    this.sync();
  };

  /** The current Markdown. */
  readonly getValue = () => this.source?.value ?? '';

  /** Replace everything (canned reply, AI draft, an inserted article); reported through onChange. */
  readonly setValue = (text: string) => {
    if (!this.area || !this.source) return;
    writeSource(this.source, text);
    richFill(this.area, text);
    this.notify(text);
  };

  /** Type text where the cursor was (e.g. "@name "). */
  readonly insertText = (text: string) => {
    if (!this.area) return;
    richInsertText(this.area, text);
    this.sync();
  };

  readonly focus = () => this.area?.focus();

  /* A link is typed into the small dialog with a real field: the address is checked on submit, a bad one is answered
     in red, and the text being written stays untouched behind it. */
  private askForURL(editor: HTMLElement, kind: 'link' | 'image') {
    const image = kind === 'image';
    const selected = String(getSelection()).trim();
    const { openSheet, closeSheet } = this.sheets;
    openSheet(
      image ? 'แทรกรูปภาพ' : 'แทรกลิงก์',
      <LinkForm
        image={image}
        text={selected}
        onCancel={closeSheet}
        onSubmit={async (url, text) => {
          closeSheet();
          // The editor is inert while the sheet is open: write once it has closed.
          await nextFrame();
          richInsertLink(editor, kind, url, text);
          this.sync();
        }}
      />,
    );
  }
}

export function useRichEditor(): RichEditor {
  const { openSheet, closeSheet } = useDialogs();
  useEffect(() => installRichSelection(), []);
  return useMemo(() => new RichEditor({ openSheet, closeSheet }), [openSheet, closeSheet]);
}

function LinkForm({
  image,
  text,
  onCancel,
  onSubmit,
}: {
  image: boolean;
  text: string;
  onCancel: () => void;
  onSubmit: (url: string, text: string) => Promise<void>;
}) {
  useEffect(() => {
    // After the sheet's showModal() (which focuses the close button), put the cursor in the address field.
    const frame = requestAnimationFrame(() => document.getElementById('f-url')?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  const label = image ? 'แทรกรูปภาพ' : 'แทรกลิงก์';
  return (
    <Form
      onSubmit={async (values) => {
        const url = safeURL(String(values.url || '').trim(), image);
        if (!url)
          throw new Error(
            image ? 'ที่อยู่รูปภาพต้องขึ้นต้นด้วย https:// และเปิดดูได้จริง' : 'ที่อยู่ลิงก์ต้องขึ้นต้นด้วย https:// หรือ http:// และถูกต้องตามรูปแบบ',
          );
        await onSubmit(url, String(values.text || '').trim());
      }}
    >
      <TextField
        label={image ? 'ที่อยู่รูปภาพ (https://)' : 'ที่อยู่ลิงก์ (https://)'}
        name="url"
        id="f-url"
        type="url"
        placeholder="https://example.com/…"
        max={2000}
      />
      {image ? (
        <TextField label="คำอธิบายรูป (ไม่บังคับ)" name="text" id="f-text" required={false} defaultValue={text} max={200} placeholder="เช่น หน้าจอการตั้งค่า" />
      ) : (
        <TextField label="ข้อความที่แสดง" name="text" id="f-text" required={false} defaultValue={text} max={200} placeholder="เว้นว่างเพื่อใช้ที่อยู่ลิงก์" />
      )}
      <p className="tiny muted">{image ? 'รองรับเฉพาะรูปที่เผยแพร่แบบ https:// เพื่อไม่ให้รูปหายเมื่อผู้อ่านเปิดบทความ' : 'ลิงก์จะเปิดในแท็บใหม่เสมอ'}</p>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          ยกเลิก
        </button>
        <button className="btn primary" type="submit">
          {label}
        </button>
      </div>
    </Form>
  );
}

const SHORTCUTS: Record<string, RichFormat> = { KeyB: 'bold', KeyI: 'italic', KeyU: 'underline', KeyK: 'link' };

/** The editable area and the hidden field it fills. Key it (e.g. by conversation id) to start from another draft. */
export function RichTextField({
  editor,
  id,
  name = 'body',
  defaultValue = '',
  maxLength,
  label,
  placeholder,
  sourcePlaceholder,
  className,
  keyShortcuts,
  onChange,
}: {
  editor: RichEditor;
  /** The hidden field's id (what a <label htmlFor> points at; data-rich-for on the editable area). */
  id: string;
  name?: string;
  /** The text to start from (a saved draft, the article being edited). */
  defaultValue?: string;
  maxLength?: number;
  /** aria-label of the editable area, e.g. "เนื้อหาบทความ". */
  label: string;
  /** Shown in the empty editable area. */
  placeholder?: string;
  /** The hidden field's own placeholder (the composer kept one). */
  sourcePlaceholder?: string;
  /** Extra classes next to "richtext", e.g. "composer-input" or "article-content editor-input". */
  className?: string;
  /** aria-keyshortcuts, e.g. "Control+Enter Meta+Enter". */
  keyShortcuts?: string;
  /** Every change of the Markdown (typing, tools, setValue), e.g. to keep a draft or count words. */
  onChange?: (value: string) => void;
}) {
  useLayoutEffect(() => editor.setListener(onChange));
  // Local callback refs: the editor object itself is not a ref.
  const areaRef = useCallback((node: HTMLDivElement | null) => editor.bindArea(node), [editor]);
  const sourceRef = useCallback((node: HTMLTextAreaElement | null) => editor.bindSource(node), [editor]);

  useLayoutEffect(() => {
    const area = editor.element();
    const source = editor.sourceElement();
    if (!area || !source) return;
    // Show what the field starts with (a restored draft).
    richFill(area, source.value);
    // Text put in by something else shows up in the editor too.
    const onSourceInput = () => {
      if (source.dataset.richBusy) return;
      if (richValue(area) !== source.value) richFill(area, source.value);
      editor.notify(source.value);
    };
    // form.reset() puts the field back to its starting text; the editor follows.
    const form = source.form;
    const onReset = () => setTimeout(() => richFill(area, source.value));
    source.addEventListener('input', onSourceInput);
    form?.addEventListener('reset', onReset);
    return () => {
      source.removeEventListener('input', onSourceInput);
      form?.removeEventListener('reset', onReset);
    };
  }, [editor]);

  return (
    <>
      <div
        ref={areaRef}
        className={className ? `richtext ${className}` : 'richtext'}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        aria-keyshortcuts={keyShortcuts}
        data-rich-for={id}
        data-placeholder={placeholder}
        onInput={() => editor.sync()}
        onPaste={(event) => {
          // Pasted text arrives as text: formatting comes from the toolbar, never from whatever was copied.
          event.preventDefault();
          document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
        }}
        onKeyDown={(event) => {
          const form = event.currentTarget.closest('form');
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            form?.requestSubmit();
            return;
          }
          if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
          const format = SHORTCUTS[event.code];
          const button = format && form?.querySelector<HTMLButtonElement>(`.tool[data-format="${format}"]`);
          if (button) {
            event.preventDefault();
            button.click();
          }
        }}
      />
      <textarea
        ref={sourceRef}
        id={id}
        className="rich-source"
        name={name}
        maxLength={maxLength}
        tabIndex={-1}
        aria-hidden="true"
        placeholder={sourcePlaceholder}
        defaultValue={defaultValue}
      />
    </>
  );
}

const TOOLS: Record<RichFormat, { label: string; title: string; content: ReactNode }> = {
  bold: { label: 'ตัวหนา', title: 'ตัวหนา (Ctrl+B)', content: <b>B</b> },
  italic: { label: 'ตัวเอียง', title: 'ตัวเอียง (Ctrl+I)', content: <i>I</i> },
  underline: { label: 'ขีดเส้นใต้', title: 'ขีดเส้นใต้ (Ctrl+U)', content: <u>U</u> },
  h1: { label: 'หัวข้อใหญ่', title: 'หัวข้อใหญ่', content: 'H1' },
  h2: { label: 'หัวข้อย่อย', title: 'หัวข้อย่อย', content: 'H2' },
  normal: { label: 'ข้อความปกติ', title: 'ข้อความปกติ', content: 'ปกติ' },
  bullet: { label: 'รายการหัวข้อย่อย', title: 'รายการหัวข้อย่อย', content: <Icon name="list" /> },
  number: { label: 'รายการลำดับเลข', title: 'รายการลำดับเลข', content: <Icon name="listOrdered" /> },
  link: { label: 'ลิงก์', title: 'ลิงก์ (Ctrl+K)', content: <Icon name="link" /> },
  image: { label: 'รูปภาพ', title: 'รูปภาพ', content: <Icon name="image" /> },
  code: { label: 'โค้ด', title: 'โค้ด', content: <Icon name="code" /> },
};

/** One formatting button. `title` overrides the tooltip (the contract editors say just "ลิงก์"). */
export function RichTool({ editor, kind, title }: { editor: RichEditor; kind: RichFormat; title?: string }) {
  const tool = TOOLS[kind];
  return (
    <button
      className="tool"
      type="button"
      data-format={kind}
      aria-label={tool.label}
      title={title ?? tool.title}
      // Pressing a tool must not move the cursor out of the text.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => editor.command(kind)}
    >
      {tool.content}
    </button>
  );
}

/** A row of tools; '|' is a divider. Article editor: className "editor-toolbar", role "toolbar". Composer:
    className "composer-format", role "group", label "จัดรูปแบบข้อความ". */
export function RichToolbar({
  editor,
  tools,
  label,
  className = 'editor-toolbar',
  role = 'toolbar',
  titles,
}: {
  editor: RichEditor;
  tools: Array<RichFormat | '|'>;
  label: string;
  className?: string;
  role?: 'toolbar' | 'group';
  titles?: Partial<Record<RichFormat, string>>;
}) {
  return (
    <div className={className} role={role} aria-label={label}>
      {tools.map((kind, i) =>
        kind === '|' ? (
          <span key={i} className="tool-divider" aria-hidden="true" />
        ) : (
          <RichTool key={i} editor={editor} kind={kind} title={titles?.[kind]} />
        ),
      )}
    </div>
  );
}
