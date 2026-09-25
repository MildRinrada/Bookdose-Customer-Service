'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { PrivacyTag } from '@/components/ui/display';
import { MoodTag } from '@/components/ui/MoodTag';
import { useToast } from '@/components/ui/Toast';
import { AiControls } from '@/features/ai/components/AiControls';
import { ConversationSummary } from '@/features/ai/components/ConversationSummary';
import { ContactHeadsUp } from '@/features/contacts/components/ContactProfileParts';
import { reachText } from '@/features/guest/labels';
import { useRunAction } from '@/components/ui/actions';
import { channelIcons, channelNames, priorityLabels, statusLabels } from '@/lib/labels';
import { useInvalidate } from '@/lib/query';
import { useWork } from '@/lib/session';
import { CONVERSATION_PREFIXES, openTicketFromConversation, setConversationStatus } from '../api';
import type { ConversationDetail } from '../types';
import { ColleaguesHere } from './ColleaguesHere';
import { Composer } from './Composer';
import { CustomerAvatar } from './InboxItem';
import { MessageThread, ThreadFilter } from './MessageThread';
import { translateTo } from './MessageTranslation';
import { useManageMessages } from './useManageMessages';

/* The open conversation beside the inbox list: who and where from, its case, AI state, open/close, the thread and
   the composer. Markup: pages/inbox/conversation-view. Key it by the conversation id. */

export function ConversationView({ data }: { data: ConversationDetail }) {
  const { conversation: c, ticket: t, contact, messages } = data;
  const work = useWork();
  // Correcting or taking back a message of this conversation (web chat and internal notes only).
  const manage = useManageMessages(c, work);
  const router = useRouter();
  const toast = useToast();
  const refresh = useInvalidate();
  const run = useRunAction();
  const [notesOnly, setNotesOnly] = useState(false);
  const open = c.status === 'open';
  const guest = c.guest ?? contact.guest;
  const nextStatus = open ? 'closed' : 'open';

  return (
    <>
      <div className="card-header conv-header">
        <Link className="icon-btn conv-back" href="/inbox" aria-label="กลับไปที่รายการบทสนทนา">
          <Icon name="back" />
        </Link>
        <CustomerAvatar name={contact.name} id={contact.id} />
        <div className="conv-title">
          <h2 title={c.subject}>{c.subject}</h2>
          <p className="conv-meta conv-facts">
            <strong>{contact.name}</strong>
            {contact.email && (
              <span className="conv-email" title={contact.email}>
                {contact.email}
              </span>
            )}
            <span className="conv-fact">
              <Icon name={channelIcons[c.channel] ?? 'chat'} />
              {channelNames[c.channel] ?? c.channel}
            </span>
            {guest && (
              <span className="conv-fact" title={`ลูกค้าแชทโดยไม่ได้เข้าสู่ระบบ · ${reachText(guest.follow)}`}>
                ผู้เยี่ยมชม · {reachText(guest.follow)}
              </span>
            )}
            {c.category && (
              <span className="conv-fact" title="หมวดที่ลูกค้าเลือก">
                {c.category}
              </span>
            )}
            {t && (
              <Link className="conv-case-link" href={`/tickets/${t.id}`} title={`เปิดรายละเอียดเคส BD-${t.number}`}>
                BD-{t.number} · {statusLabels[t.status] ?? t.status}
                {['high', 'urgent'].includes(t.priority) && <span className="conv-urgent"> · {priorityLabels[t.priority]}</span>}
              </Link>
            )}
            {open && c.mood && (
              <MoodTag mood={{ mood_level: c.mood.level, mood_urgent: c.mood.urgent, mood_reason: c.mood.reason, mood_source: c.mood.source }} />
            )}
            {!open && <span className="conv-fact">ปิดบทสนทนาแล้ว</span>}
          </p>
        </div>
        <div className="conv-actions">
          <span className="inbox-ai-status" data-ai-controls={c.id}>
            <AiControls conversation={c} />
          </span>
          {!t && (
            <button
              type="button"
              className="btn sm"
              title="เปิดเคสจากบทสนทนานี้"
              onClick={() =>
                run(async () => {
                  const result = await openTicketFromConversation(c.id);
                  toast('เปิดเคสจากบทสนทนาแล้ว');
                  await refresh(...CONVERSATION_PREFIXES);
                  router.push(`/tickets/${result.id}`);
                })
              }
            >
              <Icon name="plus" />
              <span className="conv-action-label">เปิดเคส</span>
            </button>
          )}
          <button
            type="button"
            className="btn sm"
            title={open ? 'ปิดบทสนทนา' : 'เปิดบทสนทนาอีกครั้ง'}
            onClick={() =>
              run(async () => {
                await setConversationStatus(c.id, nextStatus);
                toast(nextStatus === 'closed' ? 'ปิดบทสนทนาแล้ว' : 'เปิดบทสนทนาแล้ว');
                await refresh(...CONVERSATION_PREFIXES);
              })
            }
          >
            <Icon name={open ? 'checkCircle' : 'chat'} />
            <span className="conv-action-label">{open ? 'ปิดบทสนทนา' : 'เปิดบทสนทนาอีกครั้ง'}</span>
          </button>
        </div>
      </div>
      {/* One row: who may read, the AI summary (a button until there is one, then its own row under), notes only. */}
      <div className="conv-toolbar">
        <PrivacyTag org={work.tenant.name} />
        <ConversationSummary conversationId={c.id} messageCount={messages.length} />
        <ThreadFilter messages={messages} notesOnly={notesOnly} onChange={setNotesOnly} />
      </div>
      <ContactHeadsUp contactId={contact.id} className="conv-headsup" />
      {c.line && c.line.source_type !== 'user' && (
        <div className="notice">บทสนทนากลุ่ม LINE: คำตอบและไฟล์จะส่งให้สมาชิกทุกคนในกลุ่ม · เรียก AI ด้วย /bookdose หรือเมนชันบอต</div>
      )}
      {c.channel === 'facebook' && (
        <div className="notice">Facebook Messenger: ตอบได้เฉพาะข้อความ ไม่เกิน 2,000 ตัวอักษร และภายใน 24 ชั่วโมงหลังข้อความล่าสุดของลูกค้า</div>
      )}
      <MessageThread messages={messages} threadId={c.id} notesOnly={notesOnly} readAt={data.customer_read_at} manage={manage} />
      <ColleaguesHere conversationId={c.id} />
      <Composer
        conversationId={c.id}
        channel={c.channel}
        manual={c.channel === 'manual'}
        compact
        conversation={c} recipient={contact.name}
        caseNumber={t?.number}
        translateTo={translateTo(c.translation)}
      />
    </>
  );
}
