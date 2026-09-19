'use client';

import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { TextField } from '@/components/ui/fields';
import { filesOf } from '@/components/ui/FileInput';
import { Form } from '@/components/ui/Form';
import { HoneypotField, honeypotValue } from '@/components/ui/HoneypotField';
import { replyPromise } from '@/features/customer/labels';
import { FilePills, FileProblem, useFilePills } from '@/features/rich/FilePills';
import { RichTextArea } from '@/features/rich/RichTextArea';
import { setGuestCredentials } from '@/lib/api/client';
import { readFiles } from '@/lib/files';
import type { PublicOrgInfo } from '@/features/auth/types';
import { startGuestChat } from '../api';
import type { GuestOverview, GuestStartLink } from '../types';

/* Starting a chat without an account, in three steps: what it is about (the organization's categories as tiles),
   the story (subject, message with simple formatting, files) and how to follow the answer (this browser, a follow link
   by email and/or SMS, a name and a reference for the team). A new visitor who does not want this browser to remember
   them must give an address, or the chat would be lost. The hidden box (HoneypotField) and the time the form appeared
   keep simple bots out (the server refuses a filled honeypot or a form sent within 2 seconds). `intro`: the team's
   welcome and reply promise above the steps (the start page shows them in its own head instead).
   Markup: pages/guest-chat (start-step, start-topic, start-remember, start-submit). */

const KEEP = 'เลือก “จำแชทไว้ในเครื่องนี้” หรือกรอกอีเมลหรือเบอร์โทรเพื่อรับลิงก์ติดตามแชท';

/** An icon that suits a category's name; the organization names its categories freely. */
function topicIcon(name: string): string {
  if (/ปัญหา|แจ้ง|บั๊ก|bug|เสีย|ใช้งานไม่ได้/i.test(name)) return 'bolt';
  if (/เสนอ|ร้องเรียน|ติชม|feedback/i.test(name)) return 'star';
  if (/บัญชี|รหัส|เข้าสู่ระบบ|login/i.test(name)) return 'lock';
  if (/ยืม|หนังสือ|บทความ|คู่มือ/i.test(name)) return 'book';
  if (/ถาม|บริการ|ข้อมูล/i.test(name)) return 'chat';
  return 'ticket';
}

function Intro({ info, orgName }: { info: PublicOrgInfo | undefined; orgName: string }) {
  const promise = replyPromise({ response_hours: Number(info?.response_hours) || undefined });
  return (
    <div className="customer-org-intro guest-intro">
      {info?.welcome && <p className="customer-welcome">{info.welcome}</p>}
      <p className="customer-promise">
        <Icon name="clock" />
        <span>{promise ? `ทีมงาน ${orgName} ตอบกลับครั้งแรกภายใน ${promise}` : `ทีมงาน ${orgName} จะตอบกลับโดยเร็วที่สุด`}</span>
      </p>
      {info?.ai_enabled && (
        <p className="customer-ai-note">
          <Icon name="sparkle" />
          <span>AI ผู้ช่วยของ {orgName} จะช่วยตอบก่อน กด “คุยกับเจ้าหน้าที่” ในแชทเพื่อคุยกับคนได้ตลอดเวลา</span>
        </p>
      )}
    </div>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="start-step" aria-labelledby={`start-step-${n}`}>
      <div className="start-step-head">
        <span className="start-step-no" aria-hidden="true">
          {n}
        </span>
        <div>
          <h3 id={`start-step-${n}`}>{title}</h3>
          {hint && <p>{hint}</p>}
        </div>
      </div>
      <div className="start-step-body">{children}</div>
    </section>
  );
}

/** What the toast says after the start: where the follow links went, and which could not be sent. */
export function linksMessage(orgName: string, links: GuestStartLink[] | undefined): string {
  const sent = (links ?? []).filter((l) => l.sent).map((l) => l.to_masked);
  const failed = (links ?? []).filter((l) => !l.sent).map((l) => l.to_masked);
  const parts = [`ส่งข้อความถึงทีมงาน ${orgName} แล้ว`];
  if (sent.length) parts.push(`ส่งลิงก์ติดตามแชทไปที่ ${sent.join(' และ ')} แล้ว`);
  if (failed.length) parts.push(`ส่งลิงก์ไปที่ ${failed.join(' และ ')} ไม่สำเร็จ ขอใหม่ได้ที่ “ติดตามแชทนี้”`);
  return parts.join(' · ');
}

