'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { Brand } from '@/components/shell/chrome';
import { TextSizeControls } from '@/components/shell/TextSize';
import { useDialogs } from '@/components/ui/Dialogs';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { Markdown } from '@/features/rich/Markdown';
import { date } from '@/lib/format';
import { useApi } from '@/lib/query';
import { legalPath } from './api';
import type { LegalDocument, LegalKey } from './types';

/* เอกสารกฎหมาย as readers meet them (backend modules/legal): the page of its own each document has (/legal/<key>),
   which emails, contracts and footers can point at, and the window a form opens it in, with the button that agrees
   to it at the foot of the text. Both show the version the platform admin published, so what somebody agreed to is
   the text they were shown. The customer notice is asked for with the organization's name, which the server puts in
   for {{องค์กร}}. Markup: pages/legal.css, and the text set as pages/auth.css .privacy-doc. */

export const LEGAL_NAMES: Record<LegalKey, string> = {
  terms: 'ข้อตกลงการใช้บริการ',
  'platform-privacy': 'ประกาศความเป็นส่วนตัวสำหรับผู้ใช้งานระบบ',
  'customer-privacy': 'ประกาศความเป็นส่วนตัวสำหรับลูกค้า',
};

/** The organization's name where the customer notice says {{องค์กร}}. */
const named = (body: string, organization?: string | null) => (organization ? body.split('{{องค์กร}}').join(organization) : body);

/** The text of a document, with its version and date above it. */
export function LegalText({ doc, organization }: { doc: LegalDocument; organization?: string | null }) {
  return (
    <div className="privacy-doc">
      <p className="tiny muted privacy-version" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
        ฉบับ {doc.version} · เผยแพร่ {date(doc.published_at)}
      </p>
      <Markdown text={named(doc.body, organization)} />
    </div>
  );
}

/** What the window shows: the document fetched, then its text, with the buttons under the text. */
function LegalWindow({ doc, organization, onAccept }: { doc: LegalKey; organization?: string | null; onAccept?: () => void }) {
  const { closeModal } = useDialogs();
  const found = useApi<LegalDocument>(legalPath(doc));
  if (found.error) return <ErrorState error={found.error} onRetry={() => void found.refetch()} />;
  if (!found.data) return <PageLoading />;
  return (
    <>
      <LegalText doc={found.data} organization={organization} />
      <div className="form-actions privacy-actions">
        <Link className="btn" href={`/legal/${doc}`} target="_blank" rel="noopener">
          <Icon name="link" />
          เปิดเป็นหน้าเต็ม
        </Link>
        <button type="button" className="btn" onClick={() => closeModal(true)}>
          ปิด
        </button>
        {onAccept && (
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              onAccept();
              closeModal(true);
            }}
          >
            <Icon name="check" />
            ฉันอ่านและยอมรับ
          </button>
        )}
      </div>
    </>
  );
}

/** The button a form opens a document from. `onAccept` puts the agreeing button at the foot of the text, where
    somebody has passed the text to reach it; without it the window only closes. */
export function LegalButton({
  doc,
  organization,
  label,
  onAccept,
  link = false,
}: {
  doc: LegalKey;
  organization?: string | null;
  label?: string;
  onAccept?: () => void;
  /** A link in a sentence rather than a button of its own. */
  link?: boolean;
}) {
  const { openModal } = useDialogs();
  const open = () => openModal(LEGAL_NAMES[doc], <LegalWindow doc={doc} organization={organization} onAccept={onAccept} />);
  if (link)
    return (
      <button type="button" className="legal-link-button" onClick={open}>
        {label ?? LEGAL_NAMES[doc]}
      </button>
    );
  return (
    <button type="button" className="btn privacy-open" onClick={open}>
      <Icon name="shield" />
      {label ?? `อ่าน${LEGAL_NAMES[doc]}`}
    </button>
  );
}

/** /legal/<key>: the document on a page of its own, for anyone, signed in or not. */
export function LegalPage({ doc }: { doc: LegalKey }) {
  const found = useApi<LegalDocument>(legalPath(doc));
  const others = (Object.keys(LEGAL_NAMES) as LegalKey[]).filter((key) => key !== doc);
  return (
    <main className="single-page legal-page">
      <TextSizeControls />
      <Brand />
      <section className="card">
        {found.error ? (
          <ErrorState error={found.error} onRetry={() => void found.refetch()} />
        ) : !found.data ? (
          <PageLoading />
        ) : (
          <>
            <header className="legal-head">
              <h1>{found.data.title}</h1>
              <p className="tiny muted">
                ฉบับ {found.data.version} · เผยแพร่ {date(found.data.published_at)}
              </p>
            </header>
            <div className="privacy-doc">
              <Markdown text={named(found.data.body, 'องค์กร')} />
            </div>
          </>
        )}
      </section>
      <nav className="legal-others tiny" aria-label="เอกสารอื่น">
        {others.map((key) => (
          <Link key={key} href={`/legal/${key}`}>
            {LEGAL_NAMES[key]}
          </Link>
        ))}
        <Link href="/login">
          <Icon name="back" /> กลับไปหน้าเข้าสู่ระบบ
        </Link>
      </nav>
    </main>
  );
}
