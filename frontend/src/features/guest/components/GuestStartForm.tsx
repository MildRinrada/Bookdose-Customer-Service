'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { TextArea, TextField } from '@/components/ui/fields';
import { filesOf } from '@/components/ui/FileInput';
import { FilterPill } from '@/components/ui/filters';
import { Form } from '@/components/ui/Form';
import { replyPromise } from '@/features/customer/labels';
import { FilePills, FileProblem, useFilePills } from '@/features/rich/FilePills';
import { setGuestCredentials } from '@/lib/api/client';
import { readFiles } from '@/lib/files';
import type { PublicOrgInfo } from '@/features/auth/types';
import { startGuestChat } from '../api';
import type { GuestOverview } from '../types';

/* Starting a chat without an account: who the team is (welcome, reply promise, the AI note), the topic chips, the
   message with files, an optional name and the "public computer" choice. A hidden honeypot and the time the form
   appeared keep simple bots out (the server refuses a filled honeypot or a form sent within 2 seconds). */

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

export function GuestStartForm({
  slug,
  overview,
  info,
  onStarted,
}: {
  slug: string;
  overview: GuestOverview;
  info: PublicOrgInfo | undefined;
  onStarted: (id: string) => Promise<void> | void;
}) {
  // When the form appeared, for the server's "too fast to be a person" check.
  const [shownAt] = useState(() => Date.now());
  const [category, setCategory] = useState('');
  const { inputRef, files, problem, onChange, remove, clear } = useFilePills();
  const orgName = overview.organization.name;
  const known = overview.guest;

  return (
    <Form
      className="card-body customer-new-chat guest-start"
      data-form="guest-start"
      onSubmit={async (values, form) => {
        const attachments = await readFiles(filesOf(form, 'files'));
        const publicComputer = (form.elements.namedItem('public_computer') as HTMLInputElement | null)?.checked ?? false;
        const result = await startGuestChat(slug, {
          body: values.body ?? '',
          subject: values.subject ?? '',
          category,
          name: values.name ?? '',
          // A visitor this browser already remembers keeps its own choice (changed in "ติดตามแชทนี้").
          remember: known ? known.remember : !publicComputer,
          website: values.website ?? '',
          started_ms: shownAt,
          attachments,
        });
        setGuestCredentials(result.csrf);
        clear();
        await onStarted(result.id);
      }}
    >
      <Intro info={info} orgName={orgName} />
      {overview.categories.length > 0 && (
        <div className="field">
          <span className="file-field-title" id="guest-category-label">
            เรื่องที่ต้องการติดต่อ (ไม่บังคับ)
          </span>
          <div className="filter-pills guest-categories" role="group" aria-labelledby="guest-category-label">
            {overview.categories.map((name) => (
              <FilterPill key={name} label={name} value={name} pressed={category === name} onClick={(v) => setCategory((c) => (c === v ? '' : v))} />
            ))}
          </div>
        </div>
      )}
      <TextArea
        label="ข้อความถึงทีมงาน"
        name="body"
        id="guest-body"
        max={20000}
        rows={5}
        placeholder="เล่าเรื่องที่ต้องการให้ช่วย ยิ่งละเอียด ทีมงานยิ่งช่วยได้ตรงจุด"
      />
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
          label="หัวข้อ (ไม่บังคับ)"
          name="subject"
          id="guest-subject"
          max={300}
          required={false}
          placeholder="สรุปสั้น ๆ ว่าเรื่องอะไร"
        />
      </div>
      <div className="field">
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
          แนบไฟล์ (ไม่บังคับ)
        </label>
        <p className="tiny muted" id="guest-files-help">
          สูงสุด 3 ไฟล์ รวม 5 MB · PNG, JPG, GIF, WebP, MP4, WebM, PDF และ TXT
        </p>
        <FilePills files={files} onRemove={remove} />
        <FileProblem problem={problem} />
      </div>
      {/* People never see or reach this box; a bot that fills every field gives itself away. */}
      <div className="guest-honeypot" aria-hidden="true">
        <label htmlFor="guest-website">เว็บไซต์</label>
        <input id="guest-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      {!known && (
        <label className="check guest-public">
          <input type="checkbox" name="public_computer" />
          <span>เครื่องสาธารณะ ไม่ต้องจำแชทในเบราว์เซอร์นี้</span>
        </label>
      )}
      <p className="tiny muted">
        {known
          ? 'แชทนี้จะอยู่ในรายการแชทของคุณในเบราว์เซอร์นี้'
          : 'ไม่ต้องสมัครสมาชิก เบราว์เซอร์นี้จะจำแชทไว้ให้กลับมาอ่านคำตอบได้ และขอลิงก์ติดตามทางอีเมลได้หลังส่งข้อความ'}{' '}
        · อย่าส่งรหัสผ่านหรือข้อมูลสำคัญในแชท
      </p>
      <button className="btn primary guest-send" type="submit">
        <Icon name="send" />
        เริ่มแชท
      </button>
    </Form>
  );
}
