'use client';

import Link from 'next/link';
import { useState, type RefObject } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { AiPortalStatus } from '@/features/ai/components/AiPortalStatus';
import { Composer, MessageThread } from '@/features/inbox';
import { useCustomer } from '@/lib/customer-session';
import { starsText } from '@/lib/format';
import { useInvalidate } from '@/lib/query';
import { OVERVIEW_PATH, chatExportUrl, continueOnLine, rateService, reactToMessage, resolveChatCase, sessionPath } from '../api';
import { chatView, ratingLabels } from '../labels';
import type { PortalSession, PortalSurvey } from '../types';
import { KnownIssuesBar } from '@/features/incidents/KnownIssues';
import { ThanksCard } from './ThanksCard';
import { WaitQueue } from './WaitQueue';
import { ContinueOnLineButton, ContinueOnLinePanel, MovedToLine } from './ContinueOnLine';
import { CallbackButton, CallbackPanel } from './CallbackRequest';
import { ArticleReadPanel, TypingAnswers, type PeekArticle } from './ArticlePeek';

/* One open chat beside the list (pages/customer/customer-chat.html): who it is with, where it stands, the AI or
   person serving it, the messages (an emoji on the team's replies), the thank-you card and the satisfaction
   survey once the case is closed, and the reply box. */

/** After a case is closed the customer is asked how it went: stars, and a few words if they like. `slug` is the
    portal the answer goes to (a guest chat passes "<org>/guest"). */
export function CustomerSurvey({ survey, slug, conversationId, org }: { survey: PortalSurvey; slug: string; conversationId: string; org: string }) {
  const [rating, setRating] = useState(0);
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <>
      {survey.pending && (
        <Form
          className="customer-survey"
          data-form="customer-rate"
          aria-labelledby="customer-survey-title"
          onSubmit={async (values) => {
            if (!values.rating) throw new Error('กรุณาเลือกคะแนน 1-5 ดาว');
            await rateService(slug, conversationId, { rating: Number(values.rating), comment: values.comment || '' });
            toast('ขอบคุณสำหรับคะแนนค่ะ');
            await refresh(`/api/public/${slug}/session`, OVERVIEW_PATH);
          }}
        >
          <strong id="customer-survey-title">ทีมงาน{org ? ` ${org}` : ''} ดูแลเรื่องนี้เป็นอย่างไรบ้าง?</strong>
          <p className="small muted">เลือกดาว 1-5 แล้วเขียนความคิดเห็นเพิ่มได้ถ้าต้องการ</p>
          <div className="star-row" role="radiogroup" aria-label="คะแนนความพึงพอใจ">
            {[1, 2, 3, 4, 5].map((value) => (
              <label key={value} className={`star-btn${value <= rating ? ' on' : ''}`} data-value={value} title={ratingLabels[value]}>
                <input className="sr-only" type="radio" name="rating" value={value} required onChange={() => setRating(value)} />
                <span aria-hidden="true">★</span>
                <span className="sr-only">
                  {value} ดาว · {ratingLabels[value]}
                </span>
              </label>
            ))}
          </div>
          <label className="sr-only" htmlFor="survey-comment">
            ความคิดเห็นเพิ่มเติม
          </label>
          <textarea id="survey-comment" name="comment" maxLength={1000} rows={2} placeholder="มีอะไรอยากบอกทีมงานเพิ่มเติมไหม (ไม่บังคับ)" />
          <button className="btn primary" type="submit">
            <Icon name="send" />
            ส่งความเห็น
          </button>
        </Form>
      )}
      {survey.rating ? (
        <div className="customer-survey done">
          <span className="csat-stars" aria-hidden="true">
            {starsText(survey.rating)}
          </span>
          <span>ขอบคุณสำหรับคะแนน {survey.rating}/5 ค่ะ</span>
          {survey.comment && <p className="customer-survey-comment">“{survey.comment}”</p>}
        </div>
      ) : null}
    </>
  );
}

