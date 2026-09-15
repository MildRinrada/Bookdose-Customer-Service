/* The app's small Markdown (file name differs from Markdown.tsx by more than case on purpose: case-insensitive
   file systems would otherwise resolve one for the other): what the editors write and what articles, documents and team replies show.
   Ported from old-frontend/pages/knowledge/knowledge.js (safeURL, markdownInline, markdownToHTML). The text is parsed once
   into a tree that only holds the allowlisted marks; markdownToHTML escapes every piece of source text and builds only
   these tags, and <MarkdownBlocks> (Markdown.tsx) builds the same tree as React elements. Pure: no DOM needed. */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML-escape a value (same as the old esc()). */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function currentOrigin(): string {
  // Relative addresses resolve against the page, like before; outside a browser (tests) against a fixed origin.
  return typeof location !== 'undefined' ? location.origin : 'http://localhost';
}

/** An https:// address (http:// too for links, not for images) without credentials, as an absolute URL; else null. */
export function safeURL(value: string, image = false, base: string = currentOrigin()): string | null {
  try {
    const url = new URL(value, base);
    return (url.protocol === 'https:' || (!image && url.protocol === 'http:')) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export type MarkdownInline =
  | { type: 'text'; text: string }
  | { type: 'strongEm' | 'strong' | 'u' | 'em'; children: MarkdownInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; text: string }
  | { type: 'image'; src: string; alt: string };

export type MarkdownBlock =
  | { type: 'p' | 'h3' | 'h4'; children: MarkdownInline[] }
  | { type: 'ul' | 'ol'; items: MarkdownInline[][] }
  | { type: 'pre'; text: string };

// One capturing group only, so split() returns text and tokens alternately.
const TOKENS = /(!?\[[^\]\n]*\]\([^\s)]+\)|`[^`\n]+`|\*\*\*[^*\n]+\*\*\*|\*\*(?:(?!\*\*)[^\n])+\*\*|__(?:(?!__)[^\n])+__|\*[^*\n]+\*)/g;

/** One line's inline marks. Same checks in the same order as the old markdownInline (quirks included). */
export function parseInline(text: string, base: string = currentOrigin()): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  for (const part of text.split(TOKENS)) {
    if (!part) continue;
    const link = part.match(/^(!?)\[([^\]]*)\]\(([^)]+)\)$/);
    if (link) {
      const url = safeURL(link[3], !!link[1], base);
      if (!url) out.push({ type: 'text', text: part });
      else if (link[1]) out.push({ type: 'image', src: url, alt: link[2] });
      else out.push({ type: 'link', href: url, text: link[2] });
      continue;
    }
    // Marks may be combined (bold + italic, bold + underline), so the text inside a mark is read the same way.
    if (part.startsWith('***') && part.endsWith('***')) out.push({ type: 'strongEm', children: parseInline(part.slice(3, -3), base) });
    else if (part.startsWith('**') && part.endsWith('**')) out.push({ type: 'strong', children: parseInline(part.slice(2, -2), base) });
    else if (part.startsWith('__') && part.endsWith('__')) out.push({ type: 'u', children: parseInline(part.slice(2, -2), base) });
    else if (part.startsWith('*') && part.endsWith('*')) out.push({ type: 'em', children: parseInline(part.slice(1, -1), base) });
    else if (part.startsWith('`') && part.endsWith('`')) out.push({ type: 'code', text: part.slice(1, -1) });
    else out.push({ type: 'text', text: part });
  }
  return out;
}

/** Paragraphs, headings (# → h3, ## → h4), bullet / numbered lists and ``` code blocks. */
export function parseMarkdown(text: unknown, base: string = currentOrigin()): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  // A holder rather than a `let`: TypeScript does not follow assignments made inside close().
  const open: { list: { type: 'ul' | 'ol'; items: MarkdownInline[][] } | null } = { list: null };
  let code: string[] | null = null;
  const close = () => {
    if (open.list) blocks.push(open.list);
    open.list = null;
  };
  for (const line of String(text ?? '').split('\n')) {
    if (line.startsWith('```')) {
      close();
      if (code === null) code = [];
      else {
        blocks.push({ type: 'pre', text: code.join('\n') });
        code = null;
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    // People type "•" as often as "-" for a bullet; both make the same list.
    const item = line.match(/^\s*(?:([-*•])|\d+\.)\s+(.*)$/);
    const head = line.match(/^(#{1,2})\s+(.*)$/);
    if (item) {
      const type = item[1] ? 'ul' : 'ol';
      if (open.list?.type !== type) {
        close();
        open.list = { type, items: [] };
      }
      open.list!.items.push(parseInline(item[2], base));
    } else {
      close();
      if (head) blocks.push({ type: head[1].length === 1 ? 'h3' : 'h4', children: parseInline(head[2], base) });
      else if (line.trim()) blocks.push({ type: 'p', children: parseInline(line, base) });
    }
  }
  close();
  if (code !== null) blocks.push({ type: 'pre', text: code.join('\n') });
  return blocks;
}

function inlineHTML(nodes: MarkdownInline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return esc(node.text);
        case 'strongEm':
          return `<strong><em>${inlineHTML(node.children)}</em></strong>`;
        case 'strong':
          return `<strong>${inlineHTML(node.children)}</strong>`;
        case 'u':
          return `<u>${inlineHTML(node.children)}</u>`;
        case 'em':
          return `<em>${inlineHTML(node.children)}</em>`;
        case 'code':
          return `<code>${esc(node.text)}</code>`;
        case 'link':
          return `<a href="${esc(node.href)}" target="_blank" rel="noopener noreferrer">${esc(node.text)}</a>`;
        case 'image':
          return `<img class="article-image" src="${esc(node.src)}" alt="${esc(node.alt)}" loading="lazy" referrerpolicy="no-referrer">`;
      }
    })
    .join('');
}

/** One line of Markdown as HTML (the old markdownInline). */
export function markdownInline(text: string, base?: string): string {
  return inlineHTML(parseInline(text, base));
}

/** Markdown as HTML: all source text escaped, only the allowlisted tags created (the old markdownToHTML). */
export function markdownToHTML(text: unknown, base?: string): string {
  return parseMarkdown(text, base)
    .map((block) => {
      switch (block.type) {
        case 'pre':
          return `<pre><code>${esc(block.text)}</code></pre>`;
        case 'ul':
        case 'ol':
          return `<${block.type}>${block.items.map((item) => `<li>${inlineHTML(item)}</li>`).join('')}</${block.type}>`;
        default:
          return `<${block.type}>${inlineHTML(block.children)}</${block.type}>`;
      }
    })
    .join('');
}

/** Whether a team message carries formatting from the composer tools (the old inbox check); a customer's text is
    always shown as typed. */
export function looksLikeMarkdown(body: string): boolean {
  return /(\*\*|__|^[-*] |^\d+\. |^#{1,2} |`|\[.+\]\(.+\))/m.test(body);
}
