/* The DOM side of the formatted editor (ported from old-frontend/ui/richtext.js): what the writer sees is the result, not
   the marks. The visible box is an editable area; the form still carries plain text (Markdown) in a hidden field, so
   drafts, sending, storage, search and every channel keep working exactly as before. Browser only. */

import { esc, markdownToHTML, safeURL } from './markdown-core';
import type { RichFormat } from './types';

// A typed space next to formatting often arrives as a non-breaking space; it is stored as a plain one.
const NBSP = String.fromCharCode(0xa0);
const INLINE_MARKS: Record<string, string> = { B: '**', STRONG: '**', I: '*', EM: '*', U: '__', CODE: '`' };

/* Editable HTML -> the plain text that is stored and sent. Only the tags the toolbar can make are translated;
   anything else contributes its text, so nothing unexpected can be smuggled in. */
export function richToText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? '').replaceAll(NBSP, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const element = node as Element;
  const inner = () => [...element.childNodes].map(richToText).join('');
  const mark = INLINE_MARKS[element.tagName];
  if (mark) {
    const text = inner();
    return text.trim() ? mark + text + mark : text;
  }
  switch (element.tagName) {
    case 'BR':
      return '\n';
    case 'A': {
      const url = safeURL(element.getAttribute('href') || '');
      const text = inner();
      return url ? `[${text}](${url})` : text;
    }
    case 'IMG': {
      const url = safeURL(element.getAttribute('src') || '', true);
      return url ? `![${element.getAttribute('alt') || ''}](${url})` : '';
    }
    case 'UL':
    case 'OL': {
      const items = [...element.children].filter((li) => li.tagName === 'LI');
      return items.map((li, i) => `${element.tagName === 'UL' ? '-' : `${i + 1}.`} ${richToText(li).trim()}`).join('\n') + '\n';
    }
    case 'H1':
    case 'H3':
      return `# ${inner().trim()}\n`;
    case 'H2':
    case 'H4':
      return `## ${inner().trim()}\n`;
    case 'PRE':
      return '```\n' + element.textContent + '\n```\n';
    case 'P':
    case 'DIV':
    case 'LI': {
      const text = inner();
      return text.endsWith('\n') ? text : text + '\n';
    }
    default:
      return inner();
  }
}

/** The Markdown the editable area currently holds. */
export function richValue(editor: HTMLElement): string {
  return [...editor.childNodes]
    .map(richToText)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** Show Markdown in the editable area (empty stays truly empty so the placeholder shows). */
export function richFill(editor: HTMLElement, text: string) {
  // Safe: markdownToHTML escapes everything and builds only allowlisted tags.
  editor.innerHTML = String(text || '').trim() ? markdownToHTML(text) : '';
}

/* Where the writer last had the cursor, so pressing a toolbar button (or coming back from the link sheet) formats
   the words that were selected. */
let lastRange: { editor: HTMLElement; range: Range } | null = null;
let installed = false;

export function installRichSelection() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('selectionchange', () => {
    const selection = getSelection();
    if (!selection?.rangeCount) return;
    const node = selection.getRangeAt(0).commonAncestorContainer;
    const editor = (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)?.closest<HTMLElement>('.richtext');
    if (editor) lastRange = { editor, range: selection.getRangeAt(0).cloneRange() };
  });
  try {
    // Bold is <b>, not <span style>: only tags are translated back to Markdown (and inline styles break the CSP).
    document.execCommand('styleWithCSS', false, 'false');
  } catch {
    /* Older browsers keep their own default. */
  }
}

export function richRestore(editor: HTMLElement) {
  if (lastRange?.editor !== editor) return;
  const selection = getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(lastRange.range);
}

/** The formatting commands that need no question (link and image ask for the address first). */
export function richCommand(editor: HTMLElement, kind: Exclude<RichFormat, 'link' | 'image'>) {
  // While the writer is in the editor (a mouse click on a tool keeps it there, a shortcut never leaves it) the live
  // selection is the truth; the saved one may lag behind because selectionchange arrives later.
  const inside = document.activeElement === editor;
  editor.focus();
  if (!inside) richRestore(editor);
  const simple = ({ bold: 'bold', italic: 'italic', underline: 'underline', bullet: 'insertUnorderedList', number: 'insertOrderedList' } as const)[
    kind as 'bold'
  ];
  if (simple) document.execCommand(simple);
  else if (kind === 'h1' || kind === 'h2' || kind === 'normal') document.execCommand('formatBlock', false, { h1: 'h3', h2: 'h4', normal: 'p' }[kind]);
  else if (kind === 'code') {
    const text = String(getSelection()).trim();
    document.execCommand('insertHTML', false, `<code>${esc(text || 'โค้ด')}</code>&nbsp;`);
  }
}

/** Put a checked link or image where the cursor was. */
export function richInsertLink(editor: HTMLElement, kind: 'link' | 'image', url: string, text: string) {
  editor.focus();
  richRestore(editor);
  const selected = String(getSelection());
  if (kind === 'image') document.execCommand('insertHTML', false, `<img src="${esc(url)}" alt="${esc(text)}">`);
  else if (selected && (!text || text === selected)) document.execCommand('createLink', false, url);
  else document.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(text || url)}</a>&nbsp;`);
}

/** Type text at the cursor (a mention, a word from a menu). */
export function richInsertText(editor: HTMLElement, text: string) {
  editor.focus();
  richRestore(editor);
  document.execCommand('insertText', false, text);
}
