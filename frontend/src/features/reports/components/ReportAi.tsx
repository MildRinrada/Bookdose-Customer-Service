'use client';

import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { date, relative } from '@/lib/format';
import { useUiState } from '@/lib/ui-state';
import { botReasonLabels } from '@/features/dashboard/labels';
import { tileDays } from '../insights';
import type { ReportArticles, ReportBot, ReportExtras } from '../types';

/* The report's AI and knowledge base part (admins; GET /api/reports/extras): what the chatbot solved alone and what it
   handed on, day by day or week by week, and which articles the team leans on or marks as not helpful. The questions
   no article answers are only counted here; writing the articles happens on the overview. Markup: pages/report-insights. */

type Slot = { start: Date; resolved: number; handed_off: number; waiting: number };

/** The chatbot's days in the period as tiles (tileDays: a day, a week or 30 days each). */
function slots(bot: ReportBot, from: string, to: string): Slot[] {
  const first = new Date(from + 'T00:00:00');
  const last = new Date(to + 'T00:00:00');
  const days = Math.round((last.getTime() - first.getTime()) / 86400000) + 1;
  const width = tileDays(days);
  const list: Slot[] = [];
  for (let i = 0; i < days; i += width) {
    const start = new Date(first);
    start.setDate(first.getDate() + i);
    list.push({ start, resolved: 0, handed_off: 0, waiting: 0 });
  }
  for (const d of bot.days) {
    const at = new Date(d.day + 'T00:00:00');
    const slot = list[Math.floor(Math.round((at.getTime() - first.getTime()) / 86400000) / width)];
    if (!slot) continue;
    slot.resolved += d.resolved;
    slot.handed_off += d.handed_off;
    slot.waiting += d.waiting;
  }
  return list;
}

