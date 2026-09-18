'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { useToast } from '@/components/ui/Toast';
import { waitForAiJob } from '@/features/ai/api';
import { ArticleForm, type ArticleDraft } from '@/features/knowledge';
import { clockTime, relative } from '@/lib/format';
import { useInvalidate } from '@/lib/query';
import { OVERVIEW_PREFIX, requestArticleDraft, requestBrief } from '../api';
import { botReasonLabels } from '../labels';
import type { BotPerformance, Brief, Insights, KnowledgeGap } from '../types';

/* The owner's cards about AI and the knowledge base: today's summary (made only when asked: it costs a request),
   the questions no article answers with an AI draft of the missing article, and how the chatbot did. Markup:
   dashboard-extras (insights-grid, brief-card, gaps-card, bot-card). */

function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return () => alive.current;
}

function AiOff({ ai }: { ai: Insights['ai'] }) {
  return (
    <p className="ai-off tiny muted">
      {ai.key_configured ? 'เปิด “AI ช่วยร่างคำตอบ” ก่อนจึงใช้ได้' : 'เชื่อม AI (OpenAI หรือ n8n) ก่อนจึงใช้ได้'} ·{' '}
      <Link href="/settings?tab=ai">ตั้งค่า AI</Link>
    </p>
  );
}

