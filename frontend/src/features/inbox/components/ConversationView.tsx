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
import { date } from '@/lib/format';
import { channelIcons, channelNames, priorityLabels, statusLabels } from '@/lib/labels';
import { useInvalidate } from '@/lib/query';
import { useStaffUser, useWork } from '@/lib/session';
import { acceptConversation, CONVERSATION_PREFIXES, openTicketFromConversation } from '../api';
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
  const user = useStaffUser();
  // Correcting or taking back a message of this conversation (web chat and internal notes only).
  const manage = useManageMessages(c, work);
  const router = useRouter();
  const toast = useToast();
  const refresh = useInvalidate();
  const run = useRunAction();
  const [notesOnly, setNotesOnly] = useState(false);
  const open = c.status === 'open';
  const guest = c.guest ?? contact.guest;
  // รับเคส: an open chat nobody has taken is taken before it is answered, by a member of its team (backend
  // conversations/service.accept). Members of other teams and support access read it as it is.
  const owner = t?.assignee_id ? work.members.find((m) => m.id === t.assignee_id) : undefined;
  const mustAccept = open && c.channel !== 'manual' && !work.read_only && work.team_id === c.team_id && !t?.assignee_id;

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
              <span className="conv-fact" title={`ลูกค้าแชทโดยไม่ได้เข้าสู่ระบบ ${reachText(guest.follow)}`}>
                ผู้เยี่ยมชม
              </span>
            )}
            {c.member && (
              <span className="conv-fact" title="ลูกค้าเข้าสู่ระบบด้วยบัญชีลูกค้า">
                สมาชิก
              </span>
            )}
            {c.follows && (
              <Link className="conv-fact conv-follows" href={`/inbox/${c.follows.id}`} title={`ลูกค้าบอกว่าเรื่องนี้ต่อจาก “${c.follows.subject}”`}>
                <Icon name="history" />
                ต่อจาก {c.follows.ticket_number ? `BD-${c.follows.ticket_number}` : `“${c.follows.subject}”`}
              </Link>
            )}
            {c.category && (
              <span className="conv-fact" title="หมวดที่ลูกค้าเลือก">
                {c.category}
              </span>
            )}
            {/* แบบฟอร์มตามหมวดเรื่อง: what the customer filled in when they started the chat. */}
            {c.form_values?.map((v) => (
              <span key={v.field} className="conv-fact" title="ลูกค้ากรอกตอนเริ่มแชท">
                {v.name}: {v.value}
              </span>
            ))}
            {/* ขอคนเดิม and ไม่รีบ: what the customer asked of the team (portal/same_member.py, no_rush.py). */}
            {c.asked_member && (
              <span
                className="conv-fact"
                title={
                  c.asked_member.given
                    ? 'ลูกค้าขอให้คนเดิมดูแลต่อ ระบบมอบเคสให้แล้ว'
                    : `ลูกค้าขอให้คนเดิมดูแลต่อ แต่ตอนนั้น${c.asked_member.reason} จึงส่งเข้าทีมตามปกติ`
                }
              >
                <Icon name="users" />
                ขอ {c.asked_member.name}
                {c.asked_member.given ? '' : ' (ไม่อยู่)'}
              </span>
            )}
            {open && c.no_rush && (
              <span className="conv-fact" title="ลูกค้าบอกว่าไม่รีบ คิวถอยไปหลังลูกค้าที่รีบ และกำหนดตอบของเคสเลื่อนตามโดยไม่นับว่าเกิน SLA">
                <Icon name="clock" />
                ไม่รีบ ตอบได้ถึง{c.no_rush.text}
              </span>
            )}
            {t && (
              <Link className="conv-case-link" href={`/tickets/${t.id}`} title={`เปิดรายละเอียดเคส BD-${t.number}`}>
                BD-{t.number} {statusLabels[t.status] ?? t.status}
                {['high', 'urgent'].includes(t.priority) && <span className="conv-urgent"> {priorityLabels[t.priority]}</span>}
              </Link>
            )}
            {open && c.mood && (
              <MoodTag mood={{ mood_level: c.mood.level, mood_urgent: c.mood.urgent, mood_reason: c.mood.reason, mood_source: c.mood.source }} />
            )}
            {/* A blocked guest's chats were closed with the block: บล็อกแล้ว says both. */}
            {!open && !c.guest_block?.block && <span className="conv-fact">ปิดบทสนทนาแล้ว</span>}
            {c.guest_block?.block && (
              <span
                className="conv-fact conv-blocked"
                title={`${c.guest_block.block.blocked_by} บล็อกผู้เยี่ยมชมคนนี้เมื่อ ${date(c.guest_block.block.created_at, true)} ส่งข้อความหรือเริ่มแชทใหม่ไม่ได้`}
              >
                <Icon name="ban" />
                บล็อกแล้ว
              </span>
            )}
          </p>
        </div>
        <div className="conv-actions">
          <span className="inbox-ai-status" data-ai-controls={c.id}>
            <AiControls conversation={c} />
          </span>
          {!t && !mustAccept && (
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
        </div>
      </div>
      {/* One row: who may read, the AI summary (a button until there is one, then its own row under), notes only. */}
      <div className="conv-toolbar">
        <PrivacyTag org={work.tenant.name} />
        <ConversationSummary conversationId={c.id} messageCount={messages.length} />
        <ThreadFilter messages={messages} notesOnly={notesOnly} onChange={setNotesOnly} />
      </div>
      <ContactHeadsUp contactId={contact.id} className="conv-headsup" />
      {c.line && c.line.source_type !== 'user' && <div className="notice">บทสนทนากลุ่ม LINE: คำตอบและไฟล์จะส่งให้สมาชิกทุกคนในกลุ่ม</div>}
      <MessageThread messages={messages} threadId={c.id} notesOnly={notesOnly} readAt={data.customer_read_at} manage={manage} />
      <ColleaguesHere conversationId={c.id} />
      {mustAccept ? (
        <AcceptBar conversationId={c.id} />
      ) : (
        <>
          {open && owner && owner.id !== user.id && (
            <p className="conv-owner">
              <Icon name="users" />
              {owner.name} รับเรื่องนี้แล้ว
            </p>
          )}
          <Composer
            conversationId={c.id}
            channel={c.channel}
            manual={c.channel === 'manual'}
            compact
            conversation={c}
            recipient={contact.name}
            caseNumber={t?.number}
            translateTo={translateTo(c.translation)}
            notesOnly={notesOnly}
            // A reply sent while the thread shows notes only would be out of sight: show the whole thread again.
            onSent={(sent) => {
              if (sent === 'reply') setNotesOnly(false);
            }}
          />
        </>
      )}
    </>
  );
}

/** Where the composer would be while nobody has taken the chat: one button takes it, then the composer opens. */
function AcceptBar({ conversationId }: { conversationId: string }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const run = useRunAction();
  return (
    <div className="conv-accept">
      <p>
        <strong>ยังไม่มีใครรับเรื่องนี้</strong>
        <span>กดรับเคสก่อนตอบลูกค้า เพื่อนร่วมทีมจะเห็นว่าคุณดูแลอยู่</span>
      </p>
      <button
        type="button"
        className="btn primary"
        onClick={() =>
          run(async () => {
            try {
              await acceptConversation(conversationId);
              toast('รับเคสแล้ว');
            } finally {
              await refresh(...CONVERSATION_PREFIXES);
            }
          })
        }
      >
        <Icon name="checkCircle" />
        รับเคส
      </button>
    </div>
  );
}