export function BotReportCard({ extras, from, to }: { extras: ReportExtras; from: string; to: string }) {
  const bot = extras.bot;
  if (!bot) return null;
  const finished = bot.resolved + bot.handed_off;
  const share = (n: number) => (finished ? Math.round((100 * n) / finished) : 0);
  const tiles = slots(bot, from, to);
  const width = tileDays(Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1);
  const unit = width === 1 ? 'รายวัน' : width === 7 ? 'รายสัปดาห์' : 'ราย 30 วัน';
  return (
    <section className="card report-card">
      <div className="card-header">
        <div>
          <h2>ผลงานของบอต AI</h2>
          <p>
            {bot.conversations} บทสนทนาที่บอตเริ่มตอบในช่วงนี้ · {bot.answers} คำตอบจากบอต
          </p>
        </div>
        <Icon name="sparkle" />
      </div>
      <div className="card-body">
        {!bot.conversations ? (
          <p className="empty-mini">
            {extras.ai?.chatbot_enabled ? 'บอตยังไม่ได้คุยกับลูกค้าในช่วงนี้' : 'ยังไม่ได้เปิดบอต AI ตอบลูกค้า'} · <Link href="/settings?tab=ai">ตั้งค่า AI</Link>
          </p>
        ) : (
          <>
            <div className="report-figures">
              <div className={finished && share(bot.resolved) < 50 ? 'warn' : ''}>
                <span>ตอบจบเองโดยไม่ต้องส่งต่อ</span>
                <strong>{finished ? `${share(bot.resolved)}%` : '-'}</strong>
                <small>{bot.resolved} บทสนทนา</small>
              </div>
              <div>
                <span>ส่งต่อให้เจ้าหน้าที่</span>
                <strong>{finished ? `${share(bot.handed_off)}%` : '-'}</strong>
                <small>{bot.handed_off} บทสนทนา</small>
              </div>
              {bot.waiting > 0 && (
                <div>
                  <span>ยังคุยกับบอตอยู่</span>
                  <strong>{bot.waiting}</strong>
                  <small>ยังไม่จบหรือบอตยังไม่ได้ตอบ</small>
                </div>
              )}
            </div>
            {tiles.length > 1 && (
              <div className="report-weeks" aria-label={`ตอบจบเอง${unit}`}>
                {tiles.map((t) => {
                  const done = t.resolved + t.handed_off;
                  const pct = done ? Math.round((100 * t.resolved) / done) : null;
                  return (
                    <div
                      key={t.start.toISOString()}
                      className="report-week"
                      title={`${width > 1 ? 'ช่วงเริ่ม ' : ''}${date(t.start)} · ตอบจบเอง ${t.resolved} · ส่งต่อ ${t.handed_off}`}
                    >
                      <span className={`report-week-score${pct == null ? ' none' : pct < 50 ? ' low' : ''}`}>{pct == null ? '–' : `${pct}%`}</span>
                      <span className="report-week-day">{date(t.start)}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {bot.reasons.length > 0 && (
              <>
                <h3 className="report-subhead">เหตุผลที่ส่งต่อให้เจ้าหน้าที่</h3>
                {bot.reasons.slice(0, 5).map((r) => (
                  <div key={r.reason} className="bar-row" title={`${r.count} บทสนทนา`}>
                    <span className="bar-label">{botReasonLabels[r.reason] ?? r.reason}</span>
                    <progress value={r.count} max={Math.max(1, bot.handed_off)} aria-label={`${botReasonLabels[r.reason] ?? r.reason} ${r.count}`} />
                    <span className="bar-value">
                      {r.count}
                      <small className="muted"> · {Math.round((100 * r.count) / Math.max(1, bot.handed_off))}%</small>
                    </span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** Opens the knowledge base already searching for the article. */
function ArticleLink({ title }: { title: string }) {
  const [, setQuery] = useUiState('knowledge:query', '');
  return (
    <Link href="/knowledge" className="truncate" onClick={() => setQuery(title)}>
      {title}
    </Link>
  );
}

function UseKinds({ a }: { a: ReportArticles['top'][number] }) {
  const parts = [
    a.inserted ? `ใส่ในคำตอบ ${a.inserted}` : '',
    a.copied ? `คัดลอก ${a.copied}` : '',
    a.linked ? `ส่งลิงก์ ${a.linked}` : '',
    `${a.people} คนใช้`,
  ].filter(Boolean);
  return <small className="muted">{parts.join(' · ')}</small>;
}

export function ArticlesCard({ extras }: { extras: ReportExtras }) {
  const a = extras.articles;
  if (!a) return null;
  const most = Math.max(1, ...a.top.map((t) => t.uses));
  const gaps = extras.gaps;
  return (
    <section className="card report-card">
      <div className="card-header">
        <div>
          <h2>คลังความรู้ที่ทีมใช้</h2>
          <p>
            ใช้ตอบลูกค้า {a.uses} ครั้งในช่วงนี้ · ถูกใช้ {a.used_articles} จาก {a.articles} บทความ
          </p>
        </div>
        <Icon name="book" />
      </div>
      <div className="card-body">
        {a.top.length ? (
          <>
            <h3 className="report-subhead report-subhead-first">บทความที่ใช้บ่อยที่สุด</h3>
            <ol className="report-articles">
              {a.top.map((t, i) => (
                <li key={t.id}>
                  <span className="report-rank">{i + 1}</span>
                  <span className="report-article-body">
                    <ArticleLink title={t.title} />
                    <UseKinds a={t} />
                    <progress className="report-share" value={t.uses} max={most} aria-hidden="true" />
                  </span>
                  <span className="report-article-count">
                    <strong>{t.uses}</strong>
                    {t.helpful + t.unhelpful > 0 && (
                      <small className={t.unhelpful > t.helpful ? 'report-low' : 'muted'}>
                        <Icon name={t.unhelpful > t.helpful ? 'thumbDown' : 'thumbUp'} /> {Math.round((100 * t.helpful) / (t.helpful + t.unhelpful))}%
                      </small>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="empty-mini">ทีมยังไม่ได้ใช้บทความตอบลูกค้าในช่วงนี้ · คัดลอกหรือใส่บทความในคำตอบได้จากกล่องข้อความ</p>
        )}
        {a.unhelpful.length > 0 && (
          <>
            <h3 className="report-subhead">ทีมโหวตว่าไม่ช่วย ควรปรับปรุง</h3>
            <ul className="report-comments">
              {a.unhelpful.map((u) => (
                <li key={u.id} className="low">
                  <span className="report-comment-stars report-votes">
                    <Icon name="thumbDown" /> {u.unhelpful}
                  </span>
                  <span className="report-comment-body">
                    <ArticleLink title={u.title} />
                    <small className="muted">
                      {u.category} · ช่วย {u.helpful} · ไม่ช่วย {u.unhelpful} · แก้ไขล่าสุด {relative(u.updated_at)}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {gaps && (
          <div className={`report-gaps${gaps.total ? ' has' : ''}`}>
            <Icon name="chat" />
            <span>
              {gaps.total ? (
                <>
                  ลูกค้าถาม <strong>{gaps.total} คำถาม</strong> ที่ยังไม่มีบทความตอบ
                  {gaps.groups[0] && <> เช่น “{gaps.groups[0].label}”</>} · <Link href="/dashboard">เขียนบทความจากหน้าภาพรวม</Link>
                </>
              ) : (
                'ทุกคำถามของลูกค้าในช่วงนี้มีบทความตอบแล้ว'
              )}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
