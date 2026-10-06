'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { ErrorState, PageLoading } from '@/components/ui/display';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { Markdown } from '@/features/rich/Markdown';
import { RichTextField, RichToolbar, useRichEditor } from '@/features/rich/RichEditor';
import type { RichFormat } from '@/features/rich/types';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { LEGAL_PATH, legalVersionPath, publishLegal, saveLegalDraft } from './api';
import { AcceptanceList, ProviderCard } from './ConsoleParts';
import type { LegalDocument, LegalEntry, LegalKey, LegalOverview } from './types';

/* Platform console → เอกสารกฎหมาย (backend modules/legal): the terms of service and the two privacy notices, written
   in the same editor the articles are written in (features/rich) and published in versions. Editing changes a draft
   only; เผยแพร่ makes it the text every page shows and every new sign-up agrees to, and keeps the old versions,
   because an acceptance names one of them. Markup: pages/legal.css, with the editor's own (pages/knowledge.css). */

/** What a legal document is written with: emphasis, two levels of heading, lists and links. No images or code. */
const LEGAL_TOOLS: Array<RichFormat | '|'> = ['bold', 'italic', 'underline', '|', 'h1', 'h2', 'normal', '|', 'bullet', 'number', '|', 'link'];

const HINTS: Partial<Record<LegalKey, string>> = {
  'customer-privacy': 'เขียน {{องค์กร}} ตรงที่ต้องการชื่อองค์กร ระบบจะใส่ชื่อองค์กรของลูกค้าให้เมื่อแสดง',
};

export function LegalScreen() {
  const overview = useApi<LegalOverview>(LEGAL_PATH);
  const [open, setOpen] = useState<LegalKey>('terms');
  if (overview.error) return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  if (!overview.data) return <PageLoading />;
  const entry = overview.data.documents.find((d) => d.key === open) ?? overview.data.documents[0];
  return (
    <>
      <Link href="/platform/settings" className="back-link">
        <Icon name="back" />
        ตั้งค่าระบบ
      </Link>
      <div className="page-heading">
        <div>
          <h1>เอกสารกฎหมาย</h1>
          <p>ข้อตกลงการใช้บริการและประกาศความเป็นส่วนตัว แก้ไขที่นี่แล้วเผยแพร่เป็นฉบับ ฉบับที่มีคนยอมรับไว้แล้วจะไม่ถูกแก้ย้อนหลัง</p>
        </div>
      </div>
      <nav className="legal-tabs" aria-label="เอกสาร">
        {overview.data.documents.map((d) => (
          <button key={d.key} type="button" className={`legal-tab${d.key === entry.key ? ' active' : ''}`} aria-current={d.key === entry.key ? 'page' : undefined} onClick={() => setOpen(d.key)}>
            <Icon name={d.key === 'terms' ? 'file' : 'shield'} />
            <span>
              {d.name}
              <small>{d.versions[0] ? `ฉบับ ${d.versions[0].version}` : 'ยังไม่เผยแพร่'}{d.changed ? ' · มีร่างที่ยังไม่เผยแพร่' : ''}</small>
            </span>
          </button>
        ))}
      </nav>
      <Editor key={entry.key} entry={entry} />
      <ProviderCard />
    </>
  );
}