export function GuestStartForm({
  slug,
  overview,
  info,
  intro = true,
  onStarted,
}: {
  slug: string;
  overview: GuestOverview;
  info: PublicOrgInfo | undefined;
  intro?: boolean;
  onStarted: (id: string, links: GuestStartLink[]) => Promise<void> | void;
}) {
  // When the form appeared, for the server's "too fast to be a person" check.
  const [shownAt] = useState(() => Date.now());
  const [category, setCategory] = useState('');
  const { inputRef, files, problem, onChange, remove, clear } = useFilePills();
  const orgName = overview.organization.name;
  const known = overview.guest;
  const { email_ready: emailReady, sms_ready: smsReady } = overview.follow;
  const topics = overview.categories;
  let n = 0;

  return (
    <Form
      className="card-body customer-new-chat guest-start"
      data-form="guest-start"
      onSubmit={async (values, form) => {
        const keep = (form.elements.namedItem('remember') as HTMLInputElement | null)?.checked ?? true;
        const email = (values.email ?? '').trim();
        const phone = (values.phone ?? '').trim();
        if (!known && !keep && !email && !phone) throw new Error(KEEP);
        const attachments = await readFiles(filesOf(form, 'files'));
        const result = await startGuestChat(slug, {
          body: values.body ?? '',
          subject: values.subject ?? '',
          category,
          name: values.name ?? '',
          email,
          phone,
          reference: (values.reference ?? '').trim(),
          // A visitor this browser already remembers keeps its own choice (changed in "ติดตามแชทนี้").
          remember: known ? known.remember : keep,
          website: honeypotValue(values),
          started_ms: shownAt,
          attachments,
        });
        setGuestCredentials(result.csrf);
        clear();
        await onStarted(result.id, result.links ?? []);
      }}
    >
      {intro && <Intro info={info} orgName={orgName} />}
      {topics.length > 0 && (
        <Step n={++n} title="เรื่องที่ต้องการติดต่อ" hint="เลือกเรื่องที่ใกล้ที่สุด ทีมที่ดูแลเรื่องนั้นจะได้รับทันที (ไม่บังคับ)">
          <div className="start-topics" role="group" aria-label="เรื่องที่ต้องการติดต่อ">
            {topics.map((name) => (
              <button
                key={name}
                type="button"
                className="start-topic"
                aria-pressed={category === name}
                onClick={() => setCategory((c) => (c === name ? '' : name))}
              >
                <Icon name={category === name ? 'check' : topicIcon(name)} />
                <span>{name}</span>
              </button>
            ))}
          </div>
        </Step>
      )}
      <Step n={++n} title="เล่าเรื่องให้ทีมงานฟัง" hint="ยิ่งเล่าละเอียด ทีมงานยิ่งช่วยได้ตรงจุด แนบภาพหน้าจอได้">
        <TextField label="หัวข้อ (ไม่บังคับ)" name="subject" id="guest-subject" max={300} required={false} placeholder="สรุปสั้น ๆ ว่าเรื่องอะไร" />
        <RichTextArea
          label="ข้อความถึงทีมงาน"
          name="body"
          id="guest-body"
          placeholder="เกิดอะไรขึ้น ทำอะไรอยู่ตอนนั้น และเห็นข้อความอะไรบ้าง"
        />
        <div className="field start-files">
          <input
            ref={inputRef}
            id="guest-files"
            className="attach-input"
            name="files"
            type="file"
            multiple
            accept=".png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.pdf,.txt"
            aria-label="แนบไฟล์"
            aria-describedby="guest-files-help"
            data-file-ready="1"
            onChange={onChange}
          />
          <label className="btn subtle customer-attach" htmlFor="guest-files">
            <Icon name="paperclip" />
            แนบไฟล์
          </label>
          <span className="tiny muted" id="guest-files-help">
            สูงสุด 3 ไฟล์ รวม 5 MB · รูป วิดีโอ PDF หรือ TXT
          </span>
          <FilePills files={files} onRemove={remove} />
          <FileProblem problem={problem} />
        </div>
      </Step>
      <Step n={++n} title="ติดตามคำตอบ" hint="ไม่ต้องสมัครสมาชิก เลือกทางที่สะดวก">
        {!known && (
          <label className="start-remember">
            <input type="checkbox" name="remember" defaultChecked />
            <span>
              <strong>จำแชทไว้ในเครื่องนี้</strong>
              <small>กลับมาอ่านคำตอบได้ที่เบราว์เซอร์นี้โดยไม่ต้องกรอกอีเมล · เอาเครื่องหมายออกถ้าเป็นเครื่องสาธารณะ</small>
            </span>
          </label>
        )}
        <p className="start-reach-title">
          รับลิงก์ติดตามแชททาง{emailReady && smsReady ? 'อีเมลหรือ SMS (กรอกทั้งสองช่อง ระบบส่งไปทั้งสองทาง)' : 'อีเมลหรือ SMS'}
        </p>
        <div className="guest-start-row">
          <TextField
            label="อีเมล"
            name="email"
            id="guest-email"
            type="email"
            max={254}
            required={false}
            disabled={!emailReady}
            autoComplete="email"
            placeholder={emailReady ? 'name@example.com' : 'ยังไม่เปิดให้ส่งทางอีเมล'}
          />
          <TextField
            label="เบอร์โทรศัพท์ (SMS)"
            name="phone"
            id="guest-phone"
            type="tel"
            max={30}
            required={false}
            disabled={!smsReady}
            autoComplete="tel"
            placeholder={smsReady ? '081-234-5678' : 'ยังไม่เปิดให้ส่งทาง SMS'}
          />
        </div>
        <div className="guest-start-row">
          <TextField
            label="ชื่อที่ให้ทีมงานเรียก (ไม่บังคับ)"
            name="name"
            id="guest-name"
            max={100}
            required={false}
            defaultValue={known?.name ?? ''}
            autoComplete="name"
            placeholder="เช่น คุณสมชาย"
          />
          <TextField
            label="เลขอ้างอิง (ถ้ามี)"
            name="reference"
            id="guest-reference"
            max={60}
            required={false}
            autoComplete="off"
            placeholder="เช่น เลขเคสเดิม BD-1234"
          />
        </div>
      </Step>
      <HoneypotField />
      <div className="start-submit">
        <button className="btn primary guest-send" type="submit">
          <Icon name="send" />
          ส่งถึงทีมงาน {orgName}
        </button>
        <p className="tiny muted">
          <Icon name="lock" /> {known ? 'แชทนี้จะอยู่ในรายการแชทของคุณในเบราว์เซอร์นี้ · ' : ''}อย่าส่งรหัสผ่านหรือข้อมูลสำคัญในแชท
        </p>
      </div>
    </Form>
  );
}
