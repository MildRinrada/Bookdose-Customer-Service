import type { AiCitation } from '../types';

/* The sources an AI answer quoted, folded under the message or the draft. Markup: modules/ai/ai-citations. */

export function AiCitations({ citations }: { citations: AiCitation[] | null | undefined }) {
  if (!citations?.length) return null;
  return (
    <details className="ai-citations">
      <summary>แหล่งอ้างอิง {citations.length} รายการ</summary>
      {citations.map((c, i) => (
        <div key={i}>
          <strong>{c.title}</strong>
          {c.visibility === 'internal' && <span className="badge">ภายในองค์กร</span>}
          <p>“{c.quote}”</p>
        </div>
      ))}
    </details>
  );
}