export function ChatView({
  data,
  slug,
  orgName,
  category,
  reading = null,
  insertRef,
  onCloseReading,
  onAsk,
  articles = [],
  onRead,
}: {
  data: PortalSession;
  slug: string;
  orgName: string;
  category: string;
  /** An answer being read in place of the messages (dropped on the conversation, or opened from its card). */
  reading?: PeekArticle | null;
  insertRef?: RefObject<((text: string) => void) | null>;
  onCloseReading?: () => void;
  onAsk?: (article: PeekArticle) => void;
  /** The organization's published answers, offered above the box as they match what is typed; onRead opens one. */
  articles?: PeekArticle[];
  onRead?: (article: PeekArticle) => void;
}) {
  const view = chatView(data);
  const id = data.conversation.id;
  const reference = data.ticket ? `BD-${data.ticket.number}` : '';
  const survey = data.survey && (data.survey.pending || data.survey.rating) ? data.survey : null;
  const [lineOpen, setLineOpen] = useState(false);
  const { openModal, closeModal, confirm } = useDialogs();
  const refresh = useInvalidate();
  const toast = useToast();
  const me = useCustomer();
  // ปิดเคส: the customer finishes the chat's case themselves (backend automation/closing.py), asked once first.
  const canClose = Boolean(data.ticket && !['resolved', 'closed'].includes(data.ticket.status));
  const askClose = () =>
    confirm({
      title: 'ปัญหาแก้ไขแล้ว',
      message: `เคส ${reference} จะเปลี่ยนเป็นแก้ไขแล้ว และทีมงานจะได้รับแจ้ง ถ้าปัญหากลับมาอีก พิมพ์บอกในแชทได้เลย`,
      confirmLabel: 'ยืนยันว่าแก้ไขแล้ว',
      run: async () => {
        await resolveChatCase(slug, id);
        toast('บันทึกว่าแก้ไขแล้ว ขอบคุณที่แจ้งให้ทราบ');
        await refresh(sessionPath(slug), OVERVIEW_PATH);
      },
    });
  // The AI bar stays while the bot answers (it holds คุยกับเจ้าหน้าที่); once a person has the chat that is one chip.
  const bot = data.ai?.mode === 'bot';
  return (
    <>
      <div className="card-header conv-header">
        <Link className="icon-btn conv-back" href="/customer/chats" aria-label="กลับไปที่รายการแชท">
          <Icon name="back" />
        </Link>
        <div className="conv-title">
          <h2 title={data.conversation.subject}>{data.conversation.subject}</h2>
          <p className="conv-meta">
            <span className="customer-org-badge">คุยกับ {orgName}</span>
            {category && <span className="customer-category-tag">{category}</span>}
            <span className={`customer-state tone-${view.tone}`} id="customer-state-label" data-tone={view.tone} title={view.hint}>
              {view.label}
            </span>
            {!bot && (
              <span className="customer-staff-chip">
                <Icon name="users" />
                เจ้าหน้าที่ดูแลอยู่
              </span>
            )}
            {data.ticket && (
              <Link className="conv-case-link" href={`/customer/cases/${slug}/${data.ticket.id}`} title={`ดูรายละเอียดเคส ${reference}`}>
                เคส {reference}
              </Link>
            )}
          </p>
        </div>
        {canClose && (
          <button type="button" className="btn sm conv-close-case" onClick={askClose} title="แจ้งว่าปัญหาแก้ไขแล้ว และปิดเคสนี้">
            <Icon name="check" />
            ปิดเคส
          </button>
        )}
        <a className="icon-btn conv-download" href={chatExportUrl(slug, id)} download title="ดาวน์โหลดประวัติการคุย" aria-label="ดาวน์โหลดประวัติการคุย">
          <Icon name="download" />
        </a>
        {data.callback && !data.line?.moved && (
          <CallbackButton
            waiting={Boolean(data.callback.waiting)}
            onOpen={() =>
              openModal(
                'ขอให้ติดต่อกลับ',
                <CallbackPanel
                  base={`/api/public/${slug}`}
                  conversationId={id}
                  state={data.callback!}
                  onDone={() => refresh(sessionPath(slug))}
                  onClose={() => closeModal(true)}
                />,
                { narrow: true },
              )
            }
          />
        )}
        <ContinueOnLineButton line={data.line} open={lineOpen} onToggle={() => setLineOpen(!lineOpen)} />
      </div>

      {lineOpen && data.line && !data.line.moved && (
        <ContinueOnLinePanel
          line={data.line}
          request={() => continueOnLine(slug, id)}
          refresh={() => refresh(sessionPath(slug))}
          onClose={() => setLineOpen(false)}
        />
      )}
      <KnownIssuesBar slug={slug} follow />
      {bot && (
        <div className="notice customer-ai-status" id="customer-ai-status">
          <AiPortalStatus ai={data.ai} slug={slug} conversationId={id} />
        </div>
      )}
      {/* The survey is part of the conversation: it follows the newest message and scrolls with the messages. */}
      <MessageThread
        messages={data.messages}
        threadId={id}
        id="customer-thread"
        publicView
        publicSlug={slug}
        ownPhoto={me.avatar}
        readAt={data.staff_read_at}
        onReact={(m, reaction) => reactToMessage(slug, id, m.id, reaction).then(() => refresh(sessionPath(slug)))}
        afterKey={`${JSON.stringify(data.survey)}|${JSON.stringify(data.queue)}|${JSON.stringify(data.thanks)}`}
        after={
          <>
            <WaitQueue queue={data.queue} base={`/api/public/${slug}`} conversationId={id} onChanged={() => refresh(sessionPath(slug))} />
            {data.thanks && <ThanksCard card={data.thanks} slug={slug} conversationId={id} />}
            {survey && (
              <div id="customer-survey">
                <CustomerSurvey survey={survey} slug={slug} conversationId={id} org={orgName} />
              </div>
            )}
          </>
        }
      />
      {reading && onCloseReading && (
        <ArticleReadPanel article={reading} href={`/customer/faq/${reading.id}`} onClose={onCloseReading} onAsk={onAsk} />
      )}
      {/* Carried to LINE: the conversation goes on there, and the web keeps it to read. */}
      {data.line?.moved ? (
        <MovedToLine line={data.line} />
      ) : (
        <Composer
          key={id}
          conversationId={id}
          publicView
          publicSlug={slug}
          insertRef={insertRef}
          // While an answer is open it has the room: the offers step aside until it is closed.
          suggest={onRead && !reading ? (text) => <TypingAnswers articles={articles} text={text} onRead={onRead} /> : undefined}
        />
      )}
    </>
  );
}
