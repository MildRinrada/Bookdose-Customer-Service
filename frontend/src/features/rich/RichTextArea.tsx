'use client';

import { useState } from 'react';
import { RequiredStar } from '@/components/ui/fields';
import { RichTextField, RichToolbar, useRichEditor } from './RichEditor';
import { maskSensitive } from './sensitive';
import { SensitiveWarning } from './SensitiveWarning';
import type { RichFormat } from './types';

/* A form field for a customer's message with simple formatting (the start forms of a chat, signed in or not): a label,
   the tools and the writing area, and the warning while what is typed looks like an ID card number, a card number or
   a password (SensitiveWarning). The form sends the Markdown in `name` like a textarea. Markup: components
   (rich-box), knowledge (editor-toolbar). */

/** What a customer may format: emphasis and lists. No links or images (MessageThread shows a customer's as text). */
export const CUSTOMER_TOOLS: Array<RichFormat | '|'> = ['bold', 'italic', 'underline', '|', 'bullet', 'number'];

export function RichTextArea({
  id,
  name,
  label,
  placeholder,
  maxLength = 20000,
  required = true,
  hint,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  placeholder?: string;
  maxLength?: number;
  required?: boolean;
  hint?: string;
  /** The Markdown as it is written, for a form that answers what is being typed (the answers offered before sending). */
  onChange?: (value: string) => void;
}) {
  const editor = useRichEditor();
  const [text, setText] = useState('');
  return (
    <div className="field rich-field">
      <label htmlFor={id}>
        {label}
        {required && <RequiredStar />}
      </label>
      <RichToolbar editor={editor} tools={CUSTOMER_TOOLS} label={`จัดรูปแบบ${label}`} className="editor-toolbar" role="toolbar" />
      <RichTextField
        editor={editor}
        id={id}
        name={name}
        maxLength={maxLength}
        label={label}
        placeholder={placeholder}
        sourcePlaceholder={placeholder}
        className="editor-input rich-box"
        keyShortcuts="Control+Enter Meta+Enter"
        onChange={(value) => {
          setText(value);
          onChange?.(value);
        }}
      />
      <SensitiveWarning text={text} onMask={() => editor.setValue(maskSensitive(editor.getValue()))} />
      {hint && <p className="tiny muted">{hint}</p>}
    </div>
  );
}
