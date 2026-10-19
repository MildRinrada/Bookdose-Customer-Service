'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { useApi } from '@/lib/query';
import { legalPath } from './api';
import { LEGAL_NAMES, LegalText } from './LegalDocument';
import type { LegalDocument, LegalKey } from './types';

/* The window that has to be answered before the page goes on (backend modules/legal, GRACE_DAYS): a document somebody
   has never agreed to, or a new version whose grace has run out. It covers the page rather than opening over it, has
   no close button, and says plainly why it is there and what follows from each answer.

   It opens only as a page loads. Answering is the way past it, so a grace that runs out during somebody's shift
   waits for the next time they open the app: nobody is stopped in the middle of a reply. */

type Props = {
  doc: LegalKey;
  /** Above the document: what this is and why it is asked now. */
  heading: string;
  lead: ReactNode;
  /** What happens with each answer, in a sentence or two under the text. */
  terms?: ReactNode;
  acceptLabel: string;
  onAccept: () => Promise<void>;
  /** A second way out: signing out, or declining. */
  aside?: ReactNode;
  organization?: string | null;
};

export function LegalGate({ doc, heading, lead, terms, acceptLabel, onAccept, aside, organization }: Props) {
  const found = useApi<LegalDocument>(legalPath(doc));
  const [busy, setBusy] = useState(false);
  return (
    <div className="legal-gate" role="dialog" aria-modal="true" aria-labelledby="legal-gate-title">
      <section className="legal-gate-card">
        <header className="legal-gate-head">
          <span className="legal-gate-icon">
            <Icon name={doc === 'terms' ? 'file' : 'shield'} />
          </span>
          <div>
            <h2 id="legal-gate-title">{heading}</h2>
            <p>{lead}</p>
          </div>
        </header>
        <div className="legal-gate-text" tabIndex={0} aria-label={LEGAL_NAMES[doc]}>
          {found.error ? (
            <ErrorState error={found.error} onRetry={() => void found.refetch()} />
          ) : !found.data ? (
            <PageLoading />
          ) : (
            <LegalText doc={found.data} organization={organization} />
          )}
        </div>
        {terms && <p className="legal-gate-terms">{terms}</p>}
        <footer className="legal-gate-actions">
          <Link className="btn subtle" href={`/legal/${doc}`} target="_blank" rel="noopener">
            <Icon name="link" />
            เปิดเป็นหน้าเต็ม
          </Link>
          <span className="grow" />
          {aside}
          <button
            type="button"
            className="btn primary"
            disabled={busy || !found.data}
            onClick={async () => {
              setBusy(true);
              try {
                await onAccept();
              } finally {
                setBusy(false);
              }
            }}
          >
            <Icon name="check" />
            {acceptLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

/** Whether to show a gate: what the first answer said, kept for the rest of the visit (see above), and let go of once
    the person answered. `due` is the server's overdue flag; `answered` the person's own answer since. */
export function useGateOnLoad(due: boolean | undefined, answered: boolean) {
  const [atLoad, setAtLoad] = useState<boolean | null>(null);
  // Decided once, from the first answer that arrives (state adjusted while rendering, React's own pattern for it).
  if (atLoad === null && due !== undefined) setAtLoad(due);
  return Boolean(atLoad) && !answered;
}
