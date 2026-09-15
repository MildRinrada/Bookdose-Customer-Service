'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { RequiredStar, SelectField, TextArea, TextField, useFieldValidation } from '@/components/ui/fields';
import { filesOf } from '@/components/ui/FileInput';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { FilePills, FileProblem, useFilePills } from '@/features/rich/FilePills';
import { readFiles } from '@/lib/files';
import { useInvalidate } from '@/lib/query';
import type { CustomerOrg } from '@/lib/types';
import { openChat, OVERVIEW_PATH } from '../api';
import { useOrgFilter, useOrgs } from '../hooks';
import { replyPromise } from '../labels';
import { JoinOrgForm } from './JoinOrg';

/* A new chat starts with who it is for: the platform itself (problems with the system) or one of the organizations
   the customer deals with (their services and their own cases). The welcome, the reply promise and the categories
   are that organization's (pages/customer/customer-new-chat.html). */

function OrgIntro({ org }: { org: CustomerOrg | undefined }) {
  if (!org) return null;
  const promise = replyPromise(org);
  return (
    <>
      {org.welcome && <p className="customer-welcome">{org.welcome}</p>}
      <p className="customer-promise">
        <Icon name="clock" />
        <span>{promise ? `ทีมงาน ${org.name} ตอบกลับครั้งแรกภายใน ${promise}` : `ทีมงาน ${org.name} จะติดต่อกลับโดยเร็วที่สุด`}</span>
      </p>
      {org.ai_enabled && (
        <p className="customer-ai-note">
          <Icon name="sparkle" />
          <span>
            AI ผู้ช่วยของ {org.name} จะอ่านข้อความและบทความช่วยเหลือเพื่อเตรียมคำตอบ กด “คุยกับเจ้าหน้าที่” ในแชทเพื่อคุยกับคนได้ตลอดเวลา
          </span>
        </p>
      )}
    </>
  );
}

export function NewChatForm({ preselect = '', hasChats }: { preselect?: string; hasChats: boolean }) {
  const orgs = useOrgs();
  const [orgFilter] = useOrgFilter();
  const initial = orgs.find((o) => o.slug === preselect) ?? orgs.find((o) => o.slug === orgFilter) ?? orgs[0];
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const org = orgs.find((o) => o.slug === slug);
  const home = orgs.find((o) => o.home);
  const others = orgs.filter((o) => !o.home);
  const pills = useFilePills();
  const orgCheck = useFieldValidation();
  const { openModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const router = useRouter();

  const option = (o: CustomerOrg) => (
    <option key={o.slug} value={o.slug}>
      {o.name}
    </option>
  );

  return (
    <>
      <div className="card-header conv-header">
        {hasChats && (
          <Link className="icon-btn conv-back" href="/customer/chats" aria-label="กลับไปที่รายการแชท">
            <Icon name="back" />
          </Link>
        )}
        <div className="conv-title">
          <h2>เริ่มแชทใหม่</h2>
          <p className="conv-meta">เลือกองค์กรที่ต้องการติดต่อ แล้วเล่าเรื่องให้ทีมงานฟัง เรื่องจะถึงทีมขององค์กรนั้นโดยตรง</p>
        </div>
      </div>
      <Form
        className="card-body customer-new-chat"
        data-form="customer-request"
        onSubmit={async (values, form) => {
          const attachments = await readFiles(filesOf(form, 'files'));
          const result = await openChat(values.org, {
            subject: values.subject ?? '',
            body: values.body ?? '',
            category: values.category || '',
            attachments,
          });
          toast(`ส่งถึง ${orgs.find((o) => o.slug === values.org)?.name || 'ทีมงาน'} แล้ว ติดตามคำตอบได้ในแชทนี้`);
          // The new chat must be in the list when its page opens.
          await refresh(OVERVIEW_PATH);
          router.push(`/customer/chats/${values.org}/${result.id}`);
        }}
      >
        <div className="field">
          <label htmlFor="request-org">
            ติดต่อองค์กร
            <RequiredStar />
          </label>
          <div className="customer-org-pick">
            <select id="request-org" name="org" required value={slug} onChange={(e) => setSlug(e.target.value)} {...orgCheck.bind}>
              {home && <optgroup label={`ติดต่อ ${home.name} โดยตรง · ปัญหาระบบ แพลตฟอร์มค้าง แจ้ง Bug`}>{option(home)}</optgroup>}
              {others.length > 0 && <optgroup label="องค์กรคู่ค้า · สอบถามบริการ สินค้า หรือเคสขององค์กรนั้น">{others.map(option)}</optgroup>}
            </select>
            <button type="button" className="btn subtle" onClick={() => openModal('เพิ่มองค์กรที่ติดต่อได้', <JoinOrgForm />)}>
              <Icon name="plus" />
              เพิ่มองค์กรด้วยรหัส
            </button>
            {orgCheck.errorNode}
          </div>
          <small className="muted">
            ตัวระบบค้าง หน้าเว็บผิดปกติ หรือพบ Bug ติดต่อผู้ให้บริการระบบได้เสมอ · เรื่องบริการ สินค้า หรือเคสขององค์กรใด ให้เลือกองค์กรนั้น
          </small>
        </div>
        <div id="customer-org-intro" className="customer-org-intro" aria-live="polite">
          <OrgIntro org={org} />
        </div>
        {/* Another organization has its own categories: the choice starts over. */}
        <SelectField key={slug} label="หมวดเรื่อง" name="category" id="request-category" required defaultValue="">
          <option value="">เลือกหมวดเรื่อง</option>
          {(org?.categories ?? []).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </SelectField>
        <TextField label="เรื่องที่ต้องการความช่วยเหลือ" name="subject" max={300} placeholder="สรุปสั้น ๆ ว่าเรื่องอะไร" />
        <TextArea
          label="รายละเอียด"
          name="body"
          id="request-body"
          max={20000}
          rows={6}
          placeholder="เกิดอะไรขึ้น ทำอะไรอยู่ตอนนั้น และเห็นข้อความอะไรบ้าง ยิ่งเล่าละเอียด ทีมงานยิ่งช่วยได้ตรงจุด"
        />
        <div className="field">
          <span className="file-field-title">แนบไฟล์ (ไม่บังคับ)</span>
          <input
            ref={pills.inputRef}
            id="request-files"
            className="attach-input"
            name="files"
            type="file"
            multiple
            accept=".png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.pdf,.txt"
            aria-label="แนบไฟล์"
            aria-describedby="request-files-help"
            data-file-ready="1"
            onChange={pills.onChange}
          />
          <label className="btn subtle customer-attach" htmlFor="request-files">
            <Icon name="paperclip" />
            เลือกไฟล์จากเครื่อง
          </label>
          <p className="tiny muted" id="request-files-help">
            แนบภาพหรือวิดีโออธิบายปัญหาได้ · สูงสุด 3 ไฟล์ รวม 5 MB · PNG, JPG, GIF, WebP, MP4, WebM, PDF และ TXT
          </p>
          <FilePills files={pills.files} onRemove={pills.remove} />
          <FileProblem problem={pills.problem} />
        </div>
        <p className="tiny muted">เพื่อความปลอดภัย กรุณาอย่าส่งรหัสผ่านหรือข้อมูลบัตรชำระเงินในแชท</p>
        <button className="btn primary" type="submit">
          <Icon name="send" />
          ส่งถึงทีมงาน
        </button>
      </Form>
    </>
  );
}
