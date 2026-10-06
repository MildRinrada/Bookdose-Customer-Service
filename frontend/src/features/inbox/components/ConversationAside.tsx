'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Badge, PriorityTag } from '@/components/ui/display';
import { useDialogs } from '@/components/ui/Dialogs';
import { ContactHistory } from '@/features/contacts';
import { reachText } from '@/features/guest/labels';
import { date, relative } from '@/lib/format';
import { channelIcons, channelNames } from '@/lib/labels';
import { useInvalidate } from '@/lib/query';
import { CONVERSATION_PREFIXES, pinMessage } from '../api';
import type { ConversationDetail, ConversationSummary } from '../types';
import { CustomerAvatar, inboxState } from './InboxItem';
import { PinnedButton } from './PinnedMessages';

/* Beside the open conversation on wide screens: who the customer is and how to reach them, what this chat is about
   (channel, category, the reference they gave, its case), what either side pinned in it and their other chats, so
   the team does not have to leave the inbox to know who they are talking to. The customer sees the same pins in the
   column beside their own chat. Markup: pages/inbox-fresh.css (inbox-aside). */

function Row({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  return (
    <div className="aside-row">
      <Icon name={icon} />
      <span className="sr-only">{label}: </span>
      <span className="aside-value">{children}</span>
    </div>
  );
}

export function ConversationAside({ data, others }: { data: ConversationDetail; others: ConversationSummary[] }) {
  const { conversation: c, contact, ticket: t } = data;
  const { openModal } = useDialogs();
  const refresh = useInvalidate();
  const guest = c.guest ?? contact.guest;
  return (
    <aside className="inbox-aside" aria-label="ข้อมูลลูกค้าและบทสนทนานี้">
      <section className="aside-card aside-person">
        <CustomerAvatar name={contact.name} id={contact.id} />
        <h2>{contact.name}</h2>
        {contact.company && <p className="aside-company">{contact.company}</p>}
        <div className="aside-rows">
          {contact.email && (
            <Row icon="mail" label="อีเมล">
              <a href={`mailto:${contact.email}`}>{contact.email}</a>
            </Row>
          )}
          {contact.phone && (
            <Row icon="phone" label="โทรศัพท์">
              <a href={`tel:${contact.phone}`}>{contact.phone}</a>
            </Row>
          )}
          {guest && (
            <Row icon="globe" label="ผู้เยี่ยมชม">
              ผู้เยี่ยมชม · {reachText(guest.follow)}
            </Row>
          )}
          {!contact.email && !contact.phone && !guest && <p className="aside-empty">ยังไม่มีอีเมลหรือเบอร์โทร</p>}
        </div>
        <button type="button" className="btn subtle sm aside-history" onClick={() => openModal(`เคสของ ${contact.name}`, <ContactHistory contactId={contact.id} />)}>
          <Icon name="history" />
          ประวัติเคสทั้งหมด
        </button>
      </section>

      <section className="aside-card">
        <h3>บทสนทนานี้</h3>
        <div className="aside-rows">
          <Row icon={channelIcons[c.channel] ?? 'chat'} label="ช่องทาง">
            {channelNames[c.channel] ?? c.channel}
          </Row>
          <Row icon="clock" label="เริ่มเมื่อ">
            เริ่ม {date(c.created_at, true)}
          </Row>
          {c.category && (
            <Row icon="list" label="หมวดที่ลูกค้าเลือก">
              {c.category}
            </Row>
          )}
          {c.reference && (
            <Row icon="ticket" label="เลขอ้างอิงจากลูกค้า">
              อ้างอิง <strong>{c.reference}</strong>
            </Row>
          )}
        </div>
        {t ? (
          <Link className="aside-case" href={`/tickets/${t.id}`}>
            <span>
              <strong>เคส BD-{t.number}</strong>
              <span className="aside-case-tags">
                <Badge status={t.status} />
                <PriorityTag value={t.priority} />
              </span>
            </span>
            <Icon name="arrow" />
          </Link>
        ) : (
          <p className="aside-empty">ยังไม่ได้เปิดเคสจากบทสนทนานี้</p>
        )}
      </section>

      {/* ข้อความที่ปักหมุด (conversations/pins.py): a button that opens them, there whether any are pinned or not. */}
      <PinnedButton messages={data.messages} onUnpin={(m) => void pinMessage(c.id, m.id, false).then(() => refresh(...CONVERSATION_PREFIXES))} />

      {others.length > 0 && (
        <section className="aside-card">
          <h3>แชทอื่นของลูกค้าคนนี้</h3>
          <ul className="aside-others">
            {others.slice(0, 5).map((o) => {
              const state = inboxState(o);
              return (
                <li key={o.id}>
                  <Link href={`/inbox/${o.id}`}>
                    <span className="aside-other-subject">{o.subject}</span>
                    <small>
                      <span className={`aside-state tone-${state.tone}`}>{state.label}</span> · {relative(o.updated_at)}
                    </small>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </aside>
  );
}
