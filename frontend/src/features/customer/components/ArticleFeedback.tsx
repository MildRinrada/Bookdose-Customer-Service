'use client';

import { useState, useSyncExternalStore } from 'react';
import { Icon } from '@/components/Icon';
import { sendArticleFeedback } from '../api';

/* บทความนี้ช่วยได้ไหม (backend knowledge/feedback.py), under an organization's published article: on the FAQ pages of
   the signed-in customer and the visitor, and inside an answer offered while they write. One say per browser: a random
   token of this browser's own (never who they are) goes with it, and what it said is remembered so the buttons show
   it next time. Markup: styles/pages/chat-answers.css (article-feedback). */

const TOKEN_KEY = 'bookdose:reader';
const SAID_KEY = 'bookdose:article-feedback';

function readerToken(): string {
  try {
    const kept = localStorage.getItem(TOKEN_KEY);
    if (kept && /^[a-f0-9]{32}$/.test(kept)) return kept;
    const made = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(TOKEN_KEY, made);
    return made;
  } catch {
    // Without storage (a private window) the say still counts, once for this page.
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  }
}

function said(articleId: string): boolean | null {
  try {
    const all = JSON.parse(localStorage.getItem(SAID_KEY) || '{}') as Record<string, boolean>;
    return typeof all[articleId] === 'boolean' ? all[articleId] : null;
  } catch {
    return null;
  }
}

function remember(articleId: string, helpful: boolean) {
  try {
    const all = JSON.parse(localStorage.getItem(SAID_KEY) || '{}') as Record<string, boolean>;
    localStorage.setItem(SAID_KEY, JSON.stringify({ ...all, [articleId]: helpful }));
  } catch {
    /* Remembered for this page only. */
  }
}

const noChange = () => () => {};

export function ArticleFeedback({ slug, articleId }: { slug: string; articleId: string }) {
  // What this browser said before, read after the page is drawn (the server knows nothing of it).
  const before = useSyncExternalStore(noChange, () => said(articleId), () => null);
  const [pressed, setChoice] = useState<boolean | null | undefined>(undefined);
  const choice = pressed === undefined ? before : pressed;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const send = async (helpful: boolean) => {
    setBusy(true);
    setProblem('');
    try {
      await sendArticleFeedback(slug, articleId, helpful, readerToken());
      remember(articleId, helpful);
      setChoice(helpful);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="article-feedback" role="group" aria-label="บทความนี้ช่วยได้ไหม">
      <span className="article-feedback-question">
        {choice === null ? 'บทความนี้ช่วยได้ไหม' : choice ? 'ขอบคุณ ดีใจที่ช่วยได้' : 'ขอบคุณ ทีมงานจะนำไปปรับปรุง'}
      </span>
      <button type="button" className={`btn sm${choice === true ? ' active' : ''}`} aria-pressed={choice === true} disabled={busy} onClick={() => void send(true)}>
        <Icon name="check" />
        ช่วยได้
      </button>
      <button type="button" className={`btn sm${choice === false ? ' active' : ''}`} aria-pressed={choice === false} disabled={busy} onClick={() => void send(false)}>
        <Icon name="close" />
        ไม่ช่วย
      </button>
      {problem && <span className="error-text">{problem}</span>}
    </div>
  );
}