export function BriefCard({ brief, ai }: { brief: Brief | null; ai: Insights['ai'] }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const alive = useAlive();
  const [busy, setBusy] = useState(false);
  const usable = ai.key_configured && ai.drafts_enabled;
  const working = busy || brief?.status === 'pending' || brief?.status === 'running';

  const make = async () => {
    setBusy(true);
    try {
      const { id } = await requestBrief();
      await refresh(OVERVIEW_PREFIX);
      const job = await waitForAiJob(id, alive);
      if (job.status === 'failed') toast(job.error || 'AI สรุปไม่สำเร็จ ลองใหม่อีกครั้ง', true);
      await refresh(OVERVIEW_PREFIX);
    } catch (error) {
      toast((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card brief-card" aria-labelledby="brief-title">
      <div className="card-header">
        <div>
          <h2 id="brief-title">
            <Icon name="sparkle" /> สรุปสถานการณ์วันนี้
          </h2>
          <p>AI อ่านตัวเลขของวันนี้เทียบ 7 วันที่ผ่านมา · สร้างเมื่อกดเท่านั้น (ใช้ AI 1 ครั้ง)</p>
        </div>
        {usable && (
          <button type="button" className="btn small" onClick={() => void make()} disabled={working}>
            <Icon name="sparkle" />
            {working ? 'AI กำลังสรุป…' : brief?.status === 'done' ? 'สรุปใหม่' : 'สรุปวันนี้'}
          </button>
        )}
      </div>
      <div className="card-body">
        {!usable ? (
          <AiOff ai={ai} />
        ) : brief?.status === 'done' ? (
          <>
            <ul className="brief-lines">
              {brief.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <p className="tiny muted">สรุปเมื่อ {clockTime(brief.created_at)} น. · ตรวจตัวเลขจริงได้ในหน้ารายงาน</p>
          </>
        ) : working ? (
          <p className="empty-mini">AI กำลังอ่านตัวเลขของวันนี้…</p>
        ) : brief?.status === 'failed' ? (
          <p className="empty-mini">{brief.error || 'สรุปไม่สำเร็จ'} · กดสรุปวันนี้อีกครั้ง</p>
        ) : (
          <p className="empty-mini">กด “สรุปวันนี้” เพื่อให้ AI บอกว่าวันนี้ต่างจากปกติอย่างไร เรื่องไหนเข้ามามาก และควรทำอะไรก่อน</p>
        )}
      </div>
    </section>
  );
}

function GapRow({ gap, ai }: { gap: KnowledgeGap; ai: Insights['ai'] }) {
  const { openModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const alive = useAlive();
  const [busy, setBusy] = useState(false);
  const usable = ai.key_configured && ai.drafts_enabled;

  const write = (draft: ArticleDraft) =>
    openModal('บทความจากคำถามของลูกค้า', <ArticleForm draft={draft} categories={[]} onSaved={() => refresh(OVERVIEW_PREFIX)} />, { wide: true });

  const draftWithAi = async () => {
    setBusy(true);
    try {
      const { id } = await requestArticleDraft(gap.conversations);
      const job = await waitForAiJob(id, alive);
      if (job.status !== 'done') {
        toast(job.status === 'running' ? 'AI ยังร่างไม่เสร็จ ลองกดอีกครั้งในสักครู่' : job.error || 'AI ร่างบทความไม่สำเร็จ', true);
        return;
      }
      const result = job.result as unknown as ArticleDraft;
      write({ title: result.title, category: result.category, body: result.body, visibility: 'public' });
    } catch (error) {
      toast((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="gap-item">
      <div className="gap-head">
        <strong className="gap-label">“{gap.label}”</strong>
        <span className="badge">{gap.count} ครั้ง</span>
      </div>
      {gap.examples.length > 0 && <p className="tiny muted gap-examples">คล้ายกัน: {gap.examples.map((e) => `“${e}”`).join(' · ')}</p>}
      <p className="tiny muted">
        ล่าสุด {relative(gap.last_at)}
        {gap.bot_unsure > 0 && ` · บอตหาบทความตอบไม่ได้ ${gap.bot_unsure} ครั้ง`}
      </p>
      <div className="gap-actions">
        {usable && (
          <button type="button" className="btn primary small" onClick={() => void draftWithAi()} disabled={busy}>
            <Icon name="sparkle" /> {busy ? 'AI กำลังร่าง…' : 'ให้ AI ร่างบทความ'}
          </button>
        )}
        <button type="button" className="btn small" onClick={() => write({ title: '', category: 'ทั่วไป', body: '', visibility: 'public' })}>
          <Icon name="edit" /> เขียนเอง
        </button>
      </div>
    </li>
  );
}

const GAPS_SHOWN = 3;

export function GapsCard({ insights }: { insights: Insights }) {
  const { gaps, ai, days } = insights;
  const [all, setAll] = useState(false);
  const shown = all ? gaps.groups : gaps.groups.slice(0, GAPS_SHOWN);
  return (
    <section className="card gaps-card" aria-labelledby="gaps-title">
      <div className="card-header">
        <div>
          <h2 id="gaps-title">คำถามที่ยังไม่มีบทความตอบ</h2>
          <p>
            {days} วันล่าสุด · {gaps.total} คำถามที่บทความสาธารณะยังตอบไม่ได้ เรียงจากที่ถามบ่อยที่สุด
          </p>
        </div>
        <Icon name="book" />
      </div>
      <div className="card-body">
        {gaps.groups.length ? (
          <>
            <ol className="gap-list">
              {shown.map((gap) => (
                <GapRow key={gap.conversations[0]} gap={gap} ai={ai} />
              ))}
            </ol>
            {gaps.groups.length > GAPS_SHOWN && (
              <button type="button" className="btn subtle small gap-more" onClick={() => setAll(!all)} aria-expanded={all}>
                {all ? 'แสดงน้อยลง' : `ดูอีก ${gaps.groups.length - GAPS_SHOWN} กลุ่ม`}
              </button>
            )}
          </>

        ) : (
          <div className="empty-mini">ทุกคำถามของลูกค้าใน {days} วันมีบทความตอบแล้ว ✨</div>
        )}
        {!(ai.key_configured && ai.drafts_enabled) && gaps.groups.length > 0 && <AiOff ai={ai} />}
        <p className="tiny muted">บทความที่เผยแพร่ให้ลูกค้าช่วยให้ลูกค้าหาคำตอบเองและให้บอตตอบได้ เคสจึงลดลง</p>
      </div>
    </section>
  );
}

export function BotCard({ bot, ai, days }: { bot: BotPerformance; ai: Insights['ai']; days: number }) {
  const finished = bot.resolved + bot.handed_off;
  const share = (n: number) => (finished ? Math.round((100 * n) / finished) : 0);
  return (
    <section className="card bot-card" aria-labelledby="bot-title">
      <div className="card-header">
        <div>
          <h2 id="bot-title">ผลงานของบอต AI</h2>
          <p>
            {days} วันล่าสุด · {bot.conversations} บทสนทนาที่บอตเริ่มตอบ · {bot.answers} คำตอบ
          </p>
        </div>
        <Icon name="chat" />
      </div>
      <div className="card-body">
        {!bot.conversations ? (
          <p className="empty-mini">
            {ai.chatbot_enabled ? 'บอตยังไม่ได้คุยกับลูกค้าในช่วงนี้' : 'ยังไม่ได้เปิดบอต AI ตอบลูกค้า'} ·{' '}
            <Link href="/settings?tab=ai">ตั้งค่า AI</Link>
          </p>
        ) : (
          <>
            <div className="bot-score">
              <span className="bot-big mono">{share(bot.resolved)}%</span>
              <span className="muted">ตอบจบเองโดยไม่ต้องส่งต่อ</span>
            </div>
            <div className="bot-bars">
              <div className="bot-bar">
                <span>ตอบจบเอง</span>
                <progress value={bot.resolved} max={Math.max(1, finished)} aria-label={`ตอบจบเอง ${bot.resolved}`} />
                <span className="mono">{bot.resolved}</span>
              </div>
              <div className="bot-bar handed">
                <span>ส่งต่อให้คน</span>
                <progress value={bot.handed_off} max={Math.max(1, finished)} aria-label={`ส่งต่อให้คน ${bot.handed_off}`} />
                <span className="mono">{bot.handed_off}</span>
              </div>
            </div>
            {bot.reasons.length > 0 && (
              <>
                <h3 className="bot-reasons-title">เหตุผลที่ส่งต่อบ่อยที่สุด</h3>
                <ul className="bot-reasons">
                  {bot.reasons.slice(0, 4).map((r) => (
                    <li key={r.reason}>
                      <span>{botReasonLabels[r.reason] ?? r.reason}</span>
                      <span className="mono">{r.count}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {bot.waiting > 0 && <p className="tiny muted">อีก {bot.waiting} บทสนทนายังคุยกับบอตอยู่หรือบอตยังไม่ได้ตอบ</p>}
          </>
        )}
      </div>
    </section>
  );
}
