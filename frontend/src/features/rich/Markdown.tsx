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

function inline(nodes: MarkdownInline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={i}>{node.text}</Fragment>;
      case 'strongEm':
        return (
          <strong key={i}>
            <em>{inline(node.children)}</em>
          </strong>
        );
      case 'strong':
        return <strong key={i}>{inline(node.children)}</strong>;
      case 'u':
        return <u key={i}>{inline(node.children)}</u>;
      case 'em':
        return <em key={i}>{inline(node.children)}</em>;
      case 'code':
        return <code key={i}>{node.text}</code>;
      case 'link':
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer">
            {node.text}
          </a>
        );
      case 'image':
        // A published https:// image chosen by the writer; next/image would need every host configured.
        // eslint-disable-next-line @next/next/no-img-element
        return <img key={i} className="article-image" src={node.src} alt={node.alt} loading="lazy" referrerPolicy="no-referrer" />;
    }
  });
}

export function MarkdownBlocks({ text }: { text: string | null | undefined }) {
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
                  <li key={j}>{inline(item)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </ol>
            );
          case 'h3':
            return <h3 key={i}>{inline(block.children)}</h3>;
          case 'h4':
            return <h4 key={i}>{inline(block.children)}</h4>;
          default:
            return <p key={i}>{inline(block.children)}</p>;
        }
      })}
    </>
  );
}