function Editor({ entry }: { entry: LegalEntry }) {
  const editor = useRichEditor();
  const toast = useToast();
  const refresh = useInvalidate();
  const { confirm, openModal } = useDialogs();
  const [title, setTitle] = useState(entry.draft.title);
  const [body, setBody] = useState(entry.draft.body);
  const dirty = title !== entry.draft.title || body !== entry.draft.body;
  const live = entry.versions[0];

  const save = async () => {
    await saveLegalDraft(entry.key, { title, body });
    toast('บันทึกฉบับร่างแล้ว · ยังไม่มีผลจนกว่าจะเผยแพร่');
    await refresh(LEGAL_PATH);
  };
  const publish = () =>
    confirm({
      title: `เผยแพร่ ${entry.name}`,
      message: 'ฉบับร่างจะกลายเป็นฉบับที่ทุกหน้าแสดง และผู้ที่สมัครหลังจากนี้จะยอมรับฉบับนี้ ฉบับเดิมยังเก็บไว้ให้ดูย้อนหลัง',
      confirmLabel: 'เผยแพร่',
      run: async () => {
        if (dirty) await saveLegalDraft(entry.key, { title, body });
        const { version } = await publishLegal(entry.key);
        toast(`เผยแพร่ฉบับ ${version} แล้ว`);
        await refresh(LEGAL_PATH);
      },
    });
  const show = (version: string) => openModal(`${entry.name} ฉบับ ${version}`, <OldVersion doc={entry.key} version={version} />, { wide: true });

  return (
    <section className="card legal-card">
      <div className="card-header">
        <div>
          <h2>{entry.name}</h2>
          <p>
            {live ? `ฉบับที่ใช้อยู่ ${live.version} · เผยแพร่ ${date(live.published_at)} โดย ${live.published_by}` : 'ยังไม่เคยเผยแพร่'} ·{' '}
            <button type="button" className="legal-link-button" onClick={() => openModal(`ผู้ยอมรับ${entry.name}`, <AcceptanceList doc={entry.key} />, { wide: true })}>
              มีผู้ยอมรับแล้ว {entry.accepted} ครั้ง
            </button>
          </p>
        </div>
        <Link className="btn sm" href={`/legal/${entry.key}`} target="_blank" rel="noopener">
          <Icon name="link" />
          เปิดหน้าสาธารณะ
        </Link>
      </div>
      <div className="card-body legal-doc">
        <Form className="article-editor legal-form" data-form="legal-draft" onSubmit={save}>
          <div className="field">
            <label htmlFor="legal-title">ชื่อเอกสาร</label>
            <input id="legal-title" name="title" value={title} maxLength={200} required onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field editor-field">
            <div className="editor-head">
              <label htmlFor="legal-body">เนื้อหา</label>
              {(dirty || entry.changed) && <span className="legal-unpublished">มีการแก้ไขที่ยังไม่เผยแพร่</span>}
            </div>
            <RichToolbar editor={editor} tools={LEGAL_TOOLS} label="จัดรูปแบบเอกสาร" className="editor-toolbar" role="toolbar" />
            <RichTextField
              editor={editor}
              id="legal-body"
              name="body"
              defaultValue={entry.draft.body}
              maxLength={200000}
              label="เนื้อหาเอกสาร"
              placeholder="เขียนเอกสารที่นี่"
              className="article-content editor-input legal-input"
              onChange={setBody}
            />
            <div className="editor-foot">
              <small className="muted">ข้อความที่เห็นคือหน้าตาที่ผู้อ่านจะเห็น</small>
              {HINTS[entry.key] && <small className="muted">{HINTS[entry.key]}</small>}
            </div>
          </div>
          <div className="form-actions legal-actions">
            <span className="tiny muted legal-saved">
              {entry.draft.updated_at ? `ร่างบันทึกล่าสุด ${date(entry.draft.updated_at, true)} โดย ${entry.draft.updated_by}` : ''}
            </span>
            <button type="submit" className="btn" disabled={!dirty}>
              บันทึกฉบับร่าง
            </button>
            <button type="button" className="btn primary" disabled={!dirty && !entry.changed} onClick={publish}>
              <Icon name="send" />
              เผยแพร่เป็นฉบับใหม่
            </button>
          </div>
        </Form>
        <aside className="legal-side" aria-label="ฉบับที่เผยแพร่แล้ว">
          <h3>ฉบับที่เผยแพร่แล้ว</h3>
          {entry.versions.length ? (
            <ol className="legal-versions">
              {entry.versions.map((v, i) => (
                <li key={v.version} className={i === 0 ? 'live' : undefined}>
                  <button type="button" className="legal-version" onClick={() => show(v.version)}>
                    <strong>ฉบับ {v.version}</strong>
                    <span>
                      {date(v.published_at)} · {v.published_by}
                    </span>
                  </button>
                  {i === 0 && <span className="legal-live-tag">ใช้อยู่</span>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="tiny muted">ยังไม่มี</p>
          )}
          <p className="tiny muted">ฉบับที่เผยแพร่แล้วแก้ไม่ได้ เพราะมีผู้ยอมรับฉบับนั้นไว้ การแก้ไขทุกครั้งคือฉบับใหม่</p>
        </aside>
      </div>
    </section>
  );
}

function OldVersion({ doc, version }: { doc: LegalKey; version: string }) {
  const found = useApi<LegalDocument>(legalVersionPath(doc, version));
  if (found.error) return <ErrorState error={found.error} />;
  if (!found.data) return <PageLoading />;
  return (
    <div className="privacy-doc">
      <p className="tiny muted">เผยแพร่ {date(found.data.published_at, true)} โดย {found.data.published_by}</p>
      <Markdown text={found.data.body} />
    </div>
  );
}
