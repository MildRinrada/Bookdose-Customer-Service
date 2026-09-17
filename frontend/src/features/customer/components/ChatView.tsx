'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { AiPortalStatus } from '@/features/ai/components/AiPortalStatus';
import { Composer, MessageThread } from '@/features/inbox';
import { starsText } from '@/lib/format';
import { useInvalidate } from '@/lib/query';
import { OVERVIEW_PATH, rateService } from '../api';
import { chatView, ratingLabels } from '../labels';
import type { PortalSession, PortalSurvey } from '../types';

/* One open chat beside the list (pages/customer/customer-chat.html): who it is with, where it stands, the AI or
   person serving it, the messages, the satisfaction survey once the case is closed, and the reply box. */

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
}: {
  data: PortalSession;
  slug: string;
  orgName: string;
  category: string;
}) {
  const view = chatView(data);
  const id = data.conversation.id;
  const reference = data.ticket ? `BD-${data.ticket.number}` : '';
  const survey = data.survey && (data.survey.pending || data.survey.rating) ? data.survey : null;
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
            <span className={`customer-state tone-${view.tone}`} id="customer-state-label" data-tone={view.tone}>
              {view.label}
            </span>
            {data.ticket && (
              <Link className="conv-case-link" href={`/customer/cases/${slug}/${data.ticket.id}`} title={`ดูรายละเอียดเคส ${reference}`}>
                เคส {reference}
              </Link>
            )}
            <span className="customer-state-hint" id="customer-state-hint">
              {view.hint}
            </span>
          </p>
        </div>
      </div>
      <div className="notice customer-ai-status" id="customer-ai-status">
        <AiPortalStatus ai={data.ai} slug={slug} conversationId={id} />
      </div>
      {/* The survey is part of the conversation: it follows the newest message and scrolls with the messages. */}
      <MessageThread
        messages={data.messages}
        threadId={id}
        id="customer-thread"
        publicView
        publicSlug={slug}
        readAt={data.staff_read_at}
        afterKey={JSON.stringify(data.survey)}
        after={
          survey && (
            <div id="customer-survey">
              <CustomerSurvey survey={survey} slug={slug} conversationId={id} org={orgName} />
            </div>
          )
        }
      />
      <Composer key={id} conversationId={id} publicView publicSlug={slug} />
    </>
  );
}
