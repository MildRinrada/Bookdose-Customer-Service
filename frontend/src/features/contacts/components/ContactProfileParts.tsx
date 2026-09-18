'use client';

import { useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/Icon';
import { reachText } from '@/features/guest/labels';
import { date, relative } from '@/lib/format';
import { channelIcons, channelNames } from '@/lib/labels';
import { useApi } from '@/lib/query';
import { contactProfilePath } from '../api';
import { preferredChannelLabels, TAG_MAX, TAGS_MAX } from '../labels';
import type { ContactProfile, ContactProfileView } from '../types';

/* The customer's care profile where the team works: the warning and preferences on a chat or a case
   (ContactHeadsUp), the channels they talked on (ContactChannels, in the edit form), and the form's tag input.
   Markup: pages/contacts (contact-headsup, contact-channels, tag-input). */

/** "ติดต่อทาง LINE · หลัง 18:00", "ตอบเป็น English", the tags, and consent / deletion when they matter. */
export function profileFacts(p: ContactProfile) {
  const facts: { key: string; text: string; tone?: 'bad'; icon: string }[] = [];
  if (p.preferred_channel || p.contact_hours)
    facts.push({
      key: 'reach',
      icon: 'phone',
      text: [p.preferred_channel && `สะดวกทาง ${preferredChannelLabels[p.preferred_channel]}`, p.contact_hours].filter(Boolean).join(' · '),
    });
  if (p.language) facts.push({ key: 'lang', icon: 'globe', text: p.language === 'en' ? 'ตอบเป็นภาษาอังกฤษ' : 'ตอบเป็นภาษาไทย' });
  if (p.consent === 'no') facts.push({ key: 'consent', icon: 'lock', text: 'ไม่ยินยอมให้ติดต่อกลับ', tone: 'bad' });
  if (p.deletion_requested_at) facts.push({ key: 'delete', icon: 'trash', text: `ขอให้ลบข้อมูล ${date(p.deletion_requested_at)}`, tone: 'bad' });
  return facts;
}

/** The warning for the team and the customer's preferences, above a chat or in a case's customer card. Nothing when
    none was saved. */
export function ContactHeadsUp({ contactId, className = '' }: { contactId: string; className?: string }) {
  const p = useApi<ContactProfileView>(contactProfilePath(contactId)).data?.profile;
  if (!p) return null;
  const facts = profileFacts(p);
  if (!p.warning && !facts.length && !p.tags.length) return null;
  return (
    <div className={`contact-headsup ${className}`.trim()}>
      {p.warning && (
        <p className="contact-warning" role="note">
          <Icon name="bell" />
          <span>
            <strong>คำเตือนถึงทีม</strong>
            {p.warning}
          </span>
        </p>
      )}
      {(facts.length > 0 || p.tags.length > 0) && (
        <div className="contact-prefs">
          {facts.map((f) => (
            <span key={f.key} className={`contact-pref${f.tone ? ` ${f.tone}` : ''}`}>
              <Icon name={f.icon} />
              {f.text}
            </span>
          ))}
          {p.tags.map((t) => (
            <span key={t} className="contact-tag">
              #{t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Where the customer has talked to the team (edit form, read only). */
export function ContactChannels({ view }: { view: ContactProfileView | undefined }) {
  if (!view) return <p className="muted small">กำลังโหลดช่องทาง…</p>;
  const { channels, guest, account } = view;
  if (!channels.length && !guest && !account) return <p className="muted small contact-channels-empty">ยังไม่เคยติดต่อผ่านช่องทางใด</p>;
  return (
    <ul className="contact-channels">
      {channels.map((c) => (
        <li key={c.channel}>
          <span className="contact-channel-icon">
            <Icon name={channelIcons[c.channel] ?? 'chat'} />
          </span>
          <span className="contact-channel-body">
            <strong>{channelNames[c.channel] ?? c.channel}</strong>
            <span className="muted">
              {c.conversations} บทสนทนา · ล่าสุด {relative(c.last_at)}
              {c.addresses.length > 0 && ` · ${c.addresses.join(', ')}`}
            </span>
          </span>
        </li>
      ))}
      {account && (
        <li>
          <span className="contact-channel-icon">
            <Icon name="users" />
          </span>
          <span className="contact-channel-body">
            <strong>บัญชีหน้าลูกค้า</strong>
            <span className="muted">{account.line ? 'รับแจ้งเตือนทาง LINE แล้ว' : 'รับแจ้งเตือนทางอีเมล'}</span>
          </span>
        </li>
      )}
      {guest && (
        <li>
          <span className="contact-channel-icon">
            <Icon name="globe" />
          </span>
          <span className="contact-channel-body">
            <strong>ผู้เยี่ยมชม (ไม่มีบัญชี)</strong>
            <span className="muted">ตอบกลับถึงได้ทาง {reachText(guest.follow)}</span>
          </span>
        </li>
      )}
    </ul>
  );
}

/** Tags typed one by one (Enter or comma adds, Backspace on an empty box takes the last off), suggesting the ones
    the team already uses. */
export function TagInput({ value, onChange, suggestions }: { value: string[]; onChange: (tags: string[]) => void; suggestions: string[] }) {
  const [text, setText] = useState('');
  const full = value.length >= TAGS_MAX;
  const add = (raw: string) => {
    const tag = raw.replace(/,/g, ' ').trim().slice(0, TAG_MAX);
    if (tag && !value.includes(tag) && !full) onChange([...value, tag]);
    setText('');
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(text);
    } else if (event.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
  };
  const offered = suggestions.filter((s) => !value.includes(s)).slice(0, 8);
  return (
    <div className="tag-input">
      <div className="tag-input-box">
        {value.map((t) => (
          <span key={t} className="contact-tag editable">
            #{t}
            <button type="button" aria-label={`เอาแท็ก ${t} ออก`} onClick={() => onChange(value.filter((x) => x !== t))}>
              <Icon name="close" />
            </button>
          </span>
        ))}
        <input
          id="contact-tags"
          value={text}
          maxLength={TAG_MAX}
          disabled={full}
          placeholder={full ? `ครบ ${TAGS_MAX} แท็กแล้ว` : value.length ? 'เพิ่มแท็ก…' : 'พิมพ์แล้วกด Enter เช่น ลูกค้าองค์กร'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={keys}
          onBlur={() => text.trim() && add(text)}
        />
      </div>
      {offered.length > 0 && !full && (
        <div className="tag-suggestions" aria-label="แท็กที่ทีมใช้อยู่">
          {offered.map((s) => (
            <button key={s} type="button" onClick={() => add(s)}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
