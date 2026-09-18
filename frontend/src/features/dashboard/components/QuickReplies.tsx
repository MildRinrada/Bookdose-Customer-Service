'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui/Toast';
import { usePreferences } from '@/features/staff-account/prefs';
import { staffAccountTabPath } from '@/features/staff-account/tabs';

/* คำตอบด่วน on the overview: the member's own quick replies (ตั้งค่าบัญชี → คำตอบด่วนและคีย์ลัด), one click copies
   the text to paste in any chat, email or LINE reply. In a reply box "/" and the shortcut still insert it.
   Markup: pages/dashboard-widgets (dash-replies). */

const SHOWN = 5;

export function QuickReplies() {
  const snippets = usePreferences().data?.preferences.snippets ?? [];
  const toast = useToast();
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (shortcut: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(shortcut);
      window.setTimeout(() => setCopied((c) => (c === shortcut ? null : c)), 1600);
    } catch {
      toast('เบราว์เซอร์ไม่อนุญาตให้คัดลอก ลองเลือกข้อความเองแทน', true);
    }
  };

  return (
    <section className="card dash-replies" aria-labelledby="quick-replies-title">
      <div className="card-header">
        <div>
          <h2 id="quick-replies-title">คำตอบด่วน</h2>
          <p>กดเพื่อคัดลอก · ในช่องตอบพิมพ์ / ตามด้วยคีย์ลัด</p>
        </div>
        <Link className="icon-btn" href={staffAccountTabPath('replies')} aria-label="จัดการคำตอบด่วน" title="จัดการคำตอบด่วน">
          <Icon name="edit" />
        </Link>
      </div>
      <div className="card-body">
        {snippets.length ? (
          <ul className="quick-reply-list">
            {snippets.slice(0, SHOWN).map((s) => (
              <li key={s.shortcut}>
                <button type="button" className={copied === s.shortcut ? 'copied' : ''} onClick={() => void copy(s.shortcut, s.text)} title={s.text}>
                  <span className="quick-reply-key">/{s.shortcut}</span>
                  <span className="quick-reply-text">{s.text}</span>
                  <span className="quick-reply-state" aria-live="polite">
                    {copied === s.shortcut ? 'คัดลอกแล้ว ✓' : <Icon name="file" />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-mini">
            ยังไม่มีคำตอบด่วน · <Link href={staffAccountTabPath('replies')}>สร้างข้อความที่ใช้บ่อย</Link>
          </div>
        )}
        {snippets.length > SHOWN && (
          <Link className="small" href={staffAccountTabPath('replies')}>
            ดูทั้งหมด {snippets.length} ข้อความ →
          </Link>
        )}
      </div>
    </section>
  );
}
