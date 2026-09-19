import { Fragment, type ReactNode } from 'react';
import { markdownToHTML, parseMarkdown, type MarkdownInline } from './markdown-core';

/* Showing Markdown. <Markdown> puts markdownToHTML's output in one element (the only sanctioned
   dangerouslySetInnerHTML: everything is escaped first, then only allowlisted tags are built). <MarkdownBlocks>
   builds the same markup as React elements without a wrapper, for places where other content shares the element
   (a message bubble holds its text and then its files). */

export function Markdown({
  text,
  className,
  as: Tag = 'div',
}: {
  text: string | null | undefined;
  className?: string;
  as?: 'div' | 'section' | 'article';
}) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: markdownToHTML(text ?? '') }} />;
}

/** `plain`: what a customer wrote - their formatting shows, but a link is its words and address as text (a customer
    cannot put a harmless-looking word over an address the team would click) and an image is only its description. */
function inline(nodes: MarkdownInline[], plain = false): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={i}>{node.text}</Fragment>;
      case 'strongEm':
        return (
          <strong key={i}>
            <em>{inline(node.children, plain)}</em>
          </strong>
        );
      case 'strong':
        return <strong key={i}>{inline(node.children, plain)}</strong>;
      case 'u':
        return <u key={i}>{inline(node.children, plain)}</u>;
      case 'em':
        return <em key={i}>{inline(node.children, plain)}</em>;
      case 'code':
        return <code key={i}>{node.text}</code>;
      case 'link':
        if (plain) return <Fragment key={i}>{node.text === node.href ? node.href : `${node.text} (${node.href})`}</Fragment>;
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer">
            {node.text}
          </a>
        );
      case 'image':
        if (plain) return <Fragment key={i}>{node.alt || node.src}</Fragment>;
        // A published https:// image chosen by the writer; next/image would need every host configured.
        // eslint-disable-next-line @next/next/no-img-element
        return <img key={i} className="article-image" src={node.src} alt={node.alt} loading="lazy" referrerPolicy="no-referrer" />;
    }
  });
}

export function MarkdownBlocks({ text, plain = false }: { text: string | null | undefined; plain?: boolean }) {
  return (
    <>
      {parseMarkdown(text ?? '').map((block, i) => {
        switch (block.type) {
          case 'pre':
            return (
              <pre key={i}>
                <code>{block.text}</code>
              </pre>
            );
          case 'ul':
            return (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item, plain)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item, plain)}</li>
                ))}
              </ol>
            );
          case 'h3':
            return <h3 key={i}>{inline(block.children, plain)}</h3>;
          case 'h4':
            return <h4 key={i}>{inline(block.children, plain)}</h4>;
          default:
            return <p key={i}>{inline(block.children, plain)}</p>;
        }
      })}
    </>
  );
}
